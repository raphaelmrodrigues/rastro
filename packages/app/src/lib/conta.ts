/**
 * Conta do Rastro e sincronização.
 *
 * A conta é obrigatória desde 14/08/2026 (decisão do dono, registrada no §9 do
 * CLAUDE.md): nenhuma tela abre sem sessão. O processamento continua acontecendo
 * no aparelho — o `.zip` nunca sai dele, e o que sobe é a lista já processada —,
 * mas isso deixou de ser escolha do usuário e por isso não é mais explicado na
 * interface.
 *
 * A decisão que atravessa este arquivo: **o import local nunca depende da rede**.
 * O snapshot é gravado no aparelho primeiro e o envio vem depois. Se o servidor
 * estiver fora, o import continua válido e o envio fica pendente — o contrário
 * (perder o import porque o Wi-Fi caiu) seria trocar a parte confiável do
 * produto pela parte frágil.
 */

import { create } from 'zustand';
import type { Snapshot } from '@rastro/core';
import {
  lerAjuste,
  loadSnapshot as loadSnapshotLocal,
  readIndex,
  salvarAjuste,
  saveSnapshot,
} from './storage';
import { esquecerLembretes } from './notificacoes';
import {
  cadastrar as apiCadastrar,
  criarPerfil,
  entrar as apiEntrar,
  enviarSnapshot,
  ErroDeApi,
  excluirConta as apiExcluirConta,
  baixarSnapshot,
  listarPerfis,
  listarSnapshotsRemotos,
  PrecisaAtualizar,
  quandoPerderSessao,
  quandoPrecisarAtualizar,
  restaurarSessao,
  sair as apiSair,
  SessaoExpirada,
  temSessao,
  usuarioAtual,
  type PerfilRemoto,
} from '../api/client';
import { eraseEverything } from './storage';

/** Onde o @ do perfil fica entre aberturas do app. Não é segredo: é um rótulo. */
const CHAVE_PERFIL = 'rastro:profileId';

/**
 * Id do último snapshot que o servidor confirmou ter recebido.
 *
 * É o que permite retomar depois de uma falha de rede. Sem isto, "vai junto no
 * próximo envio" seria promessa vazia: o import ficaria só no aparelho para
 * sempre, e a tela diria que estava tudo bem.
 */
const CHAVE_ULTIMO_ENVIADO = 'rastro:ultimoSnapshotEnviado';

/*
 * Estas duas chaves passavam por `globalThis.localStorage`, que **não existe no
 * React Native**. No navegador funcionava; no celular a gravação era um no-op
 * silencioso e a leitura devolvia sempre `null`, com dois efeitos:
 *
 *  - o perfil ativo não sobrevivia a fechar o app (caía sempre no primeiro da
 *    conta, o que só passa despercebido enquanto houver um perfil só);
 *  - o controle de "já enviei este snapshot" nunca persistia, então toda abertura
 *    do app reenviava a lista inteira de seguidores. O servidor deduplica, mas o
 *    upload acontecia — no plano de dados do usuário.
 *
 * Agora vão pelo `storage`, que grava em arquivo no aparelho e em localStorage no
 * navegador. As funções ficaram assíncronas por causa disso; todos os pontos de
 * chamada já estavam dentro de funções `async`.
 */
function lerPerfilSalvo(): Promise<string | null> {
  return lerAjuste(CHAVE_PERFIL);
}

function salvarPerfil(id: string | null): Promise<void> {
  return salvarAjuste(CHAVE_PERFIL, id);
}

export type EstadoDeEnvio =
  | { situacao: 'ocioso' }
  | { situacao: 'enviando' }
  | { situacao: 'enviado'; duplicado: boolean; em: number }
  /** Veio do servidor para este aparelho. `quantos` é o que faltava aqui. */
  | { situacao: 'restaurado'; quantos: number; em: number }
  | { situacao: 'pendente'; motivo: string };

interface ContaState {
  /** `null` enquanto ainda não sabemos — evita piscar a tela de login na abertura. */
  conectado: boolean | null;
  userId: string | null;
  perfil: PerfilRemoto | null;
  ocupado: boolean;
  erro: string | null;
  envio: EstadoDeEnvio;
  /** O servidor desligou esta versão. Só a tela de atualização abre. */
  precisaAtualizar: boolean;

  iniciar: () => Promise<void>;
  /** Apaga a conta no servidor e os dados deste aparelho. Sem volta. */
  excluirConta: () => Promise<boolean>;
  cadastrar: (email: string, senha: string) => Promise<boolean>;
  entrar: (email: string, senha: string) => Promise<boolean>;
  sair: () => Promise<void>;
  definirPerfil: (handle: string) => Promise<boolean>;
  /** Manda o snapshot, se houver conta e perfil. Nunca lança. */
  sincronizar: (snapshot: Snapshot) => Promise<void>;
  /** Reenvia o import mais recente se ele ainda não subiu. Idempotente. */
  enviarPendente: () => Promise<void>;
  /** Traz do servidor os snapshots que faltam neste aparelho. */
  restaurarDoServidor: () => Promise<void>;
  limparErro: () => void;
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof PrecisaAtualizar) return erro.message;
  if (erro instanceof SessaoExpirada) return erro.message;
  if (erro instanceof ErroDeApi) return erro.hint ? `${erro.message} ${erro.hint}` : erro.message;
  return 'Não foi possível falar com o servidor.';
}

export const useConta = create<ContaState>((set, get) => ({
  conectado: null,
  userId: null,
  perfil: null,
  ocupado: false,
  erro: null,
  envio: { situacao: 'ocioso' },
  precisaAtualizar: false,

  async iniciar() {
    // Se o refresh token for recusado enquanto o app está aberto, a UI precisa
    // saber na hora — senão o usuário fica numa tela que não responde mais.
    quandoPerderSessao(() => {
      set({ conectado: false, userId: null, perfil: null });
    });

    // Idem para o corte de versão: pode chegar em qualquer chamada, inclusive
    // muito depois da abertura, se o corte for configurado com o app já aberto.
    quandoPrecisarAtualizar(() => {
      set({ precisaAtualizar: true });
    });

    const ok = await restaurarSessao();
    if (!ok) {
      set({ conectado: false });
      return;
    }

    set({ conectado: true, userId: usuarioAtual() });
    await carregarPerfil(set);
    /*
     * Restaurar vem antes de enviar, e a ordem importa: num aparelho novo não há
     * nada para enviar, e é exatamente esse o caso em que a pessoa precisa do
     * histórico de volta. Fazer o contrário atrasaria a única coisa que ela
     * está esperando ver.
     *
     * Sem `await` nos dois: a abertura do app não espera a rede.
     */
    void get()
      .restaurarDoServidor()
      .then(() => get().enviarPendente());
  },

  async cadastrar(email, senha) {
    set({ ocupado: true, erro: null });
    try {
      await apiCadastrar(email.trim(), senha);
      set({ ocupado: false, conectado: true, userId: usuarioAtual() });
      await carregarPerfil(set);
      return true;
    } catch (erro) {
      set({ ocupado: false, erro: mensagemDe(erro) });
      return false;
    }
  },

  async entrar(email, senha) {
    set({ ocupado: true, erro: null });
    try {
      await apiEntrar(email.trim(), senha);
      set({ ocupado: false, conectado: true, userId: usuarioAtual() });
      await carregarPerfil(set);
      return true;
    } catch (erro) {
      set({ ocupado: false, erro: mensagemDe(erro) });
      return false;
    }
  },

  async sair() {
    set({ ocupado: true });
    await apiSair();
    await salvarPerfil(null);
    await salvarAjuste(CHAVE_ULTIMO_ENVIADO, null);
    // Um lembrete agendado continuaria tocando para quem já saiu do app.
    await esquecerLembretes();
    set({
      ocupado: false,
      conectado: false,
      userId: null,
      perfil: null,
      envio: { situacao: 'ocioso' },
    });
  },

  async excluirConta() {
    set({ ocupado: true, erro: null });
    try {
      await apiExcluirConta();
    } catch (erro) {
      set({ ocupado: false, erro: mensagemDe(erro) });
      return false;
    }

    /*
     * Os dados locais vão junto, e isso não é detalhe.
     *
     * O aparelho guarda a rede social inteira da pessoa. Apagar só o lado do
     * servidor deixaria os snapshots aqui, e quem pediu exclusão não espera que
     * a lista de quem o segue continue no celular. Fora do try do servidor de
     * propósito: mesmo que a chamada tenha falhado, se chegamos aqui é porque
     * ela não lançou.
     */
    // O lembrete sai antes do `eraseEverything`: ele precisa ler a preferência
    // para cancelar o agendamento, e o erase apaga essa preferência junto.
    await esquecerLembretes();
    await eraseEverything();
    await salvarPerfil(null);
    await salvarAjuste(CHAVE_ULTIMO_ENVIADO, null);

    set({
      ocupado: false,
      conectado: false,
      userId: null,
      perfil: null,
      envio: { situacao: 'ocioso' },
    });
    return true;
  },

  async definirPerfil(handle) {
    set({ ocupado: true, erro: null });
    try {
      const perfil = await criarPerfil(handle.trim().replace(/^@/, ''));
      await salvarPerfil(perfil.id);
      set({ ocupado: false, perfil });
      // Quem já usava o app no modo local acabou de ganhar um destino para os
      // imports que ele fez antes de criar conta. E quem está reinstalando num
      // aparelho novo acabou de ganhar o histórico de volta.
      void get()
        .restaurarDoServidor()
        .then(() => get().enviarPendente());
      return true;
    } catch (erro) {
      set({ ocupado: false, erro: mensagemDe(erro) });
      return false;
    }
  },

  async sincronizar(snapshot) {
    const { conectado, perfil } = get();
    // Sem conta ou sem perfil não há o que sincronizar, e isso não é erro:
    // é o modo privado funcionando como prometido.
    if (!conectado || !perfil || !temSessao()) return;

    set({ envio: { situacao: 'enviando' } });
    try {
      const resultado = await enviarSnapshot(perfil.id, {
        ...(snapshot.exportedAt !== undefined ? { exportedAt: snapshot.exportedAt } : {}),
        ...(snapshot.format ? { format: snapshot.format } : {}),
        ...(snapshot.dataWindow ? { dataWindow: snapshot.dataWindow } : {}),
        relationships: snapshot.relationships,
        warnings: snapshot.warnings,
      });
      await salvarAjuste(CHAVE_ULTIMO_ENVIADO, snapshot.id);
      set({
        envio: { situacao: 'enviado', duplicado: resultado.duplicate, em: Date.now() },
      });
    } catch (erro) {
      // O snapshot já está salvo no aparelho. Falha aqui é adiamento, não perda —
      // e a mensagem precisa dizer isso, senão o usuário acha que perdeu o import.
      set({ envio: { situacao: 'pendente', motivo: mensagemDe(erro) } });
    }
  },

  /**
   * Traz do servidor o que este aparelho não tem.
   *
   * O par de `enviarPendente`, e o conserto de um buraco que estava de pé desde
   * que a conta existe: o app **subia** os snapshots e nunca baixava. Na prática,
   * quem trocasse de celular, entrasse na conta e abrisse o app via "envie seu
   * primeiro arquivo" — com o histórico inteiro parado no servidor. A conta era
   * backup só de ida, e é justamente ela que o app oferece como motivo para
   * criar cadastro.
   *
   * Baixa por diferença, não tudo sempre: o que já está no aparelho fica como
   * está. E nunca sobrescreve — um snapshot já é imutável por definição.
   *
   * Falhar aqui é silencioso de propósito. O app funciona inteiro offline; uma
   * restauração que não completou hoje completa na próxima abertura, e um erro
   * de rede na tela de entrada só assustaria.
   */
  async restaurarDoServidor() {
    const { conectado, perfil } = get();
    if (!conectado || !perfil || !temSessao()) return;

    try {
      const remotos = await listarSnapshotsRemotos(perfil.id);
      if (remotos.length === 0) return;

      const locais = new Set((await readIndex()).map((i) => i.id));
      const faltando = remotos.filter((r) => !locais.has(r.id));
      if (faltando.length === 0) return;

      set({ envio: { situacao: 'enviando' } });

      /*
       * Do mais recente para o mais antigo: se a pessoa fechar o app no meio da
       * restauração, o que ela já tem é o que mais importa — o último import e o
       * anterior, que juntos já produzem o diff da tela principal.
       */
      const ordenados = [...faltando].sort(
        (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
      );

      let trazidos = 0;
      for (const remoto of ordenados) {
        const snapshot = await baixarSnapshot(perfil.id, remoto.id);
        await saveSnapshot(snapshot);
        trazidos += 1;
      }

      set({ envio: { situacao: 'restaurado', quantos: trazidos, em: Date.now() } });
    } catch {
      set({ envio: { situacao: 'ocioso' } });
    }
  },

  async enviarPendente() {
    const { conectado, perfil } = get();
    if (!conectado || !perfil || !temSessao()) return;

    // O mais recente do aparelho é o que interessa: se houver dois imports não
    // enviados, o anterior já está contido na história do último — mandar os dois
    // só criaria um snapshot intermediário que ninguém pediu.
    const indice = await readIndex();
    if (indice.length === 0) return;

    const maisRecente = indice[0];
    if ((await lerAjuste(CHAVE_ULTIMO_ENVIADO)) === maisRecente.id) return;

    const snapshot = await loadSnapshotLocal(maisRecente.id);
    if (snapshot) await get().sincronizar(snapshot);
  },

  limparErro() {
    set({ erro: null });
  },
}));

/**
 * Descobre o perfil ativo depois de entrar.
 *
 * Prefere o que já estava salvo neste aparelho; se ele não existir mais (foi
 * apagado em outro lugar), cai no primeiro da conta. Só fica sem perfil quem
 * ainda não criou nenhum — e aí a tela pede o @.
 */
async function carregarPerfil(set: (parcial: Partial<ContaState>) => void): Promise<void> {
  try {
    const perfis = await listarPerfis();
    if (perfis.length === 0) {
      set({ perfil: null });
      return;
    }
    const salvo = await lerPerfilSalvo();
    const escolhido = perfis.find((p) => p.id === salvo) ?? perfis[0];
    await salvarPerfil(escolhido.id);
    set({ perfil: escolhido });
  } catch {
    // Falhar aqui não desconecta: o token pode estar bom e a rede, ruim.
    set({ perfil: null });
  }
}

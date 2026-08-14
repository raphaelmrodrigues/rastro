/**
 * Conta do Rastro e sincronização — ambas opcionais.
 *
 * O app funciona inteiro sem isto. Quem não cria conta continua com tudo no
 * aparelho e não manda nada para lugar nenhum; é o modo privado, e ele é o
 * padrão de propósito. A conta existe para quem quer o mesmo histórico em mais
 * de um aparelho e as notificações.
 *
 * A decisão que atravessa este arquivo: **o import local nunca depende da rede**.
 * O snapshot é gravado no aparelho primeiro e o envio vem depois. Se o servidor
 * estiver fora, o import continua válido e o envio fica pendente — o contrário
 * (perder o import porque o Wi-Fi caiu) seria trocar a parte confiável do
 * produto pela parte frágil.
 */

import { create } from 'zustand';
import type { Snapshot } from '@rastro/core';
import { loadSnapshot as loadSnapshotLocal, readIndex } from './storage';
import {
  cadastrar as apiCadastrar,
  criarPerfil,
  entrar as apiEntrar,
  enviarSnapshot,
  ErroDeApi,
  excluirConta as apiExcluirConta,
  listarPerfis,
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

function lerPerfilSalvo(): string | null {
  return globalThis.localStorage?.getItem(CHAVE_PERFIL) ?? null;
}

function salvarPerfil(id: string | null): void {
  if (!globalThis.localStorage) return;
  if (id) globalThis.localStorage.setItem(CHAVE_PERFIL, id);
  else globalThis.localStorage.removeItem(CHAVE_PERFIL);
}

export type EstadoDeEnvio =
  | { situacao: 'ocioso' }
  | { situacao: 'enviando' }
  | { situacao: 'enviado'; duplicado: boolean; em: number }
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
    // Retoma o que ficou para trás numa falha de rede anterior. Sem `await`:
    // a abertura do app não espera a rede.
    void get().enviarPendente();
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
    salvarPerfil(null);
    globalThis.localStorage?.removeItem(CHAVE_ULTIMO_ENVIADO);
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
    await eraseEverything();
    salvarPerfil(null);
    globalThis.localStorage?.removeItem(CHAVE_ULTIMO_ENVIADO);

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
      salvarPerfil(perfil.id);
      set({ ocupado: false, perfil });
      // Quem já usava o app no modo local acabou de ganhar um destino para os
      // imports que ele fez antes de criar conta.
      void get().enviarPendente();
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
      globalThis.localStorage?.setItem(CHAVE_ULTIMO_ENVIADO, snapshot.id);
      set({
        envio: { situacao: 'enviado', duplicado: resultado.duplicate, em: Date.now() },
      });
    } catch (erro) {
      // O snapshot já está salvo no aparelho. Falha aqui é adiamento, não perda —
      // e a mensagem precisa dizer isso, senão o usuário acha que perdeu o import.
      set({ envio: { situacao: 'pendente', motivo: mensagemDe(erro) } });
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
    if (globalThis.localStorage?.getItem(CHAVE_ULTIMO_ENVIADO) === maisRecente.id) return;

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
    const salvo = lerPerfilSalvo();
    const escolhido = perfis.find((p) => p.id === salvo) ?? perfis[0];
    salvarPerfil(escolhido.id);
    set({ perfil: escolhido });
  } catch {
    // Falhar aqui não desconecta: o token pode estar bom e a rede, ruim.
    set({ perfil: null });
  }
}

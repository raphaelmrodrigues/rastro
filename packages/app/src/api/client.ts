/**
 * Cliente HTTP do Rastro.
 *
 * Resolve três coisas que, feitas na mão em cada tela, viram bug:
 *
 * 1. **Renovação transparente.** O access token dura 15 min. Quando uma chamada
 *    volta 401, o cliente renova e repete a chamada uma vez. A tela não sabe que
 *    isso aconteceu.
 * 2. **Uma renovação por vez.** Se cinco requisições expiram juntas — o que é o
 *    normal ao abrir o app —, uma renova e as outras esperam a mesma promessa.
 *    Cinco refreshes em paralelo com rotação ativa fariam o servidor tratar
 *    quatro deles como token reapresentado e derrubar a sessão inteira.
 * 3. **Timeout.** `fetch` no React Native não tem prazo por padrão: um 4G ruim
 *    deixa a promessa pendurada para sempre e a tela girando.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { Snapshot } from '@rastro/core';
import { apagarRefreshToken, guardarRefreshToken, lerRefreshToken } from './tokens';

/**
 * Versão do app, lida do app.json.
 *
 * Vai em toda requisição no cabeçalho `x-rastro-versao`. Existe por um motivo
 * que só aparece daqui a um ou dois anos: um app publicado nunca some do
 * aparelho de quem instalou, e sem a versão chegando ao servidor não há como
 * saber quem está rodando o quê — nem como pedir que atualize.
 *
 * Este é o tipo de coisa que precisa nascer na v1.0. Adicionar depois não
 * alcança as versões já instaladas, e aí a única forma de desligá-las seria
 * quebrar a API e deixar o app dar erro genérico na cara do usuário.
 */
export const VERSAO_DO_APP: string = Constants.expoConfig?.version ?? '0.0.0';

/**
 * URL da API.
 *
 * `EXPO_PUBLIC_API_URL` permite apontar para o servidor local durante o
 * desenvolvimento sem editar código. O padrão é produção porque é o que vale no
 * app instalado — e um app que aponta para localhost por engano na loja não
 * funciona para ninguém.
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? 'https://rastro.urlsnapshot.com'
).replace(/\/$/, '');

const TIMEOUT_MS = 30_000;
/** O import manda o snapshot inteiro; em rede móvel isso leva mais que 30 s. */
const TIMEOUT_IMPORT_MS = 180_000;

export class ErroDeApi extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/** Sessão acabou e não dá para renovar: a tela precisa mandar entrar de novo. */
export class SessaoExpirada extends Error {
  constructor() {
    super('Sua sessão expirou. Entre novamente.');
  }
}

/** O servidor desligou esta versão do app. Não adianta tentar de novo. */
export class PrecisaAtualizar extends Error {
  constructor() {
    super('Esta versão do Rastro não é mais aceita. Atualize o app para continuar.');
  }
}

interface Sessao {
  accessToken: string;
  userId: string;
}

let sessao: Sessao | null = null;
/** A renovação em curso, compartilhada por todas as chamadas que esbarrarem nela. */
let renovacaoEmCurso: Promise<string> | null = null;
let aoPerderSessao: (() => void) | null = null;
let aoPrecisarAtualizar: (() => void) | null = null;

/** A UI registra aqui o que fazer quando a sessão morre de vez. */
export function quandoPerderSessao(callback: () => void): void {
  aoPerderSessao = callback;
}

/** A UI registra aqui o que fazer quando o servidor desliga esta versão. */
export function quandoPrecisarAtualizar(callback: () => void): void {
  aoPrecisarAtualizar = callback;
}

export function usuarioAtual(): string | null {
  return sessao?.userId ?? null;
}

function rotuloDoAparelho(): { deviceLabel: string; platform: 'ios' | 'android' | 'web' } {
  const plataforma = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  return {
    deviceLabel: Platform.select({
      ios: 'iPhone',
      android: 'Android',
      default: 'Navegador',
    }) as string,
    platform: plataforma,
  };
}

async function comTimeout<T>(
  ms: number,
  executar: (sinal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), ms);
  try {
    return await executar(controlador.signal);
  } catch (erro) {
    if (controlador.signal.aborted) {
      throw new ErroDeApi(0, 'A conexão demorou demais.', 'Verifique sua internet e tente de novo.');
    }
    throw erro;
  } finally {
    clearTimeout(relogio);
  }
}

async function bruto(
  caminho: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const resposta = await comTimeout(timeoutMs, (signal) =>
    fetch(`${API_URL}${caminho}`, {
      ...init,
      signal,
      headers: {
        /*
         * `content-type` só quando há corpo.
         *
         * O Fastify recusa com 400 (FST_ERR_CTP_EMPTY_JSON_BODY) uma requisição
         * que se declara JSON e chega sem corpo. Mandar o cabeçalho sempre
         * quebrava o DELETE de exclusão de conta — e de um jeito traiçoeiro,
         * porque o erro falava de corpo vazio, não da rota.
         */
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-rastro-versao': VERSAO_DO_APP,
        ...(init.headers ?? {}),
      },
    }),
  );

  /*
   * 426 Upgrade Required: esta versão do app foi desligada pelo servidor.
   *
   * Tratado aqui, no ponto mais baixo, e não em cada chamada: a partir daqui
   * nada mais vai funcionar, e deixar cada tela lidar com isso significaria uma
   * tela esquecendo e mostrando "não foi possível falar com o servidor" — que
   * manda o usuário procurar problema na internet dele.
   */
  if (resposta.status === 426) {
    aoPrecisarAtualizar?.();
    throw new PrecisaAtualizar();
  }

  return resposta;
}

async function corpoDoErro(resposta: Response): Promise<ErroDeApi> {
  let mensagem = `Falha na comunicação (${resposta.status}).`;
  let hint: string | undefined;
  try {
    const json = (await resposta.json()) as { error?: string; hint?: string };
    if (json.error) mensagem = json.error;
    if (json.hint) hint = json.hint;
  } catch {
    // Resposta sem JSON (502 do proxy, por exemplo). A mensagem padrão serve.
  }
  return new ErroDeApi(resposta.status, mensagem, hint);
}

/**
 * Renova o access token. Uma só por vez — ver o item 2 do cabeçalho.
 */
async function renovar(): Promise<string> {
  if (renovacaoEmCurso) return renovacaoEmCurso;

  renovacaoEmCurso = (async () => {
    const refreshToken = await lerRefreshToken();
    if (!refreshToken) throw new SessaoExpirada();

    const resposta = await bruto(
      '/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken, ...rotuloDoAparelho() }) },
      TIMEOUT_MS,
    );

    if (!resposta.ok) {
      // 401 aqui é definitivo: o refresh era a última credencial que tínhamos.
      await encerrarSessaoLocal();
      throw new SessaoExpirada();
    }

    const dados = (await resposta.json()) as {
      accessToken: string;
      refreshToken: string;
      userId: string;
    };
    // Guardar o novo refresh ANTES de considerar a renovação concluída: se o app
    // morresse entre uma coisa e outra, o token salvo seria o já revogado.
    await guardarRefreshToken(dados.refreshToken);
    sessao = { accessToken: dados.accessToken, userId: dados.userId };
    return dados.accessToken;
  })().finally(() => {
    renovacaoEmCurso = null;
  });

  return renovacaoEmCurso;
}

async function encerrarSessaoLocal(): Promise<void> {
  sessao = null;
  await apagarRefreshToken();
  aoPerderSessao?.();
}

/**
 * Faz a chamada autenticada, renovando o token uma vez se necessário.
 *
 * Uma vez, e não em laço: se o token recém-renovado também for recusado, o
 * problema não é validade, e repetir só produziria um laço infinito contra o
 * servidor.
 */
async function autenticado<T>(
  caminho: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const chamar = async (token: string): Promise<Response> =>
    bruto(caminho, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } }, timeoutMs);

  let token = sessao?.accessToken ?? (await renovar());
  let resposta = await chamar(token);

  if (resposta.status === 401) {
    token = await renovar();
    resposta = await chamar(token);
  }

  if (!resposta.ok) throw await corpoDoErro(resposta);
  if (resposta.status === 204) return undefined as T;
  return (await resposta.json()) as T;
}

// --- Sessão ------------------------------------------------------------------

interface RespostaDeSessao {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

async function guardarSessao(dados: RespostaDeSessao): Promise<void> {
  await guardarRefreshToken(dados.refreshToken);
  sessao = { accessToken: dados.accessToken, userId: dados.userId };
}

export async function cadastrar(email: string, senha: string): Promise<void> {
  const resposta = await bruto(
    '/auth/register',
    { method: 'POST', body: JSON.stringify({ email, password: senha, ...rotuloDoAparelho() }) },
    TIMEOUT_MS,
  );
  if (!resposta.ok) throw await corpoDoErro(resposta);
  await guardarSessao((await resposta.json()) as RespostaDeSessao);
}

export async function entrar(email: string, senha: string): Promise<void> {
  const resposta = await bruto(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password: senha, ...rotuloDoAparelho() }) },
    TIMEOUT_MS,
  );
  if (!resposta.ok) throw await corpoDoErro(resposta);
  await guardarSessao((await resposta.json()) as RespostaDeSessao);
}

export async function sair(): Promise<void> {
  const refreshToken = await lerRefreshToken();
  if (refreshToken) {
    try {
      await bruto('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }, TIMEOUT_MS);
    } catch {
      // Servidor fora do ar não pode impedir o usuário de sair no aparelho dele.
      // O token local vai embora de qualquer forma; o do servidor expira sozinho.
    }
  }
  await encerrarSessaoLocal();
}

/**
 * Tenta restabelecer a sessão na abertura do app.
 *
 * Devolve `false` em silêncio quando não há sessão — isso é o estado normal de
 * quem usa o app só no modo local, e não é erro.
 */
export async function restaurarSessao(): Promise<boolean> {
  try {
    await renovar();
    return true;
  } catch {
    return false;
  }
}

export function temSessao(): boolean {
  return sessao !== null;
}

/**
 * Token de acesso atual, ou `null` quando não há sessão.
 *
 * Existe para a telemetria, que precisa funcionar **também** sem sessão: um erro
 * fatal antes do login é justamente o que mais importa saber. Por isso ela não
 * usa `autenticado()`, que exige token e renova sessão — um relato de falha não
 * pode disparar refresh nem falhar por falta de login.
 */
export function tokenAtual(): string | null {
  return sessao?.accessToken ?? null;
}

/**
 * Apaga a conta e tudo que está ligado a ela no servidor. Não tem volta.
 *
 * Oferecer isto dentro do app não é gentileza: Apple e Google exigem exclusão de
 * conta em qualquer app que permita criá-la, e a revisão reprova quem não tem.
 * O LGPD e o GDPR dizem a mesma coisa por outro caminho.
 *
 * A sessão local é encerrada mesmo se o servidor falhar depois do DELETE: nesse
 * ponto a conta já foi (ou não), e manter o token de uma conta possivelmente
 * inexistente só produziria erros confusos na próxima abertura.
 */
export async function excluirConta(): Promise<void> {
  /*
   * A sessão só é encerrada depois do sucesso, e isto não é detalhe de estilo.
   *
   * Numa versão anterior o `encerrarSessaoLocal` estava num `finally`: quando o
   * servidor recusava a exclusão, o app deslogava assim mesmo e voltava para a
   * tela de entrada — indistinguível de sucesso. A conta continuava existindo e
   * o usuário achava que tinha apagado. Falso positivo de exclusão é o pior
   * defeito possível aqui: quebra a promessa, a LGPD e a revisão da loja de uma
   * vez só. Se falhar, o erro precisa subir com a sessão intacta, para a tela
   * poder mostrar o que houve.
   */
  await autenticado('/auth/me', { method: 'DELETE' });
  await encerrarSessaoLocal();
}

// --- Recursos ----------------------------------------------------------------

export interface PerfilRemoto {
  id: string;
  handle: string;
}

export async function listarPerfis(): Promise<PerfilRemoto[]> {
  const { profiles } = await autenticado<{ profiles: PerfilRemoto[] }>('/auth/profiles');
  return profiles;
}

export async function criarPerfil(handle: string): Promise<PerfilRemoto> {
  const { profile } = await autenticado<{ profile: PerfilRemoto }>('/auth/profiles', {
    method: 'POST',
    body: JSON.stringify({ handle }),
  });
  return profile;
}

export interface ResultadoDeImport {
  jobId: string;
  duplicate: boolean;
  snapshotId: string | null;
  insights?: unknown;
  diff?: unknown;
  warnings?: unknown[];
  hint?: string;
}

/**
 * Envia um snapshot já processado no aparelho.
 *
 * É este o caminho que evita subir o zip: o `core` roda aqui, e o que viaja são
 * alguns MB de JSON em vez de centenas. `id` e `importedAt` não são enviados —
 * quem carimba os dois é o servidor.
 */
export async function enviarSnapshot(
  profileId: string,
  snapshot: {
    exportedAt?: number;
    format?: string;
    dataWindow?: { from: number; to: number };
    relationships: Record<string, Array<{ username: string; since: number; href?: string; displayName?: string }>>;
    warnings: Array<{ code: string; file?: string; detail: string }>;
  },
): Promise<ResultadoDeImport> {
  return autenticado<ResultadoDeImport>(
    `/profiles/${profileId}/snapshots/processed`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(snapshot.exportedAt !== undefined ? { exportedAt: snapshot.exportedAt } : {}),
        ...(snapshot.format ? { format: snapshot.format } : {}),
        ...(snapshot.dataWindow ? { dataWindow: snapshot.dataWindow } : {}),
        relationships: snapshot.relationships,
        warnings: snapshot.warnings,
      }),
    },
    TIMEOUT_IMPORT_MS,
  );
}

export interface ImportRemoto {
  id: string;
  status: string;
  bytes: number;
  snapshotId: string | null;
  error: string | null;
  createdAt: string;
}

export async function listarImports(profileId: string): Promise<ImportRemoto[]> {
  const { imports } = await autenticado<{ imports: ImportRemoto[] }>(
    `/profiles/${profileId}/snapshots/imports`,
  );
  return imports;
}

/** Uma linha do histórico remoto. O suficiente para saber o que falta baixar. */
export interface SnapshotRemoto {
  id: string;
  importedAt: string;
  followerCount: number;
  followingCount: number;
}

export async function listarSnapshotsRemotos(profileId: string): Promise<SnapshotRemoto[]> {
  const { snapshots } = await autenticado<{ snapshots: SnapshotRemoto[] }>(
    `/profiles/${profileId}/snapshots`,
  );
  return snapshots;
}

/**
 * Baixa um snapshot inteiro, com as listas.
 *
 * O par desta função é `enviarSnapshot`. Sem ela a conta era backup só de ida: os
 * arquivos subiam e nada descia, então "troque de aparelho sem perder nada" —
 * que o app promete no convite e no Perfil — não acontecia. O servidor sempre
 * teve o dado; faltava alguém pedir.
 */
export async function baixarSnapshot(profileId: string, snapshotId: string): Promise<Snapshot> {
  const { snapshot } = await autenticado<{ snapshot: Snapshot }>(
    `/profiles/${profileId}/snapshots/${snapshotId}/raw`,
  );
  return snapshot;
}

export interface AparelhoConectado {
  id: string;
  deviceLabel: string | null;
  platform: string | null;
  lastUsedAt: string;
}

export async function listarAparelhos(): Promise<AparelhoConectado[]> {
  const { sessions } = await autenticado<{ sessions: AparelhoConectado[] }>('/auth/sessions');
  return sessions;
}

export async function desconectarAparelho(id: string): Promise<void> {
  await autenticado(`/auth/sessions/${id}`, { method: 'DELETE' });
}

export async function sairDeTodosOsAparelhos(): Promise<number> {
  const { revogadas } = await autenticado<{ revogadas: number }>('/auth/sessions/revoke-all', {
    method: 'POST',
  });
  await encerrarSessaoLocal();
  return revogadas;
}

/** Diz se o servidor está no ar. Usado antes de oferecer o modo sincronizado. */
export async function servidorDisponivel(): Promise<boolean> {
  try {
    const resposta = await bruto('/health', { method: 'GET' }, 5_000);
    return resposta.ok;
  } catch {
    return false;
  }
}

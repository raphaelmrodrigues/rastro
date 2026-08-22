/**
 * Cliente da API OFICIAL do Instagram (Instagram API with Instagram Login).
 *
 * ## Leia isto antes de mexer
 *
 * Este é o único arquivo do projeto que fala com o Instagram, e ele só usa
 * endpoints públicos e documentados da Meta, com token OAuth que o usuário
 * concede na tela do próprio Instagram.
 *
 * O que este arquivo NÃO faz, e não pode passar a fazer:
 *
 *  - não pede, recebe ou guarda a senha do usuário (regra 1 do CLAUDE.md);
 *  - não usa `i.instagram.com`, nem endpoints de app móvel, nem cookie de sessão,
 *    nem qualquer coisa que exija `instagram-private-api` (regra 2);
 *  - não segue, deixa de seguir, curte, comenta nem manda mensagem (regra 4),
 *    mesmo tendo escopo que permitiria comentar e responder DM;
 *  - não tem como listar seguidores, porque a API oficial não expõe isso.
 *
 * Esse último ponto é o que define o modo conectado: **a lista de seguidores não
 * existe nesta API**, para ninguém. Daqui saem números, nunca nomes de quem
 * entrou ou saiu. Se algum dia alguém "resolver" essa limitação, terá trocado a
 * API oficial por API privada, e o preço é o banimento da conta do usuário — não
 * da nossa. Ver packages/core/src/metrics.ts.
 *
 * ## O que mudou em 22/08/2026
 *
 * Entraram os escopos de comentários e mensagens, por decisão do dono. Com eles
 * chegam **nomes**, mas de outra coisa: quem comentou no seu post, quem te
 * mandou DM. Isso não contradiz o parágrafo acima — continua não existindo lista
 * de seguidores — e não afrouxa a regra 4: os dois escopos autorizam responder,
 * ocultar e apagar, e **nada neste arquivo faz isso**. Só leitura.
 *
 * Esse conteúdo não passa por aqui: ele chega pelo webhook
 * (`routes/instagramWebhook.ts`) e é selado com a chave pública do aparelho
 * antes de tocar no banco. O servidor guarda sem poder ler — ver `lib/cofre.ts`.
 *
 * Documentação: https://developers.facebook.com/docs/instagram-platform
 */

const GRAPH = 'https://graph.instagram.com';
const OAUTH_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const OAUTH_TOKEN = 'https://api.instagram.com/oauth/access_token';
const API_VERSION = process.env.INSTAGRAM_API_VERSION ?? 'v23.0';

/**
 * Escopos pedidos.
 *
 * Os dois primeiros são o modo conectado original: contagem e insights. Os dois
 * últimos entraram em 22/08/2026, por decisão do dono, para as telas de
 * comentários recebidos e de mensagens sem marcar como vista.
 *
 * **O que continua fora, e não é por esquecimento:**
 * `instagram_business_content_publish`. Publicar é ação na conta do usuário —
 * regra 4 do CLAUDE.md, a mesma que recusou o unfollow em massa.
 *
 * E os dois últimos autorizam mais do que usamos: a API deixa responder, ocultar
 * e apagar comentário e mensagem. **Nenhuma função deste projeto faz isso.** Se
 * um dia aparecer aqui uma chamada de escrita, ela nasceu de um pedido que a
 * regra 4 recusa — não de uma necessidade técnica.
 */
export const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
] as const;

export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

function config() {
  const clientId = process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new InstagramApiError(
      'Modo conectado não configurado: faltam INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET ou INSTAGRAM_REDIRECT_URI.',
      503,
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function isConnectedModeConfigured(): boolean {
  return Boolean(
    process.env.INSTAGRAM_APP_ID &&
      process.env.INSTAGRAM_APP_SECRET &&
      process.env.INSTAGRAM_REDIRECT_URI,
  );
}

/** URL para onde o usuário é mandado para autorizar. `state` protege contra CSRF. */
export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
  });
  return `${OAUTH_AUTHORIZE}?${params.toString()}`;
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      (body as { error?: { message?: string } } | null)?.error?.message ?? response.statusText;
    throw new InstagramApiError(detail, response.status, body);
  }
  return body;
}

export interface TokenGrant {
  accessToken: string;
  /** ms UTC. */
  expiresAt: number;
  igUserId: string;
}

/**
 * Troca o `code` do redirect por um token de curta duração e já converte para o
 * de longa duração (60 dias). Guardar o de 1 hora não serve para nada: a coleta é
 * diária e em background, sem o usuário por perto para reautorizar.
 */
export async function exchangeCodeForToken(code: string): Promise<TokenGrant> {
  const { clientId, clientSecret, redirectUri } = config();

  const shortLived = (await request(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  })) as { access_token?: string; user_id?: string | number };

  if (!shortLived.access_token) {
    throw new InstagramApiError('O Instagram não devolveu um token.', 502, shortLived);
  }

  const longLived = (await request(
    `${GRAPH}/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: clientSecret,
      access_token: shortLived.access_token,
    })}`,
  )) as { access_token?: string; expires_in?: number };

  const token = longLived.access_token ?? shortLived.access_token;
  const expiresIn = longLived.expires_in ?? 3600;

  return {
    accessToken: token,
    expiresAt: Date.now() + expiresIn * 1000,
    igUserId: String(shortLived.user_id ?? ''),
  };
}

/**
 * Renova o token de longa duração. Só funciona se o token tiver ao menos 24h de
 * vida e ainda não tiver expirado — por isso a renovação roda bem antes do prazo.
 */
export async function refreshToken(accessToken: string): Promise<TokenGrant> {
  const refreshed = (await request(
    `${GRAPH}/refresh_access_token?${new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: accessToken,
    })}`,
  )) as { access_token?: string; expires_in?: number };

  if (!refreshed.access_token) {
    throw new InstagramApiError('Não foi possível renovar o acesso.', 502, refreshed);
  }

  return {
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + (refreshed.expires_in ?? 5_184_000) * 1000,
    igUserId: '',
  };
}

/** Perfil do usuário conectado. `followers_count` é o número — não vem lista. */
export async function fetchProfile(accessToken: string): Promise<unknown> {
  return request(
    `${GRAPH}/${API_VERSION}/me?${new URLSearchParams({
      fields: 'user_id,username,account_type,followers_count,follows_count,media_count',
      access_token: accessToken,
    })}`,
  );
}

/**
 * Métrica oficial de entradas e saídas do período.
 *
 * Exige conta profissional com 100+ seguidores; abaixo disso a Meta simplesmente
 * não devolve a métrica. O chamador trata a falha como "indisponível", não como
 * erro do app — é uma limitação da fonte, e a UI diz isso ao usuário.
 */
export async function fetchFollowsAndUnfollows(
  accessToken: string,
  since: Date,
  until: Date,
): Promise<unknown> {
  return request(
    `${GRAPH}/${API_VERSION}/me/insights?${new URLSearchParams({
      metric: 'follows_and_unfollows',
      metric_type: 'total_value',
      breakdown: 'follow_type',
      period: 'day',
      since: String(Math.floor(since.getTime() / 1000)),
      until: String(Math.floor(until.getTime() / 1000)),
      access_token: accessToken,
    })}`,
  );
}

/** Demografia agregada da audiência. Nunca individual — a API não expõe indivíduo. */
export async function fetchFollowerDemographics(
  accessToken: string,
  breakdown: 'country' | 'city' | 'age' | 'gender',
): Promise<unknown> {
  return request(
    `${GRAPH}/${API_VERSION}/me/insights?${new URLSearchParams({
      metric: 'follower_demographics',
      metric_type: 'total_value',
      period: 'lifetime',
      timeframe: 'this_month',
      breakdown,
      access_token: accessToken,
    })}`,
  );
}

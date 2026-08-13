/**
 * Modo conectado — API oficial do Instagram.
 *
 * Existe para responder à pergunta "dá para acompanhar sem esperar 48h pelo
 * export?". A resposta honesta é: em parte.
 *
 *   Sem arquivo, dá para saber QUANTOS seguidores você tem, QUANTOS entraram e
 *   QUANTOS saíram por dia, e de onde é seu público. Atualiza sozinho.
 *
 *   Sem arquivo, NÃO dá para saber QUEM saiu, QUEM entrou nem quem não te segue
 *   de volta. A API oficial não expõe a lista de seguidores para ninguém.
 *
 * Por isso este modo complementa o import, e não o substitui. A UI apresenta os
 * dois lado a lado, com essa diferença escrita — ver MODE_CAPABILITIES no core.
 *
 * Todo este módulo é opcional: sem as variáveis de ambiente do app da Meta, as
 * rotas respondem 503 e o resto do produto funciona igual.
 */

import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  buildDailySeries,
  parseAudienceBreakdown,
  parseFollowActivity,
  parseProfileSample,
  CONNECTED_MODE_REQUIREMENTS,
  MODE_CAPABILITIES,
} from '@rastro/core';
import { sql } from '../db/client.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { profileBelongsTo } from '../db/snapshots.js';
import {
  authorizeUrl,
  exchangeCodeForToken,
  fetchFollowerDemographics,
  fetchFollowsAndUnfollows,
  fetchProfile,
  InstagramApiError,
  isConnectedModeConfigured,
  refreshToken,
  SCOPES,
} from '../lib/instagramApi.js';

/**
 * `state` do OAuth, guardado em memória com prazo curto.
 *
 * Fica em memória de propósito: é efêmero (minutos) e não é dado do usuário.
 * Com mais de uma instância da API, trocar por Redis — senão o callback cai numa
 * instância que não conhece o state e a conexão falha.
 */
const pendingStates = new Map<string, { profileId: string; userId: string; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function rememberState(profileId: string, userId: string): string {
  const state = randomUUID();
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (now - value.createdAt > STATE_TTL_MS) pendingStates.delete(key);
  }
  pendingStates.set(state, { profileId, userId, createdAt: now });
  return state;
}

/** Renova o token quando faltam menos de 7 dias, e devolve o token válido. */
async function usableToken(profileId: string): Promise<string | null> {
  const [account] = await sql`
    SELECT access_token_enc, token_expires_at FROM connected_accounts
    WHERE profile_id = ${profileId}
  `;
  if (!account) return null;

  const token = decryptSecret(account.access_token_enc);
  const expiresAt = new Date(account.token_expires_at).getTime();
  const sevenDays = 7 * 24 * 3600 * 1000;

  if (expiresAt - Date.now() > sevenDays) return token;

  try {
    const grant = await refreshToken(token);
    await sql`
      UPDATE connected_accounts
      SET access_token_enc = ${encryptSecret(grant.accessToken)},
          token_expires_at = ${new Date(grant.expiresAt)},
          last_error = NULL
      WHERE profile_id = ${profileId}
    `;
    return grant.accessToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha ao renovar';
    await sql`UPDATE connected_accounts SET last_error = ${message} WHERE profile_id = ${profileId}`;
    // Token velho ainda pode funcionar até expirar de fato.
    return expiresAt > Date.now() ? token : null;
  }
}

/**
 * Coleta uma amostra do perfil e a atividade do dia.
 * Chamada no connect, no refresh manual e pelo agendador diário.
 */
export async function collectMetrics(profileId: string): Promise<{ sampled: boolean }> {
  const token = await usableToken(profileId);
  if (!token) return { sampled: false };

  const now = new Date();
  const profile = await fetchProfile(token);
  const sample = parseProfileSample(profile, now.getTime());

  // Amostra sem contagem é amostra falsa: gravada, vira um despencar no gráfico.
  if (!sample) return { sampled: false };

  await sql`
    INSERT INTO profile_metrics (profile_id, sampled_at, follower_count, follows_count, media_count)
    VALUES (${profileId}, ${now}, ${sample.followerCount}, ${sample.followsCount ?? null}, ${sample.mediaCount ?? null})
    ON CONFLICT (profile_id, sampled_at) DO NOTHING
  `;

  // Insights são opcionais: conta com menos de 100 seguidores não recebe a métrica,
  // e isso não é erro — é limite da fonte. A contagem acima já foi gravada.
  try {
    const since = new Date(now.getTime() - 24 * 3600 * 1000);
    const raw = await fetchFollowsAndUnfollows(token, since, now);
    const activity = parseFollowActivity(raw, since.toISOString().slice(0, 10));
    await sql`
      INSERT INTO follow_activity (profile_id, day, follows, unfollows)
      VALUES (${profileId}, ${activity.day}, ${activity.follows}, ${activity.unfollows})
      ON CONFLICT (profile_id, day) DO UPDATE
      SET follows = EXCLUDED.follows, unfollows = EXCLUDED.unfollows
    `;
  } catch {
    // Silêncio aqui é proposital e limitado: a falha de insights não invalida a
    // amostra de contagem, e a UI mostra a série mesmo sem a métrica de atividade.
  }

  await sql`UPDATE connected_accounts SET last_sync_at = ${now}, last_error = NULL WHERE profile_id = ${profileId}`;
  return { sampled: true };
}

export const instagramRoutes: FastifyPluginAsync = async (app) => {
  /**
   * O que cada modo entrega. Público e sem autenticação de propósito: é a
   * informação que o usuário precisa para escolher, e ela não depende de conta.
   */
  app.get('/modes', async () => ({
    capabilities: MODE_CAPABILITIES,
    connectedMode: {
      available: isConnectedModeConfigured(),
      requirements: CONNECTED_MODE_REQUIREMENTS,
      scopes: SCOPES,
      /** A frase que não pode sumir da tela. */
      limitation:
        'O modo conectado mostra quantos seguidores entraram e saíram, nunca quem. ' +
        'A lista com nomes só existe no arquivo de export.',
    },
  }));

  /** Início do fluxo: devolve a URL do Instagram para onde mandar o usuário. */
  app.post(
    '/profiles/:profileId/connect',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      if (!isConnectedModeConfigured()) {
        return reply.code(503).send({
          error: 'O modo conectado não está configurado neste servidor.',
        });
      }

      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      return { authorizeUrl: authorizeUrl(rememberState(profileId, sub)) };
    },
  );

  /**
   * Callback do OAuth. O Instagram redireciona o navegador para cá com `code`.
   * Não tem JWT: quem chega aqui é o navegador do usuário vindo do Instagram —
   * a autorização é provada pelo `state` que emitimos no passo anterior.
   */
  app.get('/callback', async (req, reply) => {
    const query = z
      .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() })
      .safeParse(req.query);

    if (!query.success || !query.data.state) {
      return reply.code(400).send({ error: 'Retorno inválido do Instagram.' });
    }
    if (query.data.error || !query.data.code) {
      return reply.code(400).send({ error: 'Autorização cancelada.' });
    }

    const pending = pendingStates.get(query.data.state);
    pendingStates.delete(query.data.state);
    if (!pending || Date.now() - pending.createdAt > STATE_TTL_MS) {
      return reply.code(400).send({ error: 'Esta autorização expirou. Tente conectar de novo.' });
    }

    try {
      const grant = await exchangeCodeForToken(query.data.code);
      const profile = (await fetchProfile(grant.accessToken)) as {
        user_id?: string;
        username?: string;
      };

      await sql`
        INSERT INTO connected_accounts (
          profile_id, ig_user_id, username, access_token_enc, token_expires_at, scopes
        ) VALUES (
          ${pending.profileId},
          ${String(profile.user_id ?? grant.igUserId)},
          ${profile.username ?? ''},
          ${encryptSecret(grant.accessToken)},
          ${new Date(grant.expiresAt)},
          ${SCOPES.join(',')}
        )
        ON CONFLICT (profile_id) DO UPDATE SET
          ig_user_id = EXCLUDED.ig_user_id,
          username = EXCLUDED.username,
          access_token_enc = EXCLUDED.access_token_enc,
          token_expires_at = EXCLUDED.token_expires_at,
          scopes = EXCLUDED.scopes,
          last_error = NULL
      `;

      await collectMetrics(pending.profileId);
      return { connected: true, username: profile.username };
    } catch (error) {
      if (error instanceof InstagramApiError) {
        return reply.code(502).send({ error: `O Instagram recusou a conexão: ${error.message}` });
      }
      throw error;
    }
  });

  /** Estado da conexão e a série de contagem coletada até agora. */
  app.get(
    '/profiles/:profileId/metrics',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      const [account] = await sql`
        SELECT username, connected_at, last_sync_at, last_error, token_expires_at
        FROM connected_accounts WHERE profile_id = ${profileId}
      `;
      if (!account) {
        return reply.code(409).send({ error: 'Este perfil não está conectado.' });
      }

      const samples = await sql`
        SELECT sampled_at, follower_count, follows_count, media_count
        FROM profile_metrics WHERE profile_id = ${profileId}
        ORDER BY sampled_at ASC
      `;
      const activity = await sql`
        SELECT day, follows, unfollows FROM follow_activity
        WHERE profile_id = ${profileId} ORDER BY day ASC
      `;

      const series = buildDailySeries(
        samples.map((row) => ({
          at: new Date(row.sampled_at).getTime(),
          followerCount: row.follower_count,
          ...(row.follows_count != null ? { followsCount: row.follows_count } : {}),
          ...(row.media_count != null ? { mediaCount: row.media_count } : {}),
        })),
      );

      return {
        account: {
          username: account.username,
          connectedAt: new Date(account.connected_at).getTime(),
          lastSyncAt: account.last_sync_at ? new Date(account.last_sync_at).getTime() : null,
          lastError: account.last_error,
          tokenExpiresAt: new Date(account.token_expires_at).getTime(),
        },
        series,
        activity: activity.map((row) => ({
          day: typeof row.day === 'string' ? row.day : new Date(row.day).toISOString().slice(0, 10),
          follows: row.follows,
          unfollows: row.unfollows,
        })),
        /** Repetido na resposta de propósito: a tela não pode omitir o limite. */
        limitation:
          'Estes números não vêm acompanhados de nomes. A API do Instagram não ' +
          'informa quem entrou ou saiu — só quantos.',
      };
    },
  );

  /** Coleta sob demanda ("atualizar agora"). */
  app.post(
    '/profiles/:profileId/sync',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      try {
        const result = await collectMetrics(profileId);
        if (!result.sampled) {
          return reply.code(409).send({
            error: 'Não foi possível ler os dados. Reconecte a conta.',
          });
        }
        return result;
      } catch (error) {
        if (error instanceof InstagramApiError) {
          return reply.code(502).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  /** Demografia agregada da audiência. */
  app.get(
    '/profiles/:profileId/audience',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      const token = await usableToken(profileId);
      if (!token) return reply.code(409).send({ error: 'Este perfil não está conectado.' });

      const dimensions = ['country', 'city', 'age', 'gender'] as const;
      const breakdowns = [];
      for (const dimension of dimensions) {
        try {
          breakdowns.push(parseAudienceBreakdown(await fetchFollowerDemographics(token, dimension), dimension));
        } catch {
          // Conta com menos de 100 seguidores não recebe demografia. Não é erro.
        }
      }

      if (breakdowns.length === 0) {
        return reply.code(409).send({
          error: 'A demografia ainda não está disponível.',
          hint: 'O Instagram só libera esses dados para contas profissionais com 100 seguidores ou mais.',
        });
      }

      return { breakdowns };
    },
  );

  /** Desconectar: apaga o token. As métricas já coletadas ficam com o usuário. */
  app.delete(
    '/profiles/:profileId/connect',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      await sql`DELETE FROM connected_accounts WHERE profile_id = ${profileId}`;
      return reply.code(204).send();
    },
  );
};

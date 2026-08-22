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

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
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
import { chavePublicaValida } from '../lib/cofre.js';
import { profileBelongsTo } from '../db/snapshots.js';
import { avisarSeCaiu } from '../lib/quedaDeSeguidores.js';
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

  /*
   * A contagem anterior é lida ANTES do INSERT — depois dele a "anterior" seria
   * a de agora, e nenhuma queda seria detectada nunca.
   */
  const [anterior] = await sql`
    SELECT follower_count FROM profile_metrics
    WHERE profile_id = ${profileId}
    ORDER BY sampled_at DESC LIMIT 1
  `;

  await sql`
    INSERT INTO profile_metrics (profile_id, sampled_at, follower_count, follows_count, media_count)
    VALUES (${profileId}, ${now}, ${sample.followerCount}, ${sample.followsCount ?? null}, ${sample.mediaCount ?? null})
    ON CONFLICT (profile_id, sampled_at) DO NOTHING
  `;

  // Depois de gravar, e sem `await` que possa derrubar a coleta: a série é o
  // produto, o aviso é acessório. Ver lib/push.ts.
  if (anterior) {
    void avisarSeCaiu(profileId, anterior.follower_count, sample.followerCount, now);
  }

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

/**
 * A página que o usuário vê ao voltar do Instagram.
 *
 * Autocontida e minúscula de propósito: sem CSS externo, sem fonte da rede, sem
 * script. Ela abre no navegador do celular, muitas vezes em rede ruim logo
 * depois de uma autorização — qualquer coisa que dependa de um segundo request
 * é uma chance a mais de a pessoa ver página quebrada e achar que falhou.
 *
 * As cores são as do app (`packages/app/src/lib/theme.ts`) escritas à mão. É
 * duplicação consciente, como a do gerador de ícones: este arquivo roda no
 * servidor e não pode importar o tema do app.
 */
function pagina(
  reply: FastifyReply,
  status: number,
  tom: 'ok' | 'erro',
  titulo: string,
  corpo: string,
): FastifyReply {
  const cor = tom === 'ok' ? '#8B5CF6' : '#F4536A';
  const escapar = (t: string) =>
    t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  return reply
    .code(status)
    .type('text/html; charset=utf-8')
    .send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)} · Rastro</title>
<style>
  :root { color-scheme: dark }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0B0B10; color: #F1F1F7; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 380px; text-align: center }
  .marca { width: 44px; height: 44px; margin: 0 auto 24px; border-radius: 14px; background: ${cor} }
  h1 { font-size: 22px; margin: 0 0 12px; letter-spacing: -0.4px }
  p { font-size: 15px; line-height: 1.5; color: #9B9BB0; margin: 0 }
</style>
</head>
<body>
  <main>
    <div class="marca"></div>
    <h1>${escapar(titulo)}</h1>
    <p>${escapar(corpo)}</p>
  </main>
</body>
</html>`);
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
   *
   * **Responde HTML, não JSON.** É a única rota da API que um usuário final vê
   * com os próprios olhos: ele sai do app, autoriza no Instagram e o navegador
   * pousa aqui. Uma tela branca com `{"connected":true}` deixa a pessoa sem
   * saber se deu certo nem o que fazer em seguida — e o que ela precisa fazer é
   * justamente uma coisa que a página tem de dizer: voltar para o app.
   */
  app.get('/callback', async (req, reply) => {
    const query = z
      .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() })
      .safeParse(req.query);

    if (!query.success || !query.data.state) {
      return pagina(reply, 400, 'erro', 'Retorno inválido', 'O Instagram devolveu uma resposta que não reconhecemos.');
    }
    if (query.data.error || !query.data.code) {
      return pagina(reply, 400, 'erro', 'Autorização cancelada', 'Nada foi conectado. Você pode tentar de novo pelo app quando quiser.');
    }

    const pending = pendingStates.get(query.data.state);
    pendingStates.delete(query.data.state);
    if (!pending || Date.now() - pending.createdAt > STATE_TTL_MS) {
      return pagina(reply, 400, 'erro', 'Esta autorização expirou', 'Passou tempo demais entre abrir e concluir. Volte ao app e toque em conectar de novo.');
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
      return pagina(
        reply,
        200,
        'ok',
        'Conta conectada',
        profile.username
          ? `O Rastro está acompanhando @${profile.username}. Pode fechar esta aba e voltar ao app.`
          : 'Pode fechar esta aba e voltar ao app.',
      );
    } catch (error) {
      if (error instanceof InstagramApiError) {
        return pagina(
          reply,
          502,
          'erro',
          'O Instagram recusou a conexão',
          `${error.message} Se a sua conta não for Profissional (Business ou Creator), é por isso — a conversão é gratuita e reversível nas configurações do Instagram.`,
        );
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

  /* ------------------------------------------------------------------ */
  /* Conteúdo selado: chave, mensagens e comentários                     */

  /**
   * O aparelho registra a chave pública com que o servidor vai selar tudo.
   *
   * Sem esta chamada o webhook **descarta** os eventos, e é para descartar
   * mesmo: guardar em claro "só até o app registrar" é como toda promessa de
   * criptografia morre. Ver lib/cofre.ts.
   */
  app.put(
    '/profiles/:profileId/key',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      const corpo = z.object({ publicKey: z.string().min(40).max(100) }).strict().safeParse(req.body);
      if (!corpo.success || !chavePublicaValida(corpo.data.publicKey)) {
        return reply.code(400).send({ error: 'Chave pública inválida.' });
      }

      const [atual] = await sql`SELECT public_key FROM profile_keys WHERE profile_id = ${profileId}`;
      const trocou = atual !== undefined && atual.public_key !== corpo.data.publicKey;

      await sql`
        INSERT INTO profile_keys (profile_id, public_key)
        VALUES (${profileId}, ${corpo.data.publicKey})
        ON CONFLICT (profile_id) DO UPDATE
        SET public_key = EXCLUDED.public_key, rotated_at = now()
      `;

      /*
       * Chave nova, histórico velho vai fora.
       *
       * O que foi selado para a chave anterior não abre com a nova — é o preço
       * da ponta a ponta, e é o que acontece quando a pessoa troca de celular.
       * Guardar bytes que ninguém mais consegue ler seria ocupar espaço com
       * lixo indecifrável e fingir que o histórico continua lá.
       */
      if (trocou) {
        await sql`DELETE FROM instagram_messages WHERE profile_id = ${profileId}`;
        await sql`DELETE FROM instagram_comments WHERE profile_id = ${profileId}`;
      }

      return { ok: true, descartouHistorico: trocou };
    },
  );

  /**
   * As mensagens que chegaram desde a conexão, seladas.
   *
   * O servidor devolve o que não sabe ler. Quem abre é o aparelho.
   */
  app.get(
    '/profiles/:profileId/messages',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      const linhas = await sql`
        SELECT message_id, thread_id, from_self, sent_at, payload_enc
        FROM instagram_messages
        WHERE profile_id = ${profileId} AND expires_at > now()
        ORDER BY sent_at DESC
        LIMIT 500
      `;

      return {
        messages: linhas.map((l) => ({
          id: l.message_id,
          threadId: l.thread_id,
          fromSelf: l.from_self,
          at: new Date(l.sent_at).getTime(),
          sealed: l.payload_enc,
        })),
        /** A frase que a tela não pode omitir. */
        limitation:
          'Só aparecem mensagens que chegaram depois de você conectar. A API do ' +
          'Instagram não entrega conversas antigas.',
      };
    },
  );

  /** Comentários recebidos, selados. O espelho do que o export não traz. */
  app.get(
    '/profiles/:profileId/comments',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }

      const linhas = await sql`
        SELECT comment_id, media_id, parent_id, from_self, created_at, payload_enc
        FROM instagram_comments
        WHERE profile_id = ${profileId} AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 500
      `;

      return {
        comments: linhas.map((l) => ({
          id: l.comment_id,
          mediaId: l.media_id,
          parentId: l.parent_id,
          fromSelf: l.from_self,
          at: new Date(l.created_at).getTime(),
          sealed: l.payload_enc,
        })),
      };
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
      /*
       * Desconectar apaga o conteúdo junto. As métricas são números do próprio
       * usuário e ficam; mensagem e comentário são conversa de outras pessoas,
       * e não há motivo para sobreviverem ao fim da autorização que os trouxe.
       */
      await sql`DELETE FROM instagram_messages WHERE profile_id = ${profileId}`;
      await sql`DELETE FROM instagram_comments WHERE profile_id = ${profileId}`;
      return reply.code(204).send();
    },
  );
};

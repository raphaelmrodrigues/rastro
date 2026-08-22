/**
 * Aparelhos e preferências de aviso.
 *
 * O que o app precisa para receber "você perdeu N seguidores": registrar o token
 * de push do aparelho, e poder desligar o aviso sem desinstalar. As tabelas já
 * existiam desde a migração 002; o que faltava era alguém chamá-las.
 *
 * O token de push não é segredo — ele identifica o aparelho, não autentica
 * ninguém —, mas continua sendo dado de usuário: só é aceito com JWT válido, e
 * some junto com a conta pelo `ON DELETE CASCADE`.
 *
 * O que sai por push está em `lib/push.ts`, e o resumo é: número, nunca nome.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { profileBelongsTo } from '../db/snapshots.js';
import { lerPreferencias } from '../lib/push.js';

const aparelhoSchema = z
  .object({
    /**
     * `ExponentPushToken[...]` ou `ExpoPushToken[...]`. Validado por forma para o
     * banco não encher de string vazia vinda de um aparelho sem permissão.
     */
    token: z.string().min(10).max(255),
    platform: z.enum(['ios', 'android', 'web']),
    appVersion: z.string().max(32).optional(),
    /** IANA, ex.: 'America/Sao_Paulo'. Usado só para a faixa de silêncio. */
    timezone: z.string().max(64).optional(),
  })
  .strict();

const prefsSchema = z
  .object({
    quedaSeguidores: z.boolean().optional(),
    quedaMinima: z.number().int().min(1).max(1000).optional(),
    silencioInicioHora: z.number().int().min(0).max(23).optional(),
    silencioFimHora: z.number().int().min(0).max(23).optional(),
  })
  .strict();

export const avisosRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Registra (ou reafirma) o aparelho.
   *
   * `ON CONFLICT` no token e não no par usuário+token: o mesmo aparelho pode
   * trocar de dono quando alguém sai da conta e outra pessoa entra, e duas
   * linhas com o mesmo token fariam o push sair em duplicata.
   *
   * Reabilita o aparelho ao reaparecer: quem reinstalou o app depois de ter sido
   * marcado como `DeviceNotRegistered` volta a receber.
   */
  app.post(
    '/devices',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const corpo = aparelhoSchema.safeParse(req.body);
      if (!corpo.success) {
        return reply.code(400).send({ error: 'Dados do aparelho inválidos.' });
      }
      const { sub } = req.user as { sub: string };
      const { token, platform, appVersion, timezone } = corpo.data;

      await sql`
        INSERT INTO devices (user_id, expo_push_token, platform, app_version, timezone)
        VALUES (${sub}, ${token}, ${platform}, ${appVersion ?? null}, ${timezone ?? null})
        ON CONFLICT (expo_push_token) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          platform = EXCLUDED.platform,
          app_version = EXCLUDED.app_version,
          timezone = EXCLUDED.timezone,
          last_seen_at = now(),
          disabled_at = NULL,
          disabled_reason = NULL
      `;
      return reply.code(204).send();
    },
  );

  /** O usuário desligou as notificações no aparelho: esquecemos o token. */
  app.delete(
    '/devices',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const corpo = z.object({ token: z.string().min(10).max(255) }).strict().safeParse(req.body);
      if (!corpo.success) return reply.code(400).send({ error: 'Token inválido.' });
      const { sub } = req.user as { sub: string };
      await sql`
        DELETE FROM devices WHERE user_id = ${sub} AND expo_push_token = ${corpo.data.token}
      `;
      return reply.code(204).send();
    },
  );

  app.get(
    '/profiles/:profileId/prefs',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }
      return lerPreferencias(profileId);
    },
  );

  app.patch(
    '/profiles/:profileId/prefs',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { profileId } = req.params as { profileId: string };
      const { sub } = req.user as { sub: string };
      if (!(await profileBelongsTo(profileId, sub))) {
        return reply.code(404).send({ error: 'Perfil não encontrado.' });
      }
      const corpo = prefsSchema.safeParse(req.body);
      if (!corpo.success) return reply.code(400).send({ error: 'Preferências inválidas.' });

      /*
       * Lê o que existe e regrava o conjunto inteiro. Um UPDATE com colunas
       * opcionais viraria SQL montado por string, e a alternativa (`COALESCE` em
       * cada coluna) repete o nome de cada campo três vezes — aqui há quatro, e
       * a próxima que alguém esquecer passa despercebida.
       */
      const atual = await lerPreferencias(profileId);
      const novo = { ...atual, ...corpo.data };

      await sql`
        INSERT INTO notification_prefs (
          profile_id, queda_seguidores, queda_minima, silencio_inicio_hora, silencio_fim_hora
        ) VALUES (
          ${profileId}, ${novo.quedaSeguidores}, ${novo.quedaMinima},
          ${novo.silencioInicioHora}, ${novo.silencioFimHora}
        )
        ON CONFLICT (profile_id) DO UPDATE SET
          queda_seguidores = EXCLUDED.queda_seguidores,
          queda_minima = EXCLUDED.queda_minima,
          silencio_inicio_hora = EXCLUDED.silencio_inicio_hora,
          silencio_fim_hora = EXCLUDED.silencio_fim_hora
      `;
      return novo;
    },
  );
};

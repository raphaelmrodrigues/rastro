/**
 * Recebe relatos de falha do app.
 *
 * Duas coisas chegam aqui: import que terminou com avisos do parser, e erro
 * fatal que derrubou uma tela. As duas existem pelo mesmo motivo — descobrir que
 * algo quebrou **antes** do usuário reclamar na loja.
 *
 * ## O que este endpoint recusa a guardar
 *
 * Nada de conteúdo de snapshot. O schema abaixo é fechado (`.strict()`) e os
 * campos são código, nome de arquivo e contagem. Não existe campo de texto livre
 * vindo do parser — o `detail` de um `ParseWarning` traz o @ da pessoa dentro da
 * frase, e aceitar esse texto transformaria a tabela de diagnóstico num vazamento
 * lento. Ver a migração 004.
 *
 * ## Por que aceita sem autenticação
 *
 * Um crash pode acontecer antes de o usuário conseguir entrar — e é justamente
 * esse crash que mais interessa. O token é usado quando existe, e ignorado
 * quando não. Em troca, o limite de requisições aqui é baixo.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/client.js';

/** Corta texto que possa vir grande demais e ocupar a tabela à toa. */
const texto = (max: number) => z.string().trim().max(max);

const avisoSchema = z
  .object({
    code: texto(40),
    file: texto(200).optional(),
    count: z.number().int().min(1).max(100_000),
  })
  .strict();

const parseSchema = z
  .object({
    kind: z.literal('parse'),
    appVersion: texto(20).optional(),
    platform: z.enum(['ios', 'android', 'web']).optional(),
    /* Só forma e volume. Nenhum @ atravessa. */
    warnings: z.array(avisoSchema).max(50),
    format: z.enum(['json', 'html', 'mixed']).optional(),
    followers: z.number().int().min(0).optional(),
    following: z.number().int().min(0).optional(),
    files: z.number().int().min(0).optional(),
  })
  .strict();

const crashSchema = z
  .object({
    kind: z.literal('crash'),
    appVersion: texto(20).optional(),
    platform: z.enum(['ios', 'android', 'web']).optional(),
    name: texto(120),
    /*
     * A mensagem é o único texto livre aceito, e vem truncada.
     *
     * É um risco calculado: mensagem de erro pode, em teoria, carregar um
     * trecho de dado do usuário. Sem ela, porém, um relato de crash não diz o
     * que aconteceu e a telemetria não serve para nada. O app já sanitiza antes
     * de mandar (ver lib/telemetria.ts).
     */
    message: texto(500),
    stack: texto(4000).optional(),
    screen: texto(60).optional(),
  })
  .strict();

/**
 * Exportado para teste.
 *
 * A propriedade que os testes travam é `.strict()`: qualquer campo a mais no
 * corpo derruba o relato inteiro. É o que impede um `detail` de warning — que é
 * texto livre e carrega o @ da pessoa — de entrar por engano numa versão futura
 * do app. Se alguém trocar `.strict()` por `.passthrough()`, o teste quebra.
 */
export const corpoSchema = z.discriminatedUnion('kind', [parseSchema, crashSchema]);

export const telemetriaRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/reports',
    {
      config: {
        /*
         * Limite próprio e apertado: este endpoint aceita corpo sem autenticação,
         * então é o candidato natural a virar lixeira de spam.
         */
        rateLimit: { max: Number(process.env.RATE_LIMIT_REPORTS ?? 20), timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const parsed = corpoSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Relato em formato inesperado.' });
      }
      const corpo = parsed.data;

      // O token é bônus, não requisito: se veio e é válido, amarra o relato ao
      // usuário; se não, o relato entra anônimo em vez de ser recusado.
      let userId: string | null = null;
      try {
        await req.jwtVerify();
        userId = (req.user as { sub?: string } | undefined)?.sub ?? null;
      } catch {
        userId = null;
      }

      const detail =
        corpo.kind === 'parse'
          ? {
              warnings: corpo.warnings,
              format: corpo.format ?? null,
              followers: corpo.followers ?? null,
              following: corpo.following ?? null,
              files: corpo.files ?? null,
            }
          : {
              name: corpo.name,
              message: corpo.message,
              stack: corpo.stack ?? null,
              screen: corpo.screen ?? null,
            };

      await sql`
        INSERT INTO app_reports (kind, app_version, platform, user_id, detail)
        VALUES (
          ${corpo.kind},
          ${corpo.appVersion ?? null},
          ${corpo.platform ?? null},
          ${userId},
          ${sql.json(detail)}
        )
      `;

      // 204: o app não faz nada com a resposta, e um corpo aqui só gastaria
      // dados de quem já está com o app quebrado.
      return reply.code(204).send();
    },
  );
};

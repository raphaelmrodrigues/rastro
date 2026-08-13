/**
 * Autenticação do Rastro.
 *
 * IMPORTANTE: esta é a conta do usuário NO RASTRO (e-mail + senha nossa).
 * Não existe login com a senha do Instagram aqui, e não deve passar a existir —
 * é a regra 1 do CLAUDE.md, e é o que separa este app dos que queimam a conta
 * de quem os usa.
 *
 * O modo conectado (routes/instagram.ts) é outra coisa: lá o usuário autentica no
 * site do próprio Instagram e nós recebemos um token revogável. Em momento nenhum
 * a senha dele passa por aqui.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Use pelo menos 10 caracteres.'),
});

/** Tempo de vida do token de acesso. Curto porque dá acesso a dados sensíveis. */
const TOKEN_TTL = '7d';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos.', issues: parsed.error.issues });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const passwordHash = await hashPassword(parsed.data.password);

    const [user] = await sql`
      INSERT INTO users (email, password_hash) VALUES (${email}, ${passwordHash})
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;

    if (!user) {
      // Mensagem deliberadamente igual à do login: dizer "e-mail já cadastrado"
      // transforma o registro num verificador de quem tem conta aqui.
      return reply.code(409).send({ error: 'Não foi possível criar a conta com esses dados.' });
    }

    const token = app.jwt.sign({ sub: user.id }, { expiresIn: TOKEN_TTL });
    return reply.code(201).send({ token, userId: user.id });
  });

  app.post('/login', async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos.' });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const [user] = await sql`
      SELECT id, password_hash FROM users
      WHERE email = ${email} AND deleted_at IS NULL
    `;

    // Verificar mesmo sem usuário, contra um hash descartável: sem isso, o tempo
    // de resposta denuncia quais e-mails existem no banco.
    const stored = user?.password_hash ?? (await hashPassword('conta-inexistente'));
    const ok = await verifyPassword(parsed.data.password, stored);

    if (!user || !ok) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos.' });
    }

    const token = app.jwt.sign({ sub: user.id }, { expiresIn: TOKEN_TTL });
    return { token, userId: user.id };
  });

  /** Cria um perfil (o @ que se quer acompanhar) para o usuário logado. */
  app.post('/profiles', { onRequest: [async (req) => req.jwtVerify()] }, async (req, reply) => {
    const body = z.object({ handle: z.string().min(1).max(30) }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Informe o @ do perfil.' });
    }

    const { sub } = req.user as { sub: string };
    const handle = body.data.handle.trim().replace(/^@/, '').toLowerCase();

    const [profile] = await sql`
      INSERT INTO profiles (user_id, handle) VALUES (${sub}, ${handle})
      ON CONFLICT (user_id, handle) DO UPDATE SET handle = EXCLUDED.handle
      RETURNING id, handle
    `;

    return reply.code(201).send({ profile });
  });

  app.get('/profiles', { onRequest: [async (req) => req.jwtVerify()] }, async (req) => {
    const { sub } = req.user as { sub: string };
    const profiles = await sql`
      SELECT id, handle, created_at FROM profiles WHERE user_id = ${sub} ORDER BY created_at
    `;
    return { profiles };
  });

  /**
   * Exclusão de conta. Requisito das lojas e do LGPD/GDPR, não é opcional.
   *
   * Apaga de verdade, em cascata (ON DELETE CASCADE cobre perfis, snapshots,
   * entries, eventos e tokens do modo conectado). Nada de `deleted_at` como
   * desculpa para manter os dados: quem pede exclusão quer os dados fora daqui.
   */
  app.delete('/me', { onRequest: [async (req) => req.jwtVerify()] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    await sql`DELETE FROM users WHERE id = ${sub}`;
    return reply.code(204).send();
  });
};

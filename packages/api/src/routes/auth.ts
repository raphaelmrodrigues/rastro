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

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import {
  ACCESS_TTL,
  abrirSessao,
  listarSessoes,
  revogarPorId,
  revogarSessao,
  revogarTudo,
  rotacionar,
  ReuseDetectado,
  type DadosSessao,
} from '../lib/sessions.js';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Use pelo menos 10 caracteres.'),
});

/** Rótulos do aparelho, opcionais. Servem só para a tela "seus aparelhos". */
const dadosDoAparelho = z.object({
  deviceLabel: z.string().max(60).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

function lerAparelho(body: unknown): DadosSessao {
  const parsed = dadosDoAparelho.safeParse(body);
  return parsed.success ? parsed.data : {};
}

/**
 * Emite o par que o app guarda: um access token curto e um refresh longo.
 *
 * O app deve guardar o refresh no armazenamento seguro do sistema
 * (Keychain/Keystore, via expo-secure-store) e nunca em AsyncStorage — este é o
 * único segredo capaz de reabrir a conta.
 */
async function emitirPar(
  app: FastifyInstance,
  userId: string,
  dados: DadosSessao,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: string;
}> {
  const sessao = await abrirSessao(userId, dados);
  return {
    accessToken: app.jwt.sign({ sub: userId }, { expiresIn: ACCESS_TTL }),
    refreshToken: sessao.refreshToken,
    expiresIn: 15 * 60,
    refreshExpiresAt: sessao.expiresAt.toISOString(),
  };
}

/** Registra um evento de conta. Nunca falha o request principal por causa disto. */
async function auditar(
  req: FastifyRequest,
  userId: string | null,
  type: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await sql`
      INSERT INTO account_events (user_id, type, ip, user_agent, metadata)
      VALUES (
        ${userId}, ${type}, ${req.ip},
        ${req.headers['user-agent'] ?? null}, ${JSON.stringify(metadata)}
      )
    `;
  } catch (erro) {
    req.log.warn({ erro }, 'falha ao gravar account_event');
  }
}

/**
 * Limite apertado para as rotas onde uma tentativa repetida é alguém adivinhando
 * senha, e não uso normal. Ninguém erra a própria senha 8 vezes em 5 minutos.
 *
 * Note que o scrypt já custa ~800 ms por verificação, o que sozinho torna um
 * ataque de força bruta lento. Isto é a segunda camada: impede que o atacante
 * simplesmente ocupe o servidor tentando.
 */
const limiteDeTentativas = {
  config: { rateLimit: { max: 8, timeWindow: '5 minutes' } },
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', limiteDeTentativas, async (req, reply) => {
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

    await auditar(req, user.id, 'cadastro');
    return reply.code(201).send({
      userId: user.id,
      ...(await emitirPar(app, user.id, lerAparelho(req.body))),
    });
  });

  app.post('/login', limiteDeTentativas, async (req, reply) => {
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
      await auditar(req, user?.id ?? null, 'login_falhou', { email });
      return reply.code(401).send({ error: 'E-mail ou senha inválidos.' });
    }

    await auditar(req, user.id, 'login');
    return { userId: user.id, ...(await emitirPar(app, user.id, lerAparelho(req.body))) };
  });

  /**
   * POST /auth/refresh — troca o refresh token por um par novo.
   *
   * Rota pública de propósito: ela é chamada justamente quando o access token já
   * expirou. Quem autentica aqui é o próprio refresh token.
   */
  app.post('/refresh', async (req, reply) => {
    const body = z.object({ refreshToken: z.string().min(10) }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Informe o refreshToken.' });
    }

    try {
      const resultado = await rotacionar(body.data.refreshToken, lerAparelho(req.body));
      if (!resultado) {
        return reply.code(401).send({
          error: 'Sessão expirada.',
          hint: 'Entre novamente.',
        });
      }

      const { userId, par } = resultado;
      return {
        userId,
        accessToken: app.jwt.sign({ sub: userId }, { expiresIn: ACCESS_TTL }),
        refreshToken: par.refreshToken,
        expiresIn: 15 * 60,
        refreshExpiresAt: par.expiresAt.toISOString(),
      };
    } catch (erro) {
      if (erro instanceof ReuseDetectado) {
        await auditar(req, null, 'refresh_reuso_detectado');
        // 401 e não 403: para quem apresentou o token, o resultado é o mesmo —
        // entrar de novo. A diferença fica no log, que é onde ela serve.
        return reply.code(401).send({
          error: 'Sessão encerrada por segurança.',
          hint: 'Este acesso foi usado mais de uma vez. Entre novamente.',
        });
      }
      throw erro;
    }
  });

  /** POST /auth/logout — encerra apenas a sessão deste aparelho. */
  app.post('/logout', async (req, reply) => {
    const body = z.object({ refreshToken: z.string().min(10) }).safeParse(req.body);
    // Sem token não há o que revogar, mas responder erro entregaria informação
    // sobre o que existe. Logout é sempre 204.
    if (body.success) await revogarSessao(body.data.refreshToken);
    return reply.code(204).send();
  });

  /** GET /auth/sessions — os aparelhos conectados. */
  app.get('/sessions', { onRequest: [async (req) => req.jwtVerify()] }, async (req) => {
    const { sub } = req.user as { sub: string };
    return { sessions: await listarSessoes(sub) };
  });

  /** DELETE /auth/sessions/:id — desconecta um aparelho específico. */
  app.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const ok = await revogarPorId(req.params.id, sub);
      if (!ok) return reply.code(404).send({ error: 'Sessão não encontrada.' });
      await auditar(req, sub, 'sessao_revogada', { sessionId: req.params.id });
      return reply.code(204).send();
    },
  );

  /** POST /auth/sessions/revoke-all — sair de todos os aparelhos. */
  app.post(
    '/sessions/revoke-all',
    { onRequest: [async (req) => req.jwtVerify()] },
    async (req) => {
      const { sub } = req.user as { sub: string };
      const revogadas = await revogarTudo(sub, 'logout');
      await auditar(req, sub, 'logout_geral', { revogadas });
      return { revogadas };
    },
  );

  /**
   * POST /auth/password — troca de senha.
   *
   * Derruba todas as sessões, inclusive a de quem trocou, e devolve um par novo.
   * Trocar a senha porque se desconfia de invasão e continuar com o invasor
   * logado é o pior dos mundos.
   */
  app.post(
    '/password',
    { onRequest: [async (req) => req.jwtVerify()], ...limiteDeTentativas },
    async (req, reply) => {
    const body = z
      .object({ currentPassword: z.string(), newPassword: z.string().min(10) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'Informe a senha atual e a nova, com pelo menos 10 caracteres.',
      });
    }

    const { sub } = req.user as { sub: string };
    const [user] = await sql`
      SELECT password_hash FROM users WHERE id = ${sub} AND deleted_at IS NULL
    `;
    if (!user || !(await verifyPassword(body.data.currentPassword, user.password_hash))) {
      await auditar(req, sub, 'troca_senha_falhou');
      return reply.code(401).send({ error: 'Senha atual incorreta.' });
    }

    const novoHash = await hashPassword(body.data.newPassword);
    await sql`
      UPDATE users SET password_hash = ${novoHash}, password_changed_at = now()
      WHERE id = ${sub}
    `;
    await revogarTudo(sub, 'senha_alterada');
    await auditar(req, sub, 'troca_senha');

    return { ...(await emitirPar(app, sub, lerAparelho(req.body))) };
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
    // Auditar ANTES: depois do DELETE o user_id vira NULL por ON DELETE SET NULL,
    // e a linha continua provando que a exclusão aconteceu.
    await auditar(req, sub, 'conta_excluida');
    await sql`DELETE FROM users WHERE id = ${sub}`;
    return reply.code(204).send();
  });
};

/**
 * Rastro API.
 *
 * Responsabilidade: receber o zip do export, extrair as listas, delegar ao
 * @rastro/core, persistir o snapshot e servir os relatórios. Opcionalmente,
 * coletar as métricas agregadas da API oficial do Instagram (modo conectado).
 *
 * Sobre falar com o Instagram: existe exatamente um lugar neste serviço que faz
 * isso — `lib/instagramApi.ts` —, e ele só usa endpoints públicos documentados
 * com token OAuth concedido pelo usuário na tela do próprio Instagram. Não há,
 * e não deve passar a haver, chamada a API privada, sessão logada ou qualquer
 * coisa que precise da senha de alguém. As regras 1 a 4 do CLAUDE.md continuam
 * valendo inteiras.
 */

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { snapshotRoutes } from './routes/snapshots.js';
import { authRoutes } from './routes/auth.js';
import { instagramRoutes } from './routes/instagram.js';
import { startMetricsScheduler } from './lib/scheduler.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 150);

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // O corpo do request contém a rede social inteira do usuário.
      // Nunca logar payload de import.
      redact: ['req.headers.authorization', 'req.body'],
    },
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? (() => {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET é obrigatório em produção.');
      }
      return 'dev-only-secret';
    })(),
  });

  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(snapshotRoutes, { prefix: '/profiles/:profileId/snapshots' });
  await app.register(instagramRoutes, { prefix: '/instagram' });

  return app;
}

// TODO(claude-code): mover para um bootstrap separado quando adicionarmos testes de integração.
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  startMetricsScheduler(app.log);
  await app.listen({ port: PORT, host: '0.0.0.0' });
}

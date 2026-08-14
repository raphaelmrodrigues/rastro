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

import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { snapshotRoutes } from './routes/snapshots.js';
import { authRoutes } from './routes/auth.js';
import { instagramRoutes } from './routes/instagram.js';
import { startMetricsScheduler } from './lib/scheduler.js';

/**
 * 3000 é o padrão de metade dos projetos Node e já está ocupado na VPS. 4891 não
 * colide com nada conhecido. Dentro do container isso é indiferente — quem
 * publica é o Traefik —, mas em `dev` e em `docker compose` local, colisão de
 * porta custa meia hora de confusão.
 */
const PORT = Number(process.env.PORT ?? 4891);

/**
 * Teto do upload do zip.
 *
 * O export completo de uma conta real deu 479 MB (só de mídia; as listas somam
 * poucos KB). 150 MB, o valor anterior, recusaria esse arquivo depois de o
 * usuário ter esperado até 48h pelo download — o pior momento possível para
 * dizer não. O caminho preferido é o app mandar o snapshot já processado
 * (`POST /snapshots/processed`), que são alguns MB; este limite é a rede de
 * segurança de quem sobe o zip pela web.
 */
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 600);

/**
 * Origens permitidas no CORS.
 *
 * O app nativo não manda `Origin` e por isso não é afetado; quem depende disto é
 * a versão web. Lista explícita e não `*`: com `*` qualquer site aberto no
 * navegador do usuário poderia chamar a API em nome dele.
 */
function origensPermitidas(): string[] {
  const configuradas = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (configuradas.length > 0) return configuradas;
  /*
   * Sem configuração, só o desenvolvimento local. Produção precisa declarar.
   *
   * 8391 é a porta fixada nos scripts de `packages/app` — o padrão 8081 do Metro
   * colidia com outra aplicação na máquina do dono. Se mudar lá, mude aqui: o
   * sintoma de esquecer é o app carregar normalmente e só o login falhar, com
   * erro de CORS que não aparece na tela.
   */
  return ['http://localhost:8391'];
}

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // O corpo do request contém a rede social inteira do usuário.
      // Nunca logar payload de import.
      redact: ['req.headers.authorization', 'req.body'],
    },
    /*
     * Atrás do Traefik, o socket vem do proxy. Sem isto, `req.ip` seria o IP do
     * container em todo request — e aí a auditoria registra sempre o mesmo
     * endereço e o rate limit trata o mundo inteiro como um cliente só.
     *
     * Só é seguro porque nada além do Traefik alcança esta porta: confiar em
     * X-Forwarded-For com a porta exposta deixaria qualquer um forjar o próprio IP.
     */
    trustProxy: true,
  });

  await app.register(cors, {
    origin: origensPermitidas(),
    credentials: true,
  });

  /*
   * Rate limit global, folgado — é rede de segurança, não regra de negócio.
   * O limite apertado fica em /auth (ver authRoutes), onde tentativa repetida
   * significa alguém adivinhando senha.
   */
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
    timeWindow: '1 minute',
    // Por usuário quando autenticado, por IP quando não. Sem isto, todos os
    // clientes atrás de um mesmo NAT dividiriam a mesma cota.
    keyGenerator: (req) => {
      const user = (req.user as { sub?: string } | undefined)?.sub;
      return user ?? req.ip;
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
// Sobre `pathToFileURL` em vez de `file://${...}`: ver a nota em db/migrate.ts.
// Com a comparação antiga o servidor não subia no Windows e saía com código 0.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await buildServer();
  startMetricsScheduler(app.log);
  await app.listen({ port: PORT, host: '0.0.0.0' });
}

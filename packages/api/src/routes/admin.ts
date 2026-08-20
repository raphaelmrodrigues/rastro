/**
 * Painel do dono — números do app e sinais de que algo quebrou.
 *
 * ## Quem entra
 *
 * Só e-mails listados em `ADMIN_EMAILS`. A autenticação é a mesma dos usuários
 * (mesmo login, mesmo scrypt, mesmo limite de tentativas): não existe segunda
 * senha nem token mestre. Um token mestre em variável de ambiente é o tipo de
 * coisa que vaza num print de terminal e dá acesso total para sempre.
 *
 * Sem `ADMIN_EMAILS` definido, todas as rotas daqui respondem 404 — o padrão é
 * o painel não existir.
 *
 * ## O que o painel NÃO mostra
 *
 * Nenhum @, nenhuma lista, nenhum dado de snapshot de ninguém. Só contagens.
 * A tentação de "ver o que os usuários importaram" é exatamente o que a regra 5
 * do CLAUDE.md proíbe, e um painel é o lugar mais fácil de furar essa regra sem
 * perceber. E-mail aparece só nas contas mais recentes, mascarado.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../db/client.js';

function administradores(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function painelHabilitado(): boolean {
  return administradores().length > 0;
}

/**
 * Deixa passar só quem está na lista.
 *
 * Responde 404, e não 403, para quem não é admin: um 403 confirma que o painel
 * existe naquele endereço, e essa confirmação é o primeiro passo de quem procura
 * o que atacar.
 */
async function somenteAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const lista = administradores();
  if (lista.length === 0) return reply.callNotFound();

  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Entre para continuar.' });
  }

  const sub = (req.user as { sub?: string } | undefined)?.sub;
  if (!sub) return reply.callNotFound();

  const [usuario] = await sql<{ email: string }[]>`
    SELECT email FROM users WHERE id = ${sub} AND deleted_at IS NULL
  `;
  if (!usuario || !lista.includes(usuario.email.toLowerCase())) {
    return reply.callNotFound();
  }
}

/** `raphael@exemplo.com` -> `rap***@exemplo.com`. */
function mascarar(email: string): string {
  const [local, dominio] = email.split('@');
  if (!dominio) return '***';
  const visivel = local.slice(0, Math.min(3, local.length));
  return `${visivel}***@${dominio}`;
}

const numero = (v: unknown): number => Number(v ?? 0);

/** `array_agg` do Postgres vira array em JS; o painel só quer uma linha de texto. */
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export const adminRoutes: FastifyPluginAsync = async (app) => {
  /** A página em si. HTML estático; todos os dados vêm de /admin/metrics. */
  app.get('/', async (_req, reply) => {
    if (!painelHabilitado()) return reply.callNotFound();
    const aqui = dirname(fileURLToPath(import.meta.url));
    // O painel.html é copiado para o dist junto das migrations (ver scripts/).
    const html = await readFile(join(aqui, 'painel.html'), 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/metrics', { onRequest: [somenteAdmin] }, async () => {
    /*
     * Uma ida ao banco por bloco, em paralelo. Poderia ser uma query só com
     * CTEs, mas aí um erro em qualquer pedaço derruba o painel inteiro — e o
     * painel é justamente o que se abre quando algo está errado.
     */
    const [contas, engajamento, imports, formatos, plataformas, versoes, falhas, recentes, serie] =
      await Promise.all([
        sql`
          SELECT
            count(*) FILTER (WHERE deleted_at IS NULL)                                    AS ativas,
            count(*) FILTER (WHERE deleted_at IS NOT NULL)                                AS excluidas,
            count(*) FILTER (WHERE deleted_at IS NULL AND created_at > now() - interval '7 days')  AS ultimos7,
            count(*) FILTER (WHERE deleted_at IS NULL AND created_at > now() - interval '30 days') AS ultimos30
          FROM users
        `,
        /*
         * "Ativo" aqui é sessão usada, não conta criada. É a diferença entre
         * quem instalou e quem voltou — e é o número que decide se o produto
         * está de pé.
         */
        sql`
          SELECT
            count(DISTINCT user_id) FILTER (WHERE last_used_at > now() - interval '1 day')  AS dia,
            count(DISTINCT user_id) FILTER (WHERE last_used_at > now() - interval '7 days') AS semana,
            count(DISTINCT user_id) FILTER (WHERE last_used_at > now() - interval '30 days') AS mes
          FROM sessions WHERE revoked_at IS NULL
        `,
        sql`
          SELECT
            count(*)                                                        AS total,
            count(*) FILTER (WHERE imported_at > now() - interval '7 days') AS ultimos7,
            count(DISTINCT profile_id)                                      AS perfis
          FROM snapshots
        `,
        sql`SELECT coalesce(format, 'desconhecido') AS formato, count(*) AS n FROM snapshots GROUP BY 1 ORDER BY 2 DESC`,
        sql`
          SELECT coalesce(platform, 'desconhecida') AS plataforma, count(DISTINCT user_id) AS n
          FROM sessions WHERE revoked_at IS NULL GROUP BY 1 ORDER BY 2 DESC
        `,
        sql`
          SELECT coalesce(app_version, 'desconhecida') AS versao, count(*) AS n
          FROM app_reports WHERE created_at > now() - interval '30 days'
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        `,
        /*
         * O bloco mais importante do painel: quais avisos de parsing estão
         * aparecendo. UNKNOWN_FILE_SHAPE ou ENTRIES_SKIPPED subindo significa
         * que o Instagram mudou o formato — e que o app está mentindo para os
         * usuários agora, não daqui a um mês.
         */
        sql`
          SELECT
            aviso->>'code'          AS codigo,
            count(*)                AS relatos,
            sum((aviso->>'count')::bigint) AS entradas,
            max(created_at)         AS ultimo
          FROM app_reports, jsonb_array_elements(detail->'warnings') AS aviso
          WHERE kind = 'parse' AND created_at > now() - interval '30 days'
          GROUP BY 1 ORDER BY 2 DESC LIMIT 20
        `,
        sql`
          SELECT email, created_at FROM users
          WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 10
        `,
        // Contas por dia, para o gráfico. 30 dias cabem numa tela estreita.
        sql`
          SELECT date_trunc('day', created_at)::date AS dia, count(*) AS n
          FROM users WHERE created_at > now() - interval '30 days'
          GROUP BY 1 ORDER BY 1
        `,
      ]);

    const [crashes] = await sql`
      SELECT
        count(*)                                                       AS total,
        count(*) FILTER (WHERE created_at > now() - interval '7 days') AS ultimos7
      FROM app_reports WHERE kind = 'crash'
    `;

    /*
     * Os crashes vêm de duas formas porque servem a duas perguntas diferentes.
     *
     * Agrupados: "o que está quebrando", que é a pergunta de quem abre o painel
     * para decidir o que consertar. Quinze linhas do mesmo erro repetido
     * escondem o segundo erro, que aparece três vezes e derruba o import.
     *
     * Individuais: "o que exatamente aconteceu daquela vez", que é a pergunta de
     * quem já escolheu o erro e precisa da pilha inteira para consertá-lo.
     *
     * `name`, `message`, `stack` e `screen` moram dentro do JSONB `detail`, não
     * são colunas — o schema guarda a forma do relato num campo só (migração 004).
     */
    const gruposDeCrash = await sql`
      SELECT
        detail->>'name'    AS name,
        detail->>'message' AS message,
        count(*)           AS n,
        min(created_at)    AS primeiro,
        max(created_at)    AS ultimo,
        array_agg(DISTINCT coalesce(app_version, '?'))       AS versoes,
        array_agg(DISTINCT coalesce(platform, '?'))          AS plataformas,
        array_agg(DISTINCT coalesce(detail->>'screen', '?')) AS telas
      FROM app_reports
      WHERE kind = 'crash' AND created_at > now() - interval '30 days'
      GROUP BY 1, 2
      ORDER BY 3 DESC, 5 DESC
      LIMIT 30
    `;

    const ultimosCrashes = await sql`
      SELECT
        id,
        detail->>'name'    AS name,
        detail->>'message' AS message,
        detail->>'stack'   AS stack,
        detail->>'screen'  AS screen,
        app_version, platform, created_at
      FROM app_reports WHERE kind = 'crash'
      ORDER BY created_at DESC LIMIT 40
    `;

    return {
      geradoEm: Date.now(),
      contas: {
        ativas: numero(contas[0]?.ativas),
        excluidas: numero(contas[0]?.excluidas),
        ultimos7: numero(contas[0]?.ultimos7),
        ultimos30: numero(contas[0]?.ultimos30),
      },
      ativos: {
        dia: numero(engajamento[0]?.dia),
        semana: numero(engajamento[0]?.semana),
        mes: numero(engajamento[0]?.mes),
      },
      imports: {
        total: numero(imports[0]?.total),
        ultimos7: numero(imports[0]?.ultimos7),
        perfis: numero(imports[0]?.perfis),
      },
      formatos: formatos.map((f) => ({ rotulo: String(f.formato), n: numero(f.n) })),
      plataformas: plataformas.map((p) => ({ rotulo: String(p.plataforma), n: numero(p.n) })),
      versoes: versoes.map((v) => ({ rotulo: String(v.versao), n: numero(v.n) })),
      parsing: falhas.map((f) => ({
        codigo: String(f.codigo),
        relatos: numero(f.relatos),
        entradas: numero(f.entradas),
        ultimo: f.ultimo,
      })),
      crashes: {
        total: numero(crashes?.total),
        ultimos7: numero(crashes?.ultimos7),
        grupos: gruposDeCrash.map((g) => ({
          name: g.name,
          message: g.message,
          n: numero(g.n),
          primeiro: g.primeiro,
          ultimo: g.ultimo,
          versoes: lista(g.versoes),
          plataformas: lista(g.plataformas),
          telas: lista(g.telas),
        })),
        recentes: ultimosCrashes.map((c) => ({
          id: String(c.id),
          name: c.name,
          message: c.message,
          // A pilha é o que faltava: ela já era guardada e o painel não mostrava,
          // então o dono tinha o dado no banco e nenhum jeito de olhar para ele.
          stack: c.stack,
          screen: c.screen,
          versao: c.app_version,
          plataforma: c.platform,
          em: c.created_at,
        })),
      },
      // Mascarado: o painel serve para saber que contas estão entrando, não para
      // ler o e-mail de quem entrou.
      recentes: recentes.map((u) => ({
        email: mascarar(String(u.email)),
        em: u.created_at,
      })),
      serieDeContas: serie.map((d) => ({ dia: String(d.dia), n: numero(d.n) })),
    };
  });
};

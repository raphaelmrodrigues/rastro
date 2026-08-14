/**
 * Conexão com o PostgreSQL.
 *
 * Uma instância só, criada na subida do processo. O `postgres` já faz pool.
 */

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL é obrigatório em produção.');
}

export const sql = postgres(url ?? 'postgres://rastro:rastro@localhost:5432/rastro', {
  // O payload de um import é a rede social inteira de alguém. Nada de log de query
  // com parâmetro — o `debug` do driver imprimiria os @s.
  debug: false,
  transform: { undefined: null },
  // NOTICE do Postgres é ruído no boot ("relation already exists, skipping" a
  // cada migrate). Some por padrão e volta com LOG_LEVEL=debug, quando é
  // justamente o que se quer ver.
  onnotice: process.env.LOG_LEVEL === 'debug' ? undefined : () => {},
});

export type Sql = typeof sql;

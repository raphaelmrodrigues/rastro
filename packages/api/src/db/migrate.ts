/**
 * Aplicador de migrations.
 *
 * Por que não `psql < schema.sql`: com um único servidor e um único banco isso
 * funciona até o dia do primeiro `ALTER TABLE` em produção. A partir daí é
 * preciso saber o que já rodou, e é para isso que existe `schema_migrations`.
 *
 * Garantias, todas necessárias no Dokploy, onde o container pode subir em
 * duplicata durante um deploy:
 *
 *   - **lock**: `pg_advisory_xact_lock` faz o segundo container esperar em vez de
 *     aplicar a mesma migration em paralelo;
 *   - **atomicidade**: tudo numa transação só. Migration que falha no meio não
 *     deixa metade das tabelas criadas — Postgres faz DDL transacional, ao
 *     contrário do MySQL;
 *   - **idempotência**: rodar de novo não faz nada, então pode ser o passo de
 *     partida do container sem condicional.
 *
 * Ordem: alfabética do nome do arquivo. Por isso o prefixo numérico com zero à
 * esquerda — `010_` depois de `009_` só funciona com largura fixa.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sql } from './client.js';

/** Número arbitrário, só precisa ser o mesmo em todos os processos. */
const LOCK_ID = 8_270_413;

const PASTA = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

export async function migrate(log: (msg: string) => void = console.log): Promise<void> {
  const arquivos = (await readdir(PASTA)).filter((n) => n.endsWith('.sql')).sort();

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_ID})`;

    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const aplicadas = new Map<string, string>(
      (await tx<{ version: string; checksum: string }[]>`
        SELECT version, checksum FROM schema_migrations
      `).map((r) => [r.version, r.checksum]),
    );

    for (const arquivo of arquivos) {
      const conteudo = await readFile(join(PASTA, arquivo), 'utf8');
      const checksum = sha256(conteudo);
      const jaAplicada = aplicadas.get(arquivo);

      if (jaAplicada) {
        // Editar uma migration já aplicada é um erro que só aparece semanas
        // depois, quando um ambiente novo gera um schema diferente do de
        // produção. Melhor falhar o deploy agora e criar uma migration nova.
        if (jaAplicada !== checksum) {
          throw new Error(
            `A migration ${arquivo} mudou depois de aplicada. ` +
              'Crie uma migration nova em vez de editar esta.',
          );
        }
        continue;
      }

      log(`aplicando ${arquivo}`);
      // `.simple()` é obrigatório: no protocolo estendido, que o driver usa por
      // padrão, só passa UM comando por query — um arquivo .sql inteiro estoura
      // com "cannot insert multiple commands into a prepared statement".
      await tx.unsafe(conteudo).simple();
      await tx`
        INSERT INTO schema_migrations (version, checksum) VALUES (${arquivo}, ${checksum})
      `;
    }
  });

  log('banco atualizado');
}

/*
 * "Fui executado direto, e não importado?"
 *
 * `file://${process.argv[1]}` funciona no Linux e falha no Windows, onde o
 * argumento vem como `C:\...\migrate.js` e a URL como `file:///C:/.../migrate.js`.
 * A comparação dava falso, nada rodava, e o processo terminava com código 0 e
 * nenhuma mensagem — um silêncio idêntico ao de um sucesso. `pathToFileURL`
 * normaliza os dois lados.
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  await sql.end();
}

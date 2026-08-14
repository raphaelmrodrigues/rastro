/**
 * Registro dos imports: idempotência, andamento e histórico de falha.
 *
 * ## Por que o processamento continua dentro do request
 *
 * A ideia inicial era uma fila com worker separado. Medindo, ela piora o que se
 * propunha a resolver: `extractExportFiles` trabalha **enquanto** o upload chega,
 * e o parse de um export real de 479 MB custa menos de um segundo. O tempo total
 * é o tempo de rede — que uma fila não encurta. Gravar o zip em disco para um
 * worker pegar depois adiciona ~479 MB de escrita, um volume para administrar e
 * uma janela onde o arquivo bruto fica parado no servidor, contra a política de
 * retenção do projeto.
 *
 * O que a fila resolvia de verdade era outra coisa, e é o que está aqui:
 *
 *   - **idempotência**: rede caiu no meio, o usuário reenvia o mesmo zip. Sem
 *     isso nasce um snapshot gêmeo, e dois snapshots iguais em sequência fazem o
 *     diff seguinte comparar contra o vizinho errado;
 *   - **observabilidade**: import que falhou fica registrado. É por essa tabela
 *     que se descobre que o Instagram mudou o formato do export;
 *   - **caminho de saída**: quando o processamento realmente precisar sair do
 *     request, `import_jobs` já é a fila — basta um worker consumir 'pendente'.
 */

import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { sql } from '../db/client.js';

/**
 * Envolve o stream do upload calculando SHA-256 e contando bytes de passagem.
 *
 * `digest()` só é confiável depois de o stream ter sido consumido até o fim —
 * por isso `drenar()`, chamado quando o extrator para antes do último byte.
 */
export function comHash(origem: NodeJS.ReadableStream) {
  const hasher = createHash('sha256');
  let bytes = 0;
  let terminou = false;

  const medidor = new Transform({
    transform(chunk, _enc, cb) {
      hasher.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });

  medidor.on('end', () => {
    terminou = true;
  });

  origem.pipe(medidor);

  return {
    stream: medidor as unknown as NodeJS.ReadableStream,

    /**
     * Garante que o resto do arquivo passou pelo hash.
     *
     * O extrator pode encerrar assim que encontra as listas que interessam,
     * deixando bytes para trás. Sem isto o digest sairia parcial — e um digest
     * parcial é pior que nenhum: ele parece funcionar e falha só quando dois
     * arquivos diferentes compartilham o mesmo começo.
     */
    async drenar(): Promise<void> {
      if (terminou) return;
      await new Promise<void>((resolve, reject) => {
        medidor.on('end', () => resolve());
        medidor.on('error', reject);
        medidor.resume();
      });
    },

    digest(): { sha256: string; bytes: number } {
      return { sha256: hasher.copy().digest('hex'), bytes };
    },
  };
}

export interface ImportEmAndamento {
  jobId: string;
  duplicado: boolean;
  snapshotIdExistente: string | null;
}

/**
 * Abre o job, ou reconhece que este arquivo já foi importado.
 *
 * O `ON CONFLICT DO NOTHING` sobre `(profile_id, file_sha256)` é o que torna o
 * reenvio seguro mesmo quando duas requisições chegam ao mesmo tempo: quem perde
 * a corrida não cria linha e cai no SELECT abaixo.
 */
export async function abrirImport(
  profileId: string,
  sha256: string,
  bytes: number,
): Promise<ImportEmAndamento> {
  const [criado] = await sql<{ id: string }[]>`
    INSERT INTO import_jobs (profile_id, status, file_sha256, file_bytes, started_at, attempts)
    VALUES (${profileId}, 'processando', ${sha256}, ${bytes}, now(), 1)
    ON CONFLICT (profile_id, file_sha256) DO NOTHING
    RETURNING id
  `;

  if (criado) return { jobId: criado.id, duplicado: false, snapshotIdExistente: null };

  const [existente] = await sql<{ id: string; status: string; snapshot_id: string | null }[]>`
    SELECT id, status, snapshot_id FROM import_jobs
    WHERE profile_id = ${profileId} AND file_sha256 = ${sha256}
  `;

  // Tentativa anterior que falhou não bloqueia: o formato pode ter passado a ser
  // suportado, ou a falha pode ter sido transitória. Reabre para nova tentativa.
  if (existente.status === 'falhou') {
    await sql`
      UPDATE import_jobs
      SET status = 'processando', started_at = now(), finished_at = NULL,
          error = NULL, attempts = attempts + 1
      WHERE id = ${existente.id}
    `;
    return { jobId: existente.id, duplicado: false, snapshotIdExistente: null };
  }

  return {
    jobId: existente.id,
    duplicado: true,
    snapshotIdExistente: existente.snapshot_id,
  };
}

export async function concluirImport(jobId: string, snapshotId: string): Promise<void> {
  await sql`
    UPDATE import_jobs
    SET status = 'concluido', snapshot_id = ${snapshotId}, finished_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Marca a falha.
 *
 * `motivo` é a mensagem que o usuário já viu, nunca o conteúdo do arquivo: log de
 * erro é o lugar mais fácil de vazar @ sem perceber (regra 5 do CLAUDE.md).
 */
export async function falharImport(jobId: string, motivo: string): Promise<void> {
  await sql`
    UPDATE import_jobs
    SET status = 'falhou', error = ${motivo.slice(0, 300)}, finished_at = now()
    WHERE id = ${jobId}
  `;
}

export interface ImportVisivel {
  id: string;
  status: string;
  bytes: number;
  snapshotId: string | null;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** Histórico de imports do perfil. Sem o sha256: é impressão digital do arquivo. */
export async function listarImports(profileId: string): Promise<ImportVisivel[]> {
  const linhas = await sql<
    {
      id: string;
      status: string;
      file_bytes: string;
      snapshot_id: string | null;
      error: string | null;
      created_at: Date;
      finished_at: Date | null;
    }[]
  >`
    SELECT id, status, file_bytes, snapshot_id, error, created_at, finished_at
    FROM import_jobs WHERE profile_id = ${profileId}
    ORDER BY created_at DESC LIMIT 50
  `;

  return linhas.map((l) => ({
    id: l.id,
    status: l.status,
    bytes: Number(l.file_bytes),
    snapshotId: l.snapshot_id,
    error: l.error,
    createdAt: l.created_at,
    finishedAt: l.finished_at,
  }));
}

/**
 * Extração dos arquivos úteis de dentro do zip do export.
 *
 * O export completo do Instagram passa de 100 MB e é quase todo mídia: fotos de
 * conversas, áudios, vídeos. O que interessa ao Rastro são sete arquivos de texto
 * que somam alguns KB. Então a regra é filtrar ANTES de descompactar: nenhuma
 * entrada irrelevante é lida do stream.
 *
 * ## Ameaças que este módulo trata explicitamente
 *
 * - **zip bomb**: um zip de 1 MB pode virar 100 GB descompactados. Contamos os
 *   bytes de saída e abortamos ao passar o teto.
 * - **path traversal**: uma entrada chamada `../../etc/passwd` não vai a lugar
 *   nenhum aqui porque nada é gravado em disco, mas o nome é rejeitado assim
 *   mesmo — a próxima pessoa a mexer nisto pode decidir gravar.
 * - **excesso de entradas**: zip com milhões de entradas vazias trava o parser.
 */

import unzipper from 'unzipper';
import { RELEVANT_EXPORT_FILE } from '@rastro/core';

const MAX_ENTRIES = 5000;
/** Teto de bytes descompactados dos arquivos que interessam. */
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
/** Nenhuma lista de conexões legítima chega perto disso sozinha. */
const MAX_SINGLE_FILE_BYTES = 40 * 1024 * 1024;

export class UnsafeArchiveError extends Error {}

function isSafePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  return true;
}

/**
 * Lê o zip em streaming e devolve { caminho -> conteúdo } só das listas de conexões.
 *
 * O conteúdo sai como JSON já parseado quando o arquivo é .json, e como a string
 * crua quando é .html — que é exatamente o que `parseExport` do core espera.
 */
export async function extractExportFiles(
  stream: NodeJS.ReadableStream,
): Promise<Record<string, unknown>> {
  const files: Record<string, unknown> = {};
  let entryCount = 0;
  let totalBytes = 0;

  const zip = stream.pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of zip) {
    const path: string = entry.path;
    entryCount += 1;

    if (entryCount > MAX_ENTRIES) {
      entry.autodrain();
      throw new UnsafeArchiveError('O arquivo tem entradas demais para ser um export válido.');
    }

    const normalized = path.replace(/\\/g, '/');
    const wanted =
      entry.type === 'File' && isSafePath(normalized) && RELEVANT_EXPORT_FILE.test(normalized);

    if (!wanted) {
      // Descartar sem ler: é isto que mantém o custo baixo num zip de 100 MB.
      entry.autodrain();
      continue;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of entry) {
      size += chunk.length;
      totalBytes += chunk.length;
      if (size > MAX_SINGLE_FILE_BYTES || totalBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new UnsafeArchiveError('O conteúdo descompactado passou do limite permitido.');
      }
      chunks.push(chunk);
    }

    const content = Buffer.concat(chunks).toString('utf8');

    if (normalized.endsWith('.json')) {
      try {
        files[normalized] = JSON.parse(content);
      } catch {
        // Um arquivo corrompido não derruba o import inteiro: o core registra o
        // warning da lista que faltou e segue com as outras.
      }
    } else {
      files[normalized] = content;
    }
  }

  return files;
}

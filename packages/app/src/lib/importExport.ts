/**
 * Leitura do .zip do export DENTRO do aparelho.
 *
 * Este e o caminho "modo privado": o arquivo nunca sai do celular. O upload para a
 * API e opcional e existe so para sincronizar historico entre aparelhos.
 *
 * Regra: filtrar antes de descompactar. O export completo do Instagram passa de
 * 100 MB e e quase todo midia; descompactar tudo num celular trava o app. Dos
 * milhares de arquivos do zip, sete interessam.
 */

import JSZip from 'jszip';
import { parseExport, RELEVANT_EXPORT_FILE, type Snapshot } from '@rastro/core';

export interface ImportResult {
  snapshot: Snapshot;
  /** Quantos arquivos de lista foram encontrados. Zero significa export errado. */
  filesFound: number;
}

/**
 * Monta um snapshot a partir do zip.
 *
 * Aceita export em JSON e em HTML. O JSON e melhor (data exata), mas o usuario
 * costuma trazer HTML, que e o formato oferecido por padrao em varios pontos do
 * app do Instagram — e recusar o arquivo depois de ele ter esperado ate 48h pelo
 * download seria perder o usuario por preciosismo.
 */
export async function snapshotFromZip(
  data: ArrayBuffer,
  snapshotId: string,
): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(data);
  const files: Record<string, unknown> = {};

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !RELEVANT_EXPORT_FILE.test(path)) continue;

    try {
      const content = await entry.async('string');
      files[path] = path.endsWith('.json') ? JSON.parse(content) : content;
    } catch {
      // Arquivo corrompido nao derruba o import inteiro. O core registra o warning.
    }
  }

  const snapshot = parseExport({
    files,
    snapshotId,
    importedAt: Date.now(),
    // Se o cabecalho do HTML nao declarar o fuso, assumir o do aparelho e melhor
    // palpite do que UTC: o export foi gerado para este usuario.
    fallbackTimezoneOffsetMinutes: -new Date().getTimezoneOffset(),
  });

  return { snapshot, filesFound: Object.keys(files).length };
}

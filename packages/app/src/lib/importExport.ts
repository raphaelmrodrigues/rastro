/**
 * Leitura do .zip do export DENTRO do aparelho.
 *
 * Este e o caminho "modo privado": o arquivo nunca sai do celular. O upload para a
 * API e opcional e existe so para sincronizar historico entre aparelhos.
 *
 * Regra: filtrar antes de descompactar. O export completo do Instagram passa de
 * 100 MB — o do dono do projeto tem 479 MB — e e quase todo midia. Dos milhares
 * de arquivos do zip, dez interessam, somando menos de 700 KB.
 */

import { parseExport, RELEVANT_EXPORT_FILE, type Snapshot } from '@rastro/core';
import { extrairDoZip, type FonteArquivo } from './zip';

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
  fonte: FonteArquivo,
  snapshotId: string,
  aoProgredir?: (fracao: number) => void,
): Promise<ImportResult> {
  const extraidos = await extrairDoZip(
    fonte,
    (nome) => RELEVANT_EXPORT_FILE.test(nome),
    aoProgredir,
  );

  const files: Record<string, unknown> = {};
  for (const [caminho, conteudo] of Object.entries(extraidos)) {
    try {
      files[caminho] = caminho.endsWith('.json') ? JSON.parse(conteudo) : conteudo;
    } catch {
      // JSON quebrado nao derruba o import inteiro. O core registra o warning
      // do que faltou; um import parcial vale mais que um import falho.
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

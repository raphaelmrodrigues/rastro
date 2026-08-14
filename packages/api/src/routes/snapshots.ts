/**
 * Rotas de snapshot.
 *
 * Fluxo do import:
 *   1. recebe o .zip do export
 *   2. extrai APENAS as listas de conexões (nunca descompactar mídia)
 *   3. parseExport() no @rastro/core
 *   4. rejeita se o snapshot for inutilizável (sem seguidores)
 *   5. persiste, diffa contra o anterior, materializa os eventos
 *   6. descarta o zip
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  computeCohorts,
  computeGrowth,
  computeInsights,
  diffSnapshots,
  diffTimeline,
  followersByPeriod,
  isSnapshotUsable,
  parseExport,
  stalePendingRequests,
} from '@rastro/core';
import { randomUUID } from 'node:crypto';
import { extractExportFiles, UnsafeArchiveError } from '../lib/zipExport.js';
import {
  abrirImport,
  comHash,
  concluirImport,
  falharImport,
  listarImports,
} from '../lib/importJobs.js';
import {
  impressaoDoSnapshot,
  paraSnapshot,
  PayloadGrandeDemais,
  snapshotPayload,
} from '../lib/snapshotPayload.js';
import type { Snapshot } from '@rastro/core';

/**
 * Teto do JSON do snapshot processado.
 *
 * Uma conta de 100 mil seguidores dá algo como 8 MB neste formato; 64 MB cobre
 * com folga qualquer perfil que use o produto, e ainda é 1/8 do zip que este
 * caminho substitui.
 */
const PROCESSED_BODY_LIMIT = 64 * 1024 * 1024;
import {
  listSnapshots,
  loadPreviousSnapshot,
  loadSnapshot,
  profileBelongsTo,
  saveEvents,
  saveSnapshot,
} from '../db/snapshots.js';
import { sql } from '../db/client.js';

interface ProfileParams {
  profileId: string;
}

export const snapshotRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req) => {
    await req.jwtVerify();
  });

  /** Todo endpoint aqui é sobre dados de um perfil: confirmar a posse antes de tudo. */
  app.addHook('preHandler', async (req, reply) => {
    const { profileId } = req.params as ProfileParams;
    const { sub } = req.user as { sub: string };
    if (!(await profileBelongsTo(profileId, sub))) {
      // 404 e não 403: responder 403 confirmaria que o perfil existe.
      return reply.code(404).send({ error: 'Perfil não encontrado.' });
    }
  });

  /**
   * POST /profiles/:profileId/snapshots
   * multipart, campo "export" com o .zip baixado do Instagram.
   */
  app.post('/', async (req, reply) => {
    const { profileId } = req.params as ProfileParams;

    const file = await req.file();
    if (!file) {
      return reply.code(400).send({
        error: 'Envie o arquivo .zip do export do Instagram no campo "export".',
      });
    }

    // O hash acompanha o upload. Serve para reconhecer o mesmo arquivo enviado
    // duas vezes — o que acontece toda vez que a rede cai no meio de 400 MB.
    const medido = comHash(file.file);

    let files: Record<string, unknown>;
    let erroDeLeitura: string | null = null;
    try {
      files = await extractExportFiles(medido.stream);
    } catch (error) {
      files = {};
      erroDeLeitura =
        error instanceof UnsafeArchiveError
          ? error.message
          : 'Não foi possível abrir este arquivo. Ele é o .zip que o Instagram enviou?';
    }

    // Antes de qualquer decisão: o arquivo inteiro precisa ter passado pelo hash,
    // senão o digest é de um prefixo e a idempotência vira sorteio.
    await medido.drenar();
    const { sha256, bytes } = medido.digest();

    const job = await abrirImport(profileId, sha256, bytes);

    if (job.duplicado) {
      // Reenvio do mesmo arquivo. Devolver 200 e não erro: para o app isto é uma
      // retentativa bem-sucedida, e criar um segundo snapshot idêntico faria o
      // próximo diff comparar contra o vizinho errado e reportar zero mudanças.
      const existente = job.snapshotIdExistente
        ? await loadSnapshot(job.snapshotIdExistente)
        : null;
      return reply.code(200).send({
        jobId: job.jobId,
        duplicate: true,
        snapshotId: job.snapshotIdExistente,
        ...(existente ? { insights: computeInsights(existente) } : {}),
        hint: 'Este mesmo arquivo já tinha sido importado. Nada foi duplicado.',
      });
    }

    if (erroDeLeitura) {
      await falharImport(job.jobId, erroDeLeitura);
      return reply.code(422).send({ error: erroDeLeitura, jobId: job.jobId });
    }

    const snapshot = parseExport({
      files,
      snapshotId: randomUUID(),
      importedAt: Date.now(),
    });

    // Um snapshot vazio, se salvo, faz o próximo diff reportar a base inteira como
    // perdida. Prefira falhar o import a corromper o histórico.
    if (!isSnapshotUsable(snapshot)) {
      const motivo = 'Não encontramos sua lista de seguidores neste arquivo.';
      await falharImport(job.jobId, motivo);
      return reply.code(422).send({
        error: motivo,
        jobId: job.jobId,
        hint:
          'Ao pedir o export no Instagram, inclua "Seguidores e seguindo" e escolha ' +
          '"Todo o período". JSON e HTML funcionam.',
        warnings: snapshot.warnings,
      });
    }

    const previous = await loadPreviousSnapshot(profileId, snapshot.importedAt);
    const diff = previous ? diffSnapshots(previous, snapshot) : null;

    try {
      await saveSnapshot(profileId, snapshot);
      if (diff) await saveEvents(profileId, diff);
    } catch (error) {
      await falharImport(job.jobId, 'Falha ao gravar o snapshot.');
      throw error;
    }

    await concluirImport(job.jobId, snapshot.id);

    return {
      jobId: job.jobId,
      duplicate: false,
      snapshotId: snapshot.id,
      format: snapshot.format,
      insights: computeInsights(snapshot),
      diff,
      warnings: snapshot.warnings,
    };
  });

  /**
   * POST /profiles/:profileId/snapshots/processed
   *
   * O app já rodou o `core` no aparelho e manda o resultado. Alguns MB de JSON
   * no lugar de um zip que passa de 400 MB — a diferença entre o import
   * funcionar e não funcionar num 4G ruim.
   *
   * O contrato de resposta é o mesmo de `POST /`, inclusive `duplicate`, para o
   * app não precisar de dois caminhos de tratamento.
   */
  app.post('/processed', { bodyLimit: PROCESSED_BODY_LIMIT }, async (req, reply) => {
    const { profileId } = req.params as ProfileParams;

    const parsed = snapshotPayload.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Snapshot em formato inesperado.',
        issues: parsed.error.issues.slice(0, 10),
      });
    }

    let snapshot: Snapshot;
    try {
      snapshot = paraSnapshot(parsed.data, randomUUID());
    } catch (error) {
      if (error instanceof PayloadGrandeDemais) {
        return reply.code(413).send({ error: error.message });
      }
      throw error;
    }

    if (!isSnapshotUsable(snapshot)) {
      return reply.code(422).send({
        error: 'Não encontramos sua lista de seguidores neste snapshot.',
        warnings: snapshot.warnings,
      });
    }

    // A impressão digital faz o papel do SHA-256 do arquivo: reenviar o mesmo
    // estado não cria um snapshot gêmeo.
    const impressao = impressaoDoSnapshot(snapshot);
    const bytes = Number(req.headers['content-length'] ?? 0);
    const job = await abrirImport(profileId, impressao, bytes);

    if (job.duplicado) {
      const existente = job.snapshotIdExistente
        ? await loadSnapshot(job.snapshotIdExistente)
        : null;
      return reply.code(200).send({
        jobId: job.jobId,
        duplicate: true,
        snapshotId: job.snapshotIdExistente,
        ...(existente ? { insights: computeInsights(existente) } : {}),
        hint: 'Este mesmo estado já tinha sido importado. Nada foi duplicado.',
      });
    }

    const previous = await loadPreviousSnapshot(profileId, snapshot.importedAt);
    const diff = previous ? diffSnapshots(previous, snapshot) : null;

    try {
      await saveSnapshot(profileId, snapshot);
      if (diff) await saveEvents(profileId, diff);
    } catch (error) {
      await falharImport(job.jobId, 'Falha ao gravar o snapshot.');
      throw error;
    }

    await concluirImport(job.jobId, snapshot.id);

    return {
      jobId: job.jobId,
      duplicate: false,
      snapshotId: snapshot.id,
      format: snapshot.format,
      insights: computeInsights(snapshot),
      diff,
      warnings: snapshot.warnings,
    };
  });

  /** GET /profiles/:profileId/snapshots/imports — histórico de imports, inclusive os que falharam. */
  app.get('/imports', async (req) => {
    const { profileId } = req.params as ProfileParams;
    return { imports: await listarImports(profileId) };
  });

  /** GET /profiles/:profileId/snapshots — histórico resumido. */
  app.get('/', async (req) => {
    const { profileId } = req.params as ProfileParams;
    return { snapshots: await listSnapshots(profileId) };
  });

  /** GET /profiles/:profileId/snapshots/:snapshotId — listas de um snapshot. */
  app.get('/:snapshotId', async (req, reply) => {
    const { snapshotId } = req.params as ProfileParams & { snapshotId: string };
    const snapshot = await loadSnapshot(snapshotId);
    if (!snapshot) return reply.code(404).send({ error: 'Snapshot não encontrado.' });

    return {
      snapshot: {
        id: snapshot.id,
        importedAt: snapshot.importedAt,
        exportedAt: snapshot.exportedAt,
        format: snapshot.format,
        dataWindow: snapshot.dataWindow,
        warnings: snapshot.warnings,
      },
      insights: computeInsights(snapshot),
      stalePending: stalePendingRequests(snapshot),
      followersByPeriod: followersByPeriod(snapshot),
    };
  });

  /**
   * GET /profiles/:profileId/snapshots/latest/diff
   * A comparação entre os dois imports mais recentes — a tela principal do app.
   */
  app.get('/latest/diff', async (req, reply) => {
    const { profileId } = req.params as ProfileParams;
    const rows = await sql`
      SELECT id FROM snapshots WHERE profile_id = ${profileId}
      ORDER BY imported_at DESC LIMIT 2
    `;

    if (rows.length < 2) {
      return reply.code(409).send({
        error: 'Ainda não há dois imports para comparar.',
        hint: 'A comparação nasce do segundo import. O primeiro é o ponto de partida.',
      });
    }

    const [current, previous] = await Promise.all([
      loadSnapshot(rows[0].id),
      loadSnapshot(rows[1].id),
    ]);
    if (!current || !previous) {
      return reply.code(404).send({ error: 'Snapshot não encontrado.' });
    }

    return { diff: diffSnapshots(previous, current) };
  });

  /**
   * GET /profiles/:profileId/snapshots/stats
   * Série de crescimento e safras, calculadas sobre todo o histórico.
   */
  app.get('/stats', async (req, reply) => {
    const { profileId } = req.params as ProfileParams;
    const rows = await sql`
      SELECT id FROM snapshots WHERE profile_id = ${profileId} ORDER BY imported_at ASC
    `;

    if (rows.length === 0) {
      return reply.code(409).send({ error: 'Nenhum import ainda.' });
    }

    const snapshots = [];
    for (const row of rows) {
      const snapshot = await loadSnapshot(row.id);
      if (snapshot) snapshots.push(snapshot);
    }

    const diffs = diffTimeline(snapshots);
    const earliest = snapshots[0];
    const latest = snapshots[snapshots.length - 1];

    return {
      growth: computeGrowth(diffs, earliest.relationships.followers.length),
      // Safras só fazem sentido com dois pontos: com um, não há sobrevivência a medir.
      cohorts: snapshots.length > 1 ? computeCohorts(earliest, latest) : [],
      followersByPeriod: followersByPeriod(latest),
      snapshotCount: snapshots.length,
    };
  });
};

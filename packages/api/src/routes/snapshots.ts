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

    let files: Record<string, unknown>;
    try {
      files = await extractExportFiles(file.file);
    } catch (error) {
      if (error instanceof UnsafeArchiveError) {
        return reply.code(422).send({ error: error.message });
      }
      return reply.code(422).send({
        error: 'Não foi possível abrir este arquivo. Ele é o .zip que o Instagram enviou?',
      });
    }

    const snapshot = parseExport({
      files,
      snapshotId: randomUUID(),
      importedAt: Date.now(),
    });

    // Um snapshot vazio, se salvo, faz o próximo diff reportar a base inteira como
    // perdida. Prefira falhar o import a corromper o histórico.
    if (!isSnapshotUsable(snapshot)) {
      return reply.code(422).send({
        error: 'Não encontramos sua lista de seguidores neste arquivo.',
        hint:
          'Ao pedir o export no Instagram, inclua "Seguidores e seguindo" e escolha ' +
          '"Todo o período". JSON e HTML funcionam.',
        warnings: snapshot.warnings,
      });
    }

    const previous = await loadPreviousSnapshot(profileId, snapshot.importedAt);
    const diff = previous ? diffSnapshots(previous, snapshot) : null;

    await saveSnapshot(profileId, snapshot);
    if (diff) await saveEvents(profileId, diff);

    return {
      snapshotId: snapshot.id,
      format: snapshot.format,
      insights: computeInsights(snapshot),
      diff,
      warnings: snapshot.warnings,
    };
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

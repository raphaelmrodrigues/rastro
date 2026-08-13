/**
 * Persistência de snapshots e eventos.
 *
 * Regra que atravessa este arquivo: snapshot é imutável. Nada aqui faz UPDATE em
 * entries. Se a lógica de diff melhorar, os eventos são recalculados a partir dos
 * snapshots guardados — por isso os snapshots precisam sobreviver intactos.
 */

import type { Snapshot, SnapshotDiff, RelationshipKind } from '@rastro/core';
import { sql } from './client.js';

export interface StoredSnapshotSummary {
  id: string;
  importedAt: number;
  exportedAt: number | null;
  format: string | null;
  followerCount: number;
  followingCount: number;
  warningCount: number;
}

/**
 * Grava o snapshot e todas as suas entries numa transação.
 *
 * Tudo ou nada: um snapshot gravado pela metade tem menos seguidores do que a
 * conta realmente tem, e o próximo diff acusaria a diferença como unfollow em
 * massa. Meio import é pior que import nenhum.
 */
export async function saveSnapshot(profileId: string, snapshot: Snapshot): Promise<void> {
  const rows: Array<{
    snapshot_id: string;
    kind: string;
    username: string;
    since: Date;
    display_name: string | null;
  }> = [];

  for (const [kind, list] of Object.entries(snapshot.relationships)) {
    for (const rel of list) {
      rows.push({
        snapshot_id: snapshot.id,
        kind,
        username: rel.username,
        since: new Date(rel.since),
        display_name: rel.displayName ?? null,
      });
    }
  }

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO snapshots (
        id, profile_id, imported_at, exported_at, format,
        data_window_from, data_window_to,
        follower_count, following_count, warnings
      ) VALUES (
        ${snapshot.id},
        ${profileId},
        ${new Date(snapshot.importedAt)},
        ${snapshot.exportedAt ? new Date(snapshot.exportedAt) : null},
        ${snapshot.format ?? null},
        ${snapshot.dataWindow ? new Date(snapshot.dataWindow.from) : null},
        ${snapshot.dataWindow ? new Date(snapshot.dataWindow.to) : null},
        ${snapshot.relationships.followers.length},
        ${snapshot.relationships.following.length},
        ${JSON.stringify(snapshot.warnings)}
      )
    `;

    // Em lotes: uma conta com 50 mil seguidores estoura o limite de parâmetros
    // do Postgres num INSERT único.
    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await tx`
        INSERT INTO snapshot_entries ${tx(batch, 'snapshot_id', 'kind', 'username', 'since', 'display_name')}
      `;
    }
  });
}

/** Materializa os eventos de um diff. Chamado logo após saveSnapshot. */
export async function saveEvents(profileId: string, diff: SnapshotDiff): Promise<void> {
  const events = [...diff.gained, ...diff.lost].map((event) => ({
    profile_id: profileId,
    username: event.username,
    type: event.type,
    precision: event.precision,
    occurred_at: new Date(event.at),
    window_start: new Date(event.windowStart),
    window_end: new Date(event.windowEnd),
    suspected_rename_of: event.suspectedRename?.counterpart ?? null,
  }));

  if (events.length === 0) return;

  const BATCH = 1000;
  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    await sql`
      INSERT INTO follow_events ${sql(
        batch,
        'profile_id',
        'username',
        'type',
        'precision',
        'occurred_at',
        'window_start',
        'window_end',
        'suspected_rename_of',
      )}
    `;
  }
}

const EMPTY_RELATIONSHIPS = (): Record<RelationshipKind, []> => ({
  followers: [],
  following: [],
  pendingRequestsSent: [],
  recentlyUnfollowed: [],
  blocked: [],
  closeFriends: [],
  restricted: [],
});

/** Reconstrói um Snapshot completo do banco, para alimentar o core. */
export async function loadSnapshot(snapshotId: string): Promise<Snapshot | null> {
  const [head] = await sql`
    SELECT id, imported_at, exported_at, format, data_window_from, data_window_to, warnings
    FROM snapshots WHERE id = ${snapshotId}
  `;
  if (!head) return null;

  const entries = await sql`
    SELECT kind, username, since, display_name
    FROM snapshot_entries WHERE snapshot_id = ${snapshotId}
  `;

  const relationships = EMPTY_RELATIONSHIPS() as Snapshot['relationships'];
  for (const row of entries) {
    const kind = row.kind as RelationshipKind;
    if (!relationships[kind]) continue;
    relationships[kind].push({
      username: row.username,
      since: new Date(row.since).getTime(),
      ...(row.display_name ? { displayName: row.display_name } : {}),
    });
  }

  return {
    id: head.id,
    importedAt: new Date(head.imported_at).getTime(),
    ...(head.exported_at ? { exportedAt: new Date(head.exported_at).getTime() } : {}),
    ...(head.format ? { format: head.format } : {}),
    ...(head.data_window_from && head.data_window_to
      ? {
          dataWindow: {
            from: new Date(head.data_window_from).getTime(),
            to: new Date(head.data_window_to).getTime(),
          },
        }
      : {}),
    relationships,
    warnings: head.warnings ?? [],
  };
}

/** O snapshot anterior ao informado, para o diff. */
export async function loadPreviousSnapshot(
  profileId: string,
  before: number,
): Promise<Snapshot | null> {
  const [row] = await sql`
    SELECT id FROM snapshots
    WHERE profile_id = ${profileId} AND imported_at < ${new Date(before)}
    ORDER BY imported_at DESC
    LIMIT 1
  `;
  return row ? loadSnapshot(row.id) : null;
}

/** Histórico resumido, sem carregar as entries. */
export async function listSnapshots(profileId: string): Promise<StoredSnapshotSummary[]> {
  const rows = await sql`
    SELECT id, imported_at, exported_at, format, follower_count, following_count,
           jsonb_array_length(warnings) AS warning_count
    FROM snapshots
    WHERE profile_id = ${profileId}
    ORDER BY imported_at DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    importedAt: new Date(row.imported_at).getTime(),
    exportedAt: row.exported_at ? new Date(row.exported_at).getTime() : null,
    format: row.format,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    warningCount: Number(row.warning_count),
  }));
}

/** Confere que o perfil pertence ao usuário do token. */
export async function profileBelongsTo(profileId: string, userId: string): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM profiles WHERE id = ${profileId} AND user_id = ${userId}
  `;
  return Boolean(row);
}

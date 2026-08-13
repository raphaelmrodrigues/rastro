/**
 * Estatísticas derivadas de snapshots.
 *
 * Tudo aqui é calculado a partir de dados que realmente temos. Se uma métrica exigir
 * dado que o export não fornece (engajamento, visualizações de perfil), ela não existe.
 * Não estime o que não dá para saber.
 */

import type {
  Account,
  Cohort,
  GrowthPoint,
  Relationship,
  Snapshot,
  SnapshotDiff,
  SnapshotInsights,
} from './types.js';

const strip = (r: Relationship): Account => ({ username: r.username, href: r.href });

/** Recortes calculados sobre um único snapshot — não precisam de histórico. */
export function computeInsights(snapshot: Snapshot, oldestLimit = 50): SnapshotInsights {
  const followers = snapshot.relationships.followers;
  const following = snapshot.relationships.following;

  const followerSet = new Set(followers.map((r) => r.username));
  const followingSet = new Set(following.map((r) => r.username));

  const mutuals = followers.filter((r) => followingSet.has(r.username)).map(strip);
  const notFollowingYouBack = following.filter((r) => !followerSet.has(r.username)).map(strip);
  const youDontFollowBack = followers.filter((r) => !followingSet.has(r.username)).map(strip);

  const oldestFollowers = [...followers].sort((a, b) => a.since - b.since).slice(0, oldestLimit);

  return {
    followerCount: followers.length,
    followingCount: following.length,
    mutuals,
    notFollowingYouBack,
    youDontFollowBack,
    pendingRequestsSent: snapshot.relationships.pendingRequestsSent,
    oldestFollowers,
    ratio: following.length === 0 ? 0 : followers.length / following.length,
  };
}

/** 'YYYY-MM' em UTC. Toda agregação temporal do core usa UTC. */
export function periodKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Safras: agrupa os seguidores pelo mês em que passaram a te seguir e mede quantos
 * sobrevivem no snapshot mais recente.
 *
 * Requer o snapshot mais antigo disponível como base, porque só conseguimos saber a
 * composição original de uma safra se ela já estava presente em algum snapshot nosso.
 * Safras anteriores ao primeiro import são parciais por natureza: só enxergamos quem
 * ainda estava lá. Sinalize isso na UI.
 */
export function computeCohorts(earliest: Snapshot, latest: Snapshot): Cohort[] {
  const survivors = new Set(latest.relationships.followers.map((r) => r.username));
  const buckets = new Map<string, { initial: number; surviving: number }>();

  for (const follower of earliest.relationships.followers) {
    const key = periodKey(follower.since);
    const bucket = buckets.get(key) ?? { initial: 0, surviving: 0 };
    bucket.initial += 1;
    if (survivors.has(follower.username)) bucket.surviving += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([period, b]) => ({
      period,
      initialCount: b.initial,
      survivingCount: b.surviving,
      retentionRate: b.initial === 0 ? 0 : b.surviving / b.initial,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Série de crescimento a partir da linha do tempo de diffs.
 * `baseCount` é a contagem de seguidores no snapshot inicial.
 */
export function computeGrowth(diffs: SnapshotDiff[], baseCount: number): GrowthPoint[] {
  let running = baseCount;
  return diffs.map((d) => {
    const before = running;
    running = running + d.gained.length - d.lost.length;
    return {
      at: d.windowEnd,
      followerCount: running,
      gained: d.gained.length,
      lost: d.lost.length,
      netChange: d.gained.length - d.lost.length,
      churnRate: before === 0 ? 0 : d.lost.length / before,
    };
  });
}

/**
 * Distribuição de entradas por mês dentro de um snapshot.
 * Serve para o usuário identificar picos ("o que eu postei em março?").
 */
export function followersByPeriod(snapshot: Snapshot): Array<{ period: string; count: number }> {
  const buckets = new Map<string, number>();
  for (const f of snapshot.relationships.followers) {
    const key = periodKey(f.since);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([period, count]) => ({ period, count }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Solicitações enviadas que continuam pendentes há mais de N dias.
 * Feature pequena e quase inédita no nicho: dá para limpar pedidos parados há anos.
 */
export function stalePendingRequests(snapshot: Snapshot, olderThanDays = 90, now = Date.now()) {
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
  return snapshot.relationships.pendingRequestsSent
    .filter((r) => r.since < cutoff)
    .sort((a, b) => a.since - b.since);
}

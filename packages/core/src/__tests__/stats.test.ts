import { describe, expect, it } from 'vitest';
import {
  computeCohorts,
  computeGrowth,
  computeInsights,
  followersByPeriod,
  periodKey,
  stalePendingRequests,
} from '../stats.js';
import { diffSnapshots } from '../diff.js';
import type { Relationship, Snapshot } from '../types.js';

const rel = (username: string, since: number): Relationship => ({ username, since });

function snapshot(
  id: string,
  importedAt: number,
  parts: Partial<Snapshot['relationships']>,
): Snapshot {
  return {
    id,
    importedAt,
    relationships: {
      followers: [],
      following: [],
      pendingRequestsSent: [],
      recentlyUnfollowed: [],
      blocked: [],
      closeFriends: [],
      restricted: [],
      ...parts,
    },
    warnings: [],
  };
}

const JAN = Date.UTC(2026, 0, 15);
const FEV = Date.UTC(2026, 1, 15);
const MAR = Date.UTC(2026, 2, 15);

describe('computeInsights', () => {
  const snap = snapshot('s', MAR, {
    followers: [rel('mutuo', JAN), rel('so_me_segue', FEV)],
    following: [rel('mutuo', JAN), rel('so_eu_sigo', FEV)],
  });

  it('separa os três recortes de reciprocidade sem sobreposição', () => {
    const insights = computeInsights(snap);

    expect(insights.mutuals.map((a) => a.username)).toEqual(['mutuo']);
    expect(insights.notFollowingYouBack.map((a) => a.username)).toEqual(['so_eu_sigo']);
    expect(insights.youDontFollowBack.map((a) => a.username)).toEqual(['so_me_segue']);
  });

  it('conta seguidores e seguindo e calcula a razão', () => {
    const insights = computeInsights(snap);

    expect(insights.followerCount).toBe(2);
    expect(insights.followingCount).toBe(2);
    expect(insights.ratio).toBe(1);
  });

  it('não divide por zero quando a conta não segue ninguém', () => {
    const insights = computeInsights(snapshot('s', MAR, { followers: [rel('a', JAN)] }));
    expect(insights.ratio).toBe(0);
  });

  it('ordena os seguidores mais antigos do mais velho para o mais novo', () => {
    const insights = computeInsights(
      snapshot('s', MAR, { followers: [rel('novo', MAR), rel('velho', JAN), rel('medio', FEV)] }),
    );

    expect(insights.oldestFollowers.map((f) => f.username)).toEqual(['velho', 'medio', 'novo']);
  });
});

describe('periodKey', () => {
  it('agrupa por mês em UTC', () => {
    expect(periodKey(Date.UTC(2026, 0, 1))).toBe('2026-01');
    expect(periodKey(Date.UTC(2026, 11, 31))).toBe('2026-12');
  });

  it('não deixa o fim do mês vazar para o mês seguinte', () => {
    // 31/12 às 23:59 UTC continua sendo dezembro, não janeiro.
    expect(periodKey(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12');
  });
});

describe('computeCohorts', () => {
  it('mede quantos de cada safra sobreviveram até o snapshot mais recente', () => {
    const earliest = snapshot('a', FEV, {
      followers: [rel('jan1', JAN), rel('jan2', JAN), rel('fev1', FEV)],
    });
    const latest = snapshot('b', MAR, { followers: [rel('jan1', JAN), rel('fev1', FEV)] });

    const cohorts = computeCohorts(earliest, latest);

    expect(cohorts).toEqual([
      { period: '2026-01', initialCount: 2, survivingCount: 1, retentionRate: 0.5 },
      { period: '2026-02', initialCount: 1, survivingCount: 1, retentionRate: 1 },
    ]);
  });

  it('devolve as safras em ordem cronológica', () => {
    const earliest = snapshot('a', MAR, {
      followers: [rel('c', MAR), rel('a', JAN), rel('b', FEV)],
    });

    expect(computeCohorts(earliest, earliest).map((c) => c.period)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });
});

describe('computeGrowth', () => {
  it('acumula a contagem ao longo da linha do tempo', () => {
    const s1 = snapshot('1', JAN, { followers: [rel('a', JAN), rel('b', JAN)] });
    const s2 = snapshot('2', FEV, { followers: [rel('a', JAN), rel('c', FEV), rel('d', FEV)] });

    const growth = computeGrowth([diffSnapshots(s1, s2)], 2);

    expect(growth).toHaveLength(1);
    expect(growth[0].gained).toBe(2);
    expect(growth[0].lost).toBe(1);
    expect(growth[0].netChange).toBe(1);
    expect(growth[0].followerCount).toBe(3);
    expect(growth[0].churnRate).toBe(0.5); // 1 perdido sobre base de 2
  });

  it('não divide por zero quando a base começa vazia', () => {
    const s1 = snapshot('1', JAN, { followers: [] });
    const s2 = snapshot('2', FEV, { followers: [rel('a', FEV)] });

    expect(computeGrowth([diffSnapshots(s1, s2)], 0)[0].churnRate).toBe(0);
  });
});

describe('followersByPeriod', () => {
  it('conta entradas por mês, em ordem', () => {
    const snap = snapshot('s', MAR, {
      followers: [rel('a', JAN), rel('b', JAN), rel('c', MAR)],
    });

    expect(followersByPeriod(snap)).toEqual([
      { period: '2026-01', count: 2 },
      { period: '2026-03', count: 1 },
    ]);
  });
});

describe('stalePendingRequests', () => {
  it('lista só os pedidos parados além do limite, do mais antigo ao mais recente', () => {
    const agora = Date.UTC(2026, 5, 1);
    const snap = snapshot('s', agora, {
      pendingRequestsSent: [
        rel('recente', Date.UTC(2026, 4, 25)),
        rel('antigo', Date.UTC(2025, 0, 1)),
        rel('medio', Date.UTC(2026, 0, 1)),
      ],
    });

    const stale = stalePendingRequests(snap, 90, agora);

    expect(stale.map((r) => r.username)).toEqual(['antigo', 'medio']);
  });
});

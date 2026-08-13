import { describe, expect, it } from 'vitest';
import { diffSnapshots, diffTimeline } from '../diff.js';
import { parseExport } from '../parser.js';
import type { Relationship, Snapshot } from '../types.js';

/**
 * Datas realistas de propósito.
 *
 * Fixtures com `since: 100` escondem bugs: qualquer par de contas fica dentro da
 * tolerância de renomeação e o diff passa a colapsar gente que não tem relação
 * nenhuma entre si. Aqui os imports são quinzenais e os `since` são datas de
 * verdade, como no uso real.
 */
const IMPORT_1 = Date.UTC(2026, 2, 1); // 01/03/2026
const IMPORT_2 = Date.UTC(2026, 2, 15); // 15/03/2026
const IMPORT_3 = Date.UTC(2026, 2, 29);

/** Alguém que já seguia bem antes do primeiro import. */
const ANTIGO = Date.UTC(2025, 5, 10);
/** Alguém que passou a seguir dentro da janela entre os dois imports. */
const DENTRO_DA_JANELA = Date.UTC(2026, 2, 7);

function rel(username: string, sinceMs: number): Relationship {
  return { username, since: sinceMs };
}

function snapshot(
  id: string,
  importedAt: number,
  followers: Relationship[],
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    id,
    importedAt,
    relationships: {
      followers,
      following: [],
      pendingRequestsSent: [],
      recentlyUnfollowed: [],
      blocked: [],
      closeFriends: [],
      restricted: [],
    },
    warnings: [],
    ...extra,
  };
}

describe('diffSnapshots', () => {
  it('identifica entradas e saídas', () => {
    const before = snapshot('a', IMPORT_1, [rel('ana', ANTIGO), rel('bruno', ANTIGO)]);
    const after = snapshot('b', IMPORT_2, [rel('ana', ANTIGO), rel('carla', DENTRO_DA_JANELA)]);

    const diff = diffSnapshots(before, after);

    expect(diff.gained.map((e) => e.username)).toEqual(['carla']);
    expect(diff.lost.map((e) => e.username)).toEqual(['bruno']);
    expect(diff.netChange).toBe(0);
  });

  it('usa data exata para quem entrou e janela para quem saiu', () => {
    const before = snapshot('a', IMPORT_1, [rel('bruno', ANTIGO)]);
    const after = snapshot('b', IMPORT_2, [rel('carla', DENTRO_DA_JANELA)]);

    const diff = diffSnapshots(before, after);

    // Entrada: o export diz o momento exato.
    expect(diff.gained[0].precision).toBe('exact');
    expect(diff.gained[0].at).toBe(DENTRO_DA_JANELA);

    // Saída: só sabemos que foi entre os dois imports. Nunca afirmar mais que isso.
    expect(diff.lost[0].precision).toBe('window');
    expect(diff.lost[0].windowStart).toBe(IMPORT_1);
    expect(diff.lost[0].windowEnd).toBe(IMPORT_2);
  });

  it('trata troca de @ como renomeação, não como unfollow', () => {
    // Mesmo `since`, anterior ao último import: o Instagram preserva a data ao renomear.
    const before = snapshot('a', IMPORT_1, [rel('joao_antigo', ANTIGO)]);
    const after = snapshot('b', IMPORT_2, [rel('joao_novo', ANTIGO)]);

    const diff = diffSnapshots(before, after);

    expect(diff.renames).toEqual([{ from: 'joao_antigo', to: 'joao_novo', confidence: 'high' }]);
    // O ponto da feature: nada de falso "deixou de seguir".
    expect(diff.lost).toHaveLength(0);
    expect(diff.gained).toHaveLength(0);
    expect(diff.netChange).toBe(0);
  });

  it('marca rename de confiança média sem esconder o evento', () => {
    const before = snapshot('a', IMPORT_1, [rel('maria_a', ANTIGO)]);
    const after = snapshot('b', IMPORT_2, [rel('maria_b', ANTIGO + 30_000)]); // 30s de diferença

    const diff = diffSnapshots(before, after);

    expect(diff.lost).toHaveLength(1);
    expect(diff.lost[0].suspectedRename).toEqual({ counterpart: 'maria_b', confidence: 'medium' });
  });

  it('não confunde seguidor novo com renomeação quando dois entram no mesmo minuto', () => {
    // Cenário real: um post rende bem e várias pessoas seguem no mesmo minuto.
    // Uma delas sai depois. Só a proximidade de `since` faria o diff anunciar uma
    // troca de @ inexistente — e sumir com um unfollow verdadeiro da lista.
    const pico = Date.UTC(2026, 2, 7, 20, 15);
    const before = snapshot('a', IMPORT_1, [rel('quem_saiu', pico)]);
    const after = snapshot('b', IMPORT_2, [rel('quem_entrou', pico + 500)]);

    const diff = diffSnapshots(before, after);

    expect(diff.renames).toHaveLength(0);
    expect(diff.lost.map((e) => e.username)).toEqual(['quem_saiu']);
    expect(diff.gained.map((e) => e.username)).toEqual(['quem_entrou']);
  });

  it('não inventa unfollow quando nada mudou', () => {
    const followers = [rel('ana', ANTIGO), rel('bruno', ANTIGO)];
    const diff = diffSnapshots(
      snapshot('a', IMPORT_1, followers),
      snapshot('b', IMPORT_2, [...followers]),
    );

    expect(diff.gained).toHaveLength(0);
    expect(diff.lost).toHaveLength(0);
    expect(diff.reliability.level).toBe('ok');
  });
});

describe('confiabilidade do diff', () => {
  const base = Array.from({ length: 100 }, (_, i) => rel(`conta${i}`, ANTIGO));

  it('desconfia quando some uma fatia grande da base de uma vez', () => {
    // Sintoma clássico de followers_2 que não veio no zip.
    const diff = diffSnapshots(
      snapshot('a', IMPORT_1, base),
      snapshot('b', IMPORT_2, base.slice(0, 50)),
    );

    expect(diff.reliability.level).toBe('suspect');
    expect(diff.reliability.reasons[0]).toContain('50%');
  });

  it('desconfia ao comparar export completo com export de período limitado', () => {
    const diff = diffSnapshots(
      snapshot('a', IMPORT_1, base),
      snapshot('b', IMPORT_2, base, {
        dataWindow: { from: Date.UTC(2025, 7, 12), to: Date.UTC(2026, 7, 12) },
      }),
    );

    expect(diff.reliability.level).toBe('suspect');
    expect(diff.reliability.reasons[0]).toContain('Todo o período');
  });

  it('não desconfia de perda pequena numa base grande', () => {
    const diff = diffSnapshots(
      snapshot('a', IMPORT_1, base),
      snapshot('b', IMPORT_2, base.slice(0, 95)),
    );

    expect(diff.reliability.level).toBe('ok');
  });

  it('não desconfia de conta pequena, onde a proporção não significa nada', () => {
    // Perder 2 de 5 seguidores é 40% e é completamente normal.
    const pequena = [rel('a', ANTIGO), rel('b', ANTIGO), rel('c', ANTIGO), rel('d', ANTIGO), rel('e', ANTIGO)];
    const diff = diffSnapshots(
      snapshot('a', IMPORT_1, pequena),
      snapshot('b', IMPORT_2, pequena.slice(0, 3)),
    );

    expect(diff.reliability.level).toBe('ok');
  });
});

describe('diffTimeline', () => {
  it('compara os snapshots em ordem cronológica, mesmo fora de ordem na entrada', () => {
    const s1 = snapshot('1', IMPORT_1, [rel('ana', ANTIGO)]);
    const s2 = snapshot('2', IMPORT_2, [rel('ana', ANTIGO), rel('bruno', DENTRO_DA_JANELA)]);
    const s3 = snapshot('3', IMPORT_3, [rel('bruno', DENTRO_DA_JANELA)]);

    const diffs = diffTimeline([s3, s1, s2]);

    expect(diffs).toHaveLength(2);
    expect(diffs[0].gained.map((e) => e.username)).toEqual(['bruno']);
    expect(diffs[1].lost.map((e) => e.username)).toEqual(['ana']);
  });
});

describe('parseExport', () => {
  it('agrega followers paginados em vez de usar só o primeiro arquivo', () => {
    // Regressão do bug mais destrutivo possível: ler só followers_1.json faz
    // toda a base restante virar "deixou de seguir" no diff seguinte.
    const entry = (value: string, timestamp: number) => ({
      string_list_data: [{ value, timestamp, href: `https://instagram.com/${value}` }],
    });

    const snap = parseExport({
      snapshotId: 's1',
      importedAt: IMPORT_1,
      files: {
        'connections/followers_and_following/followers_1.json': [entry('ana', 1000)],
        'connections/followers_and_following/followers_2.json': [entry('bruno', 2000)],
        'connections/followers_and_following/followers_3.json': [entry('carla', 3000)],
      },
    });

    expect(snap.relationships.followers.map((f) => f.username).sort()).toEqual([
      'ana',
      'bruno',
      'carla',
    ]);
  });

  it('aceita tanto array na raiz quanto objeto com chave nomeada', () => {
    const snap = parseExport({
      snapshotId: 's1',
      importedAt: IMPORT_1,
      files: {
        'connections/followers_and_following/followers_1.json': [
          { string_list_data: [{ value: 'ana', timestamp: 1000 }] },
        ],
        'connections/followers_and_following/following.json': {
          relationships_following: [{ string_list_data: [{ value: 'bruno', timestamp: 2000 }] }],
        },
      },
    });

    expect(snap.relationships.followers).toHaveLength(1);
    expect(snap.relationships.following[0].username).toBe('bruno');
  });

  it('converte timestamp de segundos para milissegundos', () => {
    const snap = parseExport({
      snapshotId: 's1',
      importedAt: IMPORT_1,
      files: {
        'connections/followers_and_following/followers_1.json': [
          { string_list_data: [{ value: 'ana', timestamp: 1_719_878_400 }] },
        ],
      },
    });

    expect(snap.relationships.followers[0].since).toBe(1_719_878_400_000);
  });

  it('registra warning em vez de quebrar quando o formato é desconhecido', () => {
    const snap = parseExport({
      snapshotId: 's1',
      importedAt: IMPORT_1,
      files: {
        'connections/followers_and_following/followers_1.json': { inesperado: 'coisa' },
      },
    });

    expect(snap.warnings.some((w) => w.code === 'UNKNOWN_FILE_SHAPE')).toBe(true);
    expect(snap.relationships.followers).toHaveLength(0);
  });
});

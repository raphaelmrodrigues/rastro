/**
 * Testes da vistoria do arquivo.
 *
 * O que está sendo protegido aqui é a decisão de deixar ou não um arquivo virar
 * histórico. Um falso "pode passar" corrompe a série e faz o app acusar centenas
 * de saídas que não houve; um falso "bloqueado" expulsa quem tem um arquivo bom.
 * Os dois lados têm teste.
 */

import { describe, expect, it } from 'vitest';
import {
  checkExport,
  oldestRelationship,
  type ExportCheckInput,
  type ExportProblemCode,
} from '../completeness.js';
import type { Relationship, Snapshot } from '../types.js';

const DIA = 24 * 3600 * 1000;
const ANO = 365 * DIA;
const AGORA = Date.UTC(2026, 7, 21);

function pessoas(quantas: number, desde: number, ate = AGORA): Relationship[] {
  const passo = quantas > 1 ? (ate - desde) / (quantas - 1) : 0;
  return Array.from({ length: quantas }, (_, i) => ({
    username: `pessoa${i}`,
    since: Math.round(desde + passo * i),
  }));
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 's1',
    importedAt: AGORA,
    format: 'json',
    relationships: {
      followers: pessoas(300, AGORA - 10 * ANO),
      following: pessoas(200, AGORA - 10 * ANO),
      pendingRequestsSent: [],
      recentlyUnfollowed: [],
      blocked: [],
      closeFriends: [],
      restricted: [],
    },
    warnings: [],
    ...over,
  };
}

const codigos = (s: Snapshot, resto: Partial<ExportCheckInput> = {}): ExportProblemCode[] =>
  checkExport({ snapshot: s, now: AGORA, activityFiles: 1, ...resto }).problems.map((p) => p.code);

describe('checkExport — o que bloqueia', () => {
  it('bloqueia export em HTML', () => {
    const r = checkExport({ snapshot: snapshot({ format: 'html' }), now: AGORA, activityFiles: 1 });
    expect(r.ok).toBe(false);
    expect(r.problems.find((p) => p.code === 'FORMAT_HTML')?.severity).toBe('block');
  });

  it('bloqueia export misto (HTML e JSON no mesmo zip)', () => {
    expect(checkExport({ snapshot: snapshot({ format: 'mixed' }), now: AGORA }).ok).toBe(false);
  });

  it('bloqueia arquivo sem lista de seguidores', () => {
    const s = snapshot();
    s.relationships.followers = [];
    expect(codigos(s)).toContain('MISSING_FOLLOWERS');
    expect(checkExport({ snapshot: s, now: AGORA }).ok).toBe(false);
  });

  it('bloqueia arquivo sem lista de "seguindo"', () => {
    const s = snapshot();
    s.relationships.following = [];
    expect(codigos(s)).toContain('MISSING_FOLLOWING');
  });

  it('não reclama de "seguindo" vazio quando seguidores também está vazio', () => {
    const s = snapshot();
    s.relationships.followers = [];
    s.relationships.following = [];
    // Uma causa só, uma mensagem só: o arquivo não tem as listas.
    expect(codigos(s)).not.toContain('MISSING_FOLLOWING');
  });

  it('bloqueia quando o próprio arquivo declara um período', () => {
    const s = snapshot({ dataWindow: { from: AGORA - ANO, to: AGORA } });
    const r = checkExport({ snapshot: s, now: AGORA, activityFiles: 1 });
    expect(r.ok).toBe(false);
    const problema = r.problems.find((p) => p.code === 'DECLARED_WINDOW');
    expect(problema?.severity).toBe('block');
    // O texto precisa dizer o tamanho da janela: é o que convence a pedir de novo.
    expect(problema?.detail).toMatch(/12 meses/);
  });

  it('bloqueia queda de mais de 30% quando o arquivo não prova ser completo', () => {
    // Sem `accountCreatedAt` não dá para saber se o arquivo é completo, e a
    // queda tem a forma exata de um export recortado.
    const previous = snapshot({ id: 's0' });
    const atual = snapshot();
    atual.relationships.followers = pessoas(150, AGORA - 10 * ANO);

    const r = checkExport({ snapshot: atual, previous, now: AGORA, activityFiles: 1 });
    expect(r.ok).toBe(false);
    expect(r.problems.find((p) => p.code === 'MASS_LOSS')?.detail).toMatch(/150/);
  });

  /*
   * O caso oposto, e ele é real: limpeza de contas falsas pelo Instagram, ou
   * uma conta que viralizou e esvaziou. Bloquear aí trancaria a pessoa fora do
   * próprio histórico por um evento que de fato aconteceu.
   */
  it('só pergunta quando o arquivo alcança o começo da conta', () => {
    const nascimento = AGORA - 10 * ANO;
    const previous = snapshot({ id: 's0', accountCreatedAt: nascimento });
    const atual = snapshot({ accountCreatedAt: nascimento });
    atual.relationships.followers = pessoas(150, nascimento);

    const r = checkExport({ snapshot: atual, previous, now: AGORA, activityFiles: 1 });
    expect(r.problems.find((p) => p.code === 'MASS_LOSS')?.severity).toBe('confirm');
    expect(r.ok).toBe(true);
  });

  it('volta a bloquear se o arquivo declara período, por mais fundo que alcance', () => {
    const nascimento = AGORA - 10 * ANO;
    const previous = snapshot({ id: 's0', accountCreatedAt: nascimento });
    const atual = snapshot({
      accountCreatedAt: nascimento,
      dataWindow: { from: AGORA - ANO, to: AGORA },
    });
    atual.relationships.followers = pessoas(150, nascimento);

    const r = checkExport({ snapshot: atual, previous, now: AGORA, activityFiles: 1 });
    expect(r.ok).toBe(false);
    expect(r.problems.find((p) => p.code === 'MASS_LOSS')?.severity).toBe('block');
  });

  /*
   * A fila de faxina (`lib/fila.ts`) existe para o usuário deixar de seguir
   * muita gente. O app não pode punir quem usou a funcionalidade que ele
   * oferece — e a regra olha `followers` justamente por isso.
   */
  it('não reage a deixar de seguir em massa, por maior que seja a faxina', () => {
    const nascimento = AGORA - 10 * ANO;
    const previous = snapshot({ id: 's0', accountCreatedAt: nascimento });
    const atual = snapshot({ accountCreatedAt: nascimento });
    // Seguia 200, agora segue 5. Seguidores intactos.
    atual.relationships.following = pessoas(5, nascimento);

    const r = checkExport({ snapshot: atual, previous, now: AGORA, activityFiles: 1 });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('deixa passar uma queda pequena, que é saída de verdade', () => {
    const previous = snapshot({ id: 's0' });
    const atual = snapshot();
    atual.relationships.followers = pessoas(290, AGORA - 10 * ANO);
    expect(checkExport({ snapshot: atual, previous, now: AGORA, activityFiles: 1 }).ok).toBe(true);
  });

  it('deixa passar crescimento, por maior que seja', () => {
    const previous = snapshot({ id: 's0' });
    const atual = snapshot();
    atual.relationships.followers = pessoas(3000, AGORA - 10 * ANO);
    expect(checkExport({ snapshot: atual, previous, now: AGORA, activityFiles: 1 }).ok).toBe(true);
  });
});

describe('checkExport — histórico raso', () => {
  const nascimento = AGORA - 10 * ANO;

  it('desconfia de conta velha cuja lista só cobre o último ano', () => {
    const s = snapshot({ accountCreatedAt: nascimento });
    s.relationships.followers = pessoas(300, AGORA - ANO);
    s.relationships.following = pessoas(200, AGORA - ANO);

    const r = checkExport({ snapshot: s, previous: snapshot({ id: 's0' }), now: AGORA, activityFiles: 1 });
    const problema = r.problems.find((p) => p.code === 'SHALLOW_HISTORY');
    expect(problema?.severity).toBe('confirm');
    // Indício não é prova: quem decide é quem conhece a conta.
    expect(r.ok).toBe(true);
  });

  it('não desconfia quando a lista cobre a vida da conta', () => {
    const s = snapshot({ accountCreatedAt: nascimento });
    expect(codigos(s, { previous: snapshot({ id: 's0' }) })).not.toContain('SHALLOW_HISTORY');
  });

  it('não desconfia de conta nova, onde tudo é recente por definição', () => {
    const s = snapshot({ accountCreatedAt: AGORA - 6 * 30 * DIA });
    s.relationships.followers = pessoas(300, AGORA - 5 * 30 * DIA);
    s.relationships.following = pessoas(200, AGORA - 5 * 30 * DIA);
    expect(codigos(s, { previous: snapshot({ id: 's0' }) })).not.toContain('SHALLOW_HISTORY');
  });

  it('não desconfia de lista pequena, onde a distribuição não diz nada', () => {
    const s = snapshot({ accountCreatedAt: nascimento });
    s.relationships.followers = pessoas(12, AGORA - 30 * DIA);
    s.relationships.following = pessoas(8, AGORA - 30 * DIA);
    expect(codigos(s, { previous: snapshot({ id: 's0' }) })).not.toContain('SHALLOW_HISTORY');
  });

  it('não desconfia sem saber a idade da conta', () => {
    const s = snapshot();
    s.relationships.followers = pessoas(300, AGORA - ANO);
    s.relationships.following = pessoas(200, AGORA - ANO);
    expect(codigos(s, { previous: snapshot({ id: 's0' }) })).not.toContain('SHALLOW_HISTORY');
  });
});

describe('checkExport — primeiro import', () => {
  it('pede conferência da contagem quando não há com o que comparar', () => {
    const r = checkExport({ snapshot: snapshot(), now: AGORA, activityFiles: 1 });
    const problema = r.problems.find((p) => p.code === 'CONFIRM_COUNT');
    expect(problema?.severity).toBe('confirm');
    expect(problema?.detail).toMatch(/300 seguidores/);
    expect(r.ok).toBe(true);
    expect(r.needsConfirmation).toBe(true);
  });

  it('não pede conferência quando já existe arquivo anterior', () => {
    expect(codigos(snapshot(), { previous: snapshot({ id: 's0' }) })).not.toContain('CONFIRM_COUNT');
  });
});

describe('checkExport — categorias', () => {
  it('avisa, sem bloquear, quando o export não trouxe atividade', () => {
    const r = checkExport({ snapshot: snapshot(), previous: snapshot({ id: 's0' }), now: AGORA, activityFiles: 0 });
    expect(r.problems.find((p) => p.code === 'NO_ACTIVITY')?.severity).toBe('warn');
    expect(r.ok).toBe(true);
    expect(r.needsConfirmation).toBe(false);
  });

  it('não avisa quando a atividade veio', () => {
    expect(codigos(snapshot(), { previous: snapshot({ id: 's0' }), activityFiles: 1200 })).not.toContain(
      'NO_ACTIVITY',
    );
  });
});

describe('checkExport — ordem e forma', () => {
  it('põe o bloqueio antes do aviso', () => {
    const s = snapshot({ format: 'html' });
    const r = checkExport({ snapshot: s, now: AGORA, activityFiles: 0 });
    expect(r.problems[0]?.severity).toBe('block');
    expect(r.problems[r.problems.length - 1]?.severity).toBe('warn');
  });

  it('todo problema traz título e detalhe preenchidos', () => {
    const s = snapshot({ format: 'html', dataWindow: { from: AGORA - ANO, to: AGORA } });
    for (const p of checkExport({ snapshot: s, now: AGORA, activityFiles: 0 }).problems) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.detail.length).toBeGreaterThan(0);
    }
  });

  it('arquivo bom e completo não gera problema nenhum', () => {
    const r = checkExport({
      snapshot: snapshot({ accountCreatedAt: AGORA - 10 * ANO }),
      previous: snapshot({ id: 's0' }),
      now: AGORA,
      activityFiles: 1200,
    });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('oldestRelationship', () => {
  it('ignora registros sem data em vez de lê-los como 1970', () => {
    const s = snapshot();
    s.relationships.followers = [
      { username: 'sem-data', since: 0 },
      { username: 'com-data', since: AGORA - ANO },
    ];
    s.relationships.following = [];
    expect(oldestRelationship(s)).toBe(AGORA - ANO);
  });

  it('olha as duas listas, não só seguidores', () => {
    const s = snapshot();
    s.relationships.followers = pessoas(3, AGORA - ANO);
    s.relationships.following = pessoas(3, AGORA - 5 * ANO);
    expect(oldestRelationship(s)).toBe(AGORA - 5 * ANO);
  });

  it('devolve null quando nenhuma relação tem data', () => {
    const s = snapshot();
    s.relationships.followers = [{ username: 'a', since: 0 }];
    s.relationships.following = [];
    expect(oldestRelationship(s)).toBeNull();
  });
});

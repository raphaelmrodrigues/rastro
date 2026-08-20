/**
 * Trava do contrato da telemetria.
 *
 * O que estes testes protegem não é um comportamento de interface — é a promessa
 * de privacidade. O relato de falha existe para descobrir que o parser quebrou,
 * e o caminho mais fácil de estragar isso é alguém mandar o `ParseWarning`
 * inteiro "porque tem mais contexto". O `detail` do warning é texto livre e vem
 * assim: `Entrada "fulano.silva" sem timestamp`.
 *
 * Se algum destes testes falhar, alguém abriu uma porta para o @ dos usuários
 * chegar ao nosso banco.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { corpoSchema } from '../routes/telemetria.js';

const parseValido = {
  kind: 'parse' as const,
  appVersion: '0.1.0',
  platform: 'android' as const,
  warnings: [{ code: 'ENTRIES_SKIPPED', file: 'following.json', count: 1355 }],
  format: 'json' as const,
  followers: 0,
  following: 0,
  files: 2,
};

describe('corpoSchema — relato de parsing', () => {
  it('aceita código, arquivo e contagem', () => {
    assert.equal(corpoSchema.safeParse(parseValido).success, true);
  });

  it('RECUSA campo extra no corpo', () => {
    const r = corpoSchema.safeParse({ ...parseValido, usuario: 'fulano.silva' });
    assert.equal(r.success, false);
  });

  it('RECUSA texto livre dentro do aviso', () => {
    // Esta é a forma exata do vazamento que o schema existe para barrar.
    const r = corpoSchema.safeParse({
      ...parseValido,
      warnings: [
        { code: 'MISSING_TIMESTAMP', count: 1, detail: 'Entrada "fulano.silva" sem timestamp' },
      ],
    });
    assert.equal(r.success, false);
  });

  it('RECUSA lista de @ disfarçada de aviso', () => {
    const r = corpoSchema.safeParse({
      ...parseValido,
      warnings: [{ code: 'X', count: 1, usernames: ['ana', 'bruno'] }],
    });
    assert.equal(r.success, false);
  });

  it('recusa contagem absurda e código gigante', () => {
    assert.equal(
      corpoSchema.safeParse({ ...parseValido, warnings: [{ code: 'X', count: 999_999_999 }] }).success,
      false,
    );
    assert.equal(
      corpoSchema.safeParse({ ...parseValido, warnings: [{ code: 'x'.repeat(200), count: 1 }] })
        .success,
      false,
    );
  });

  it('recusa mais de 50 avisos', () => {
    const muitos = Array.from({ length: 51 }, (_, i) => ({ code: `C${i}`, count: 1 }));
    assert.equal(corpoSchema.safeParse({ ...parseValido, warnings: muitos }).success, false);
  });

  it('recusa formato e plataforma fora da lista', () => {
    assert.equal(corpoSchema.safeParse({ ...parseValido, format: 'xml' }).success, false);
    assert.equal(corpoSchema.safeParse({ ...parseValido, platform: 'windows' }).success, false);
  });
});

describe('corpoSchema — relato de erro', () => {
  const crashValido = {
    kind: 'crash' as const,
    name: 'TypeError',
    message: 'Cannot read property length of undefined',
  };

  it('aceita o mínimo', () => {
    assert.equal(corpoSchema.safeParse(crashValido).success, true);
  });

  it('RECUSA campo extra', () => {
    const r = corpoSchema.safeParse({ ...crashValido, snapshot: { followers: ['ana'] } });
    assert.equal(r.success, false);
  });

  it('recusa mensagem e stack acima do limite', () => {
    // 1000 é o teto da mensagem desde 20/08/2026: no Android o rastro de pilha
    // do Java chega dentro dela, e 500 cortava no meio. Ver routes/telemetria.ts.
    assert.equal(
      corpoSchema.safeParse({ ...crashValido, message: 'x'.repeat(1000) }).success,
      true,
    );
    assert.equal(
      corpoSchema.safeParse({ ...crashValido, message: 'x'.repeat(1001) }).success,
      false,
    );
    assert.equal(
      corpoSchema.safeParse({ ...crashValido, stack: 'x'.repeat(4001) }).success,
      false,
    );
  });
});

describe('corpoSchema — forma do corpo', () => {
  it('recusa kind desconhecido', () => {
    assert.equal(corpoSchema.safeParse({ kind: 'analytics', evento: 'abriu' }).success, false);
  });

  it('recusa lixo', () => {
    for (const lixo of [null, undefined, 42, 'texto', [], {}]) {
      assert.equal(corpoSchema.safeParse(lixo).success, false);
    }
  });
});

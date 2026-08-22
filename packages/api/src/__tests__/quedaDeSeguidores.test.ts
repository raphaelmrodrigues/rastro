/**
 * Faixa de silêncio do aviso de queda.
 *
 * Pequena e com teste porque a faixa padrão (22h → 8h) cruza a meia-noite, e a
 * comparação ingênua `hora >= inicio && hora < fim` é sempre falsa nesse caso —
 * o efeito seria silêncio nunca, e o app acordando gente às três da manhã para
 * dizer que perdeu um seguidor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emSilencio } from '../lib/quedaDeSeguidores.js';

describe('emSilencio', () => {
  it('silencia a madrugada na faixa padrão de 22h às 8h', () => {
    for (const hora of [22, 23, 0, 3, 7]) {
      assert.equal(emSilencio(hora, 22, 8), true, `${hora}h deveria estar em silêncio`);
    }
  });

  it('deixa passar o horário de vigília na faixa padrão', () => {
    for (const hora of [8, 12, 18, 21]) {
      assert.equal(emSilencio(hora, 22, 8), false, `${hora}h deveria receber`);
    }
  });

  it('funciona também em faixa que não cruza a meia-noite', () => {
    assert.equal(emSilencio(14, 13, 15), true);
    assert.equal(emSilencio(12, 13, 15), false);
    assert.equal(emSilencio(15, 13, 15), false, 'o fim é exclusivo');
  });

  it('início igual ao fim é "sem silêncio", não "silêncio o dia inteiro"', () => {
    // A leitura oposta calaria o aviso para sempre por causa de uma configuração
    // que parece neutra.
    for (const hora of [0, 9, 23]) {
      assert.equal(emSilencio(hora, 9, 9), false);
    }
  });
});

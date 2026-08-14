/**
 * Testes do corte de versão.
 *
 * Esta é a função com a pior relação entre tamanho e consequência do projeto: um
 * erro aqui ou derruba todos os usuários de uma vez, ou não derruba ninguém
 * quando deveria. E a armadilha é conhecida — comparar "1.10.0" com "1.9.0" como
 * texto dá o resultado errado.
 *
 * Usa `node:test` em vez do Vitest: a api não tem runner configurado, e o do
 * Node basta para uma função pura. `npm test --workspace @rastro/api`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { versaoMenorQue, versaoRecusada } from '../lib/versaoDoApp.js';

describe('versaoMenorQue', () => {
  it('compara número a número, não texto', () => {
    // O caso que a comparação de strings erra: "1.10.0" < "1.9.0" como texto.
    assert.equal(versaoMenorQue('1.9.0', '1.10.0'), true);
    assert.equal(versaoMenorQue('1.10.0', '1.9.0'), false);
  });

  it('versão igual à mínima passa', () => {
    assert.equal(versaoMenorQue('1.2.3', '1.2.3'), false);
  });

  it('respeita a precedência major > minor > patch', () => {
    assert.equal(versaoMenorQue('1.99.99', '2.0.0'), true);
    assert.equal(versaoMenorQue('2.0.0', '1.99.99'), false);
    assert.equal(versaoMenorQue('1.2.3', '1.2.4'), true);
  });

  it('trata versão incompleta como zero nas partes ausentes', () => {
    assert.equal(versaoMenorQue('1.2', '1.2.1'), true);
    assert.equal(versaoMenorQue('2', '1.9.9'), false);
  });

  it('não quebra com lixo no lugar da versão', () => {
    // Um cliente adulterado pode mandar qualquer coisa. O que não pode é o
    // servidor lançar exceção e transformar isso em erro 500.
    assert.equal(versaoMenorQue('', '1.0.0'), true);
    assert.equal(versaoMenorQue('abc', '1.0.0'), true);
    assert.equal(versaoMenorQue('1.x.3', '1.0.0'), false);
  });
});

describe('versaoRecusada', () => {
  const comMinima = <T>(valor: string | undefined, executar: () => T): T => {
    const antes = process.env.VERSAO_MINIMA_APP;
    if (valor === undefined) delete process.env.VERSAO_MINIMA_APP;
    else process.env.VERSAO_MINIMA_APP = valor;
    try {
      return executar();
    } finally {
      if (antes === undefined) delete process.env.VERSAO_MINIMA_APP;
      else process.env.VERSAO_MINIMA_APP = antes;
    }
  };

  it('sem VERSAO_MINIMA_APP configurada, ninguém é recusado', () => {
    comMinima(undefined, () => {
      assert.equal(versaoRecusada('0.0.1'), null);
    });
  });

  it('variável vazia também desliga a verificação', () => {
    comMinima('  ', () => {
      assert.equal(versaoRecusada('0.0.1'), null);
    });
  });

  it('recusa quem está abaixo e devolve a mínima exigida', () => {
    comMinima('1.5.0', () => {
      assert.equal(versaoRecusada('1.4.9'), '1.5.0');
      assert.equal(versaoRecusada('1.5.0'), null);
      assert.equal(versaoRecusada('2.0.0'), null);
    });
  });

  it('requisição sem o cabeçalho passa', () => {
    // Versões anteriores à v1.0 não mandam o cabeçalho. Recusá-las travaria o
    // app antes de existir usuário — e quem não manda a versão também não sabe
    // mostrar a tela de atualização, então recusar não levaria a lugar nenhum.
    comMinima('1.5.0', () => {
      assert.equal(versaoRecusada(undefined), null);
    });
  });

  it('ignora espaços em volta do valor', () => {
    comMinima(' 1.5.0 ', () => {
      assert.equal(versaoRecusada(' 1.4.0 '), '1.5.0');
    });
  });
});

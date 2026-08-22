/**
 * O cofre ponta a ponta.
 *
 * O que estes testes protegem é a promessa que sustenta a decisão de guardar
 * mensagem direta no servidor: **o servidor grava sem poder ler**. Se algum
 * destes falhar, o Rastro passou a ser um banco com DM legível de gente que
 * nunca foi usuária nossa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { abrir, chavePublicaValida, CofreInvalido, selar } from '../lib/cofre.js';

/** O que o aparelho faz: gera o par e manda só a pública. */
function aparelho() {
  const par = nacl.box.keyPair();
  return {
    publica: Buffer.from(par.publicKey).toString('base64'),
    privada: Buffer.from(par.secretKey).toString('base64'),
  };
}

describe('selar e abrir', () => {
  it('o dono da chave privada lê o que foi selado para ele', () => {
    const { publica, privada } = aparelho();
    const texto = JSON.stringify({ text: 'oi, tudo bem?', username: 'ana.souza' });
    assert.equal(abrir(selar(texto, publica), privada), texto);
  });

  it('preserva acento e emoji, que é o conteúdo real de uma DM', () => {
    const { publica, privada } = aparelho();
    const texto = 'não vou conseguir hoje 😅 amanhã dá?';
    assert.equal(abrir(selar(texto, publica), privada), texto);
  });

  it('dois selos do mesmo texto são diferentes', () => {
    // Par efêmero e nonce novos a cada chamada. Sem isso, quem lê o banco
    // descobre quais mensagens são iguais entre si sem abrir nenhuma.
    const { publica } = aparelho();
    assert.notEqual(selar('mesma coisa', publica), selar('mesma coisa', publica));
  });

  it('a chave de outro aparelho não abre', () => {
    const alvo = aparelho();
    const intruso = aparelho();
    assert.throws(() => abrir(selar('segredo', alvo.publica), intruso.privada), CofreInvalido);
  });

  it('um byte alterado no selo derruba a abertura', () => {
    // XSalsa20-Poly1305 é autenticado: adulteração não vira texto lixo, vira erro.
    const { publica, privada } = aparelho();
    const selado = selar('conteúdo íntegro', publica);
    const partes = selado.split('.');
    const cifra = Buffer.from(partes[3]!, 'base64');
    cifra[0] = cifra[0]! ^ 1;
    partes[3] = cifra.toString('base64');
    assert.throws(() => abrir(partes.join('.'), privada), CofreInvalido);
  });

  it('o selo não contém o texto em claro', () => {
    // Guarda contra alguém "otimizar" o formato guardando um prefixo legível.
    const { publica } = aparelho();
    const selado = selar('palavra-muito-especifica-do-usuario', publica);
    assert.equal(selado.includes('palavra-muito-especifica'), false);
  });

  it('recusa formato desconhecido em vez de devolver lixo', () => {
    const { privada } = aparelho();
    for (const ruim of ['', 'v1.a.b', 'v2.a.b.c', 'texto puro']) {
      assert.throws(() => abrir(ruim, privada), CofreInvalido);
    }
  });
});

describe('chavePublicaValida', () => {
  it('aceita uma X25519 de verdade', () => {
    assert.equal(chavePublicaValida(aparelho().publica), true);
  });

  it('recusa o que não tem 32 bytes', () => {
    // O webhook descarta o evento quando a chave não presta. Aceitar uma chave
    // curta aqui seria gravar algo que ninguém nunca vai abrir.
    for (const ruim of ['', 'curta', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64')]) {
      assert.equal(chavePublicaValida(ruim), false, ruim.slice(0, 12));
    }
  });
});

describe('selar recusa destino inválido', () => {
  it('não cifra para uma chave de tamanho errado', () => {
    // Sem isto, `nacl.box` lançaria um erro genérico lá dentro do webhook, onde
    // toda exceção vira evento descartado em silêncio.
    assert.throws(() => selar('oi', Buffer.alloc(10).toString('base64')), CofreInvalido);
  });
});

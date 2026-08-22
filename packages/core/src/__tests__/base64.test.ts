/**
 * Base64 conferido contra o `Buffer` do Node.
 *
 * Este teste não protege uma funcionalidade, protege um diagnóstico. O base64
 * daqui codifica a chave pública que o aparelho manda ao servidor e decodifica o
 * que volta selado. Um byte errado no preenchimento não dá erro: dá "a mensagem
 * não abre", num celular, sem pista da causa.
 */

import { describe, expect, it } from 'vitest';
import { deBase64, paraBase64 } from '../base64.js';

const doNode = (b: Uint8Array) => Buffer.from(b).toString('base64');

describe('paraBase64', () => {
  it('bate com o Buffer do Node em todos os restos de 3', () => {
    // 0, 1 e 2 bytes sobrando são os três caminhos do preenchimento com '='.
    for (let tamanho = 0; tamanho <= 24; tamanho++) {
      const bytes = Uint8Array.from({ length: tamanho }, (_, i) => (i * 37 + 11) % 256);
      expect(paraBase64(bytes), `tamanho ${tamanho}`).toBe(doNode(bytes));
    }
  });

  it('cobre o alfabeto inteiro, inclusive os bytes altos', () => {
    const todos = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(paraBase64(todos)).toBe(doNode(todos));
  });

  it('lida com uma chave X25519, que é o caso real', () => {
    const chave = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
    expect(paraBase64(chave)).toBe(doNode(chave));
    expect(paraBase64(chave)).toHaveLength(44);
  });
});

describe('deBase64', () => {
  it('desfaz o que paraBase64 fez, em qualquer tamanho', () => {
    for (let tamanho = 0; tamanho <= 24; tamanho++) {
      const bytes = Uint8Array.from({ length: tamanho }, (_, i) => (i * 53 + 7) % 256);
      expect([...deBase64(paraBase64(bytes))], `tamanho ${tamanho}`).toEqual([...bytes]);
    }
  });

  it('lê o que o Node escreveu', () => {
    const bytes = Uint8Array.from({ length: 100 }, (_, i) => (i * 13) % 256);
    expect([...deBase64(doNode(bytes))]).toEqual([...bytes]);
  });

  it('ignora quebra de linha e espaço, que aparecem em base64 copiado à mão', () => {
    const bytes = Uint8Array.from({ length: 48 }, (_, i) => i);
    const sujo = paraBase64(bytes).replace(/(.{8})/g, '$1\n ');
    expect([...deBase64(sujo)]).toEqual([...bytes]);
  });

  it('não inventa bytes a partir de string vazia', () => {
    expect(deBase64('')).toHaveLength(0);
  });
});

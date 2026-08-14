/**
 * base64 -> bytes.
 *
 * Vive separado de arquivo.ts porque nao depende de plataforma: assim da para
 * testar em Node o pedaco que so roda no aparelho.
 *
 * Usa o atob nativo quando existe. O decodificador manual e o plano B para
 * runtimes de Hermes sem esse global: e mais lento, mas um import que falha por
 * causa de uma funcao ausente e um bug que so aparece no aparelho de alguem.
 */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Mapa char -> valor. 0xff marca "fora do alfabeto" (quebra de linha, '=', lixo). */
const INDICE = (() => {
  const tabela = new Uint8Array(128).fill(0xff);
  for (let i = 0; i < ALFABETO.length; i++) tabela[ALFABETO.charCodeAt(i)] = i;
  return tabela;
})();

export function bytesDeBase64(b64: string): Uint8Array {
  const nativo = globalThis.atob;

  if (typeof nativo === 'function') {
    const binario = nativo(b64);
    const saida = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) saida[i] = binario.charCodeAt(i);
    return saida;
  }

  return decodificarManualmente(b64);
}

export function decodificarManualmente(b64: string): Uint8Array {
  const saida = new Uint8Array((b64.length * 3) >> 2);
  let acumulador = 0;
  let bits = 0;
  let pos = 0;

  for (let i = 0; i < b64.length; i++) {
    const codigo = b64.charCodeAt(i);
    if (codigo > 127) continue;

    const valor = INDICE[codigo];
    if (valor === 0xff) continue;

    acumulador = (acumulador << 6) | valor;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      saida[pos++] = (acumulador >> bits) & 0xff;
    }
  }

  return pos === saida.length ? saida : saida.subarray(0, pos);
}

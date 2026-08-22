/**
 * Base64 sem depender da plataforma.
 *
 * Existe porque o mesmo par de bytes precisa atravessar três motores diferentes
 * e voltar idêntico: o Node do servidor (que tem `Buffer`), o Hermes do
 * aparelho (que não tem `Buffer` nem garante `btoa`/`atob`) e o navegador do
 * `expo start --web`.
 *
 * Mora no `core` e não no app por um motivo prático: aqui roda em teste. Um erro
 * de um byte no preenchimento só apareceria como "a mensagem não abre" num
 * celular, que é o pior lugar do mundo para depurar codificação.
 *
 * Este arquivo é puro, como todo o resto do pacote.
 */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function paraBase64(bytes: Uint8Array): string {
  let saida = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    saida += ALFABETO[a >> 2];
    saida += ALFABETO[((a & 3) << 4) | ((b ?? 0) >> 4)];
    saida += b === undefined ? '=' : ALFABETO[((b & 15) << 2) | ((c ?? 0) >> 6)];
    saida += c === undefined ? '=' : ALFABETO[c & 63];
  }
  return saida;
}

export function deBase64(texto: string): Uint8Array {
  const limpo = texto.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((limpo.length * 3) / 4));
  let posicao = 0;
  for (let i = 0; i < limpo.length; i += 4) {
    const n =
      (ALFABETO.indexOf(limpo[i]!) << 18) |
      (ALFABETO.indexOf(limpo[i + 1]!) << 12) |
      ((limpo[i + 2] ? ALFABETO.indexOf(limpo[i + 2]!) : 0) << 6) |
      (limpo[i + 3] ? ALFABETO.indexOf(limpo[i + 3]!) : 0);
    bytes[posicao++] = (n >> 16) & 255;
    if (limpo[i + 2]) bytes[posicao++] = (n >> 8) & 255;
    if (limpo[i + 3]) bytes[posicao++] = n & 255;
  }
  return bytes.subarray(0, posicao);
}

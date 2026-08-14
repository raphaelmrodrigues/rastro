/**
 * Utilitários de texto compartilhados entre os dois formatos de export.
 *
 * Os rótulos vivem aqui, e não dentro do parser de HTML, porque o export em JSON
 * usa exatamente os mesmos rótulos localizados ("Nome de usuário") na forma
 * label_values. Um lugar só: quando o Instagram acrescentar um idioma, muda aqui.
 */

/**
 * Rótulos de tabela que identificam a coluna do @ e a do nome de exibição.
 * Comparados em minúsculas e sem acento, porque a acentuação já variou entre
 * versões do export.
 */
export const USERNAME_LABELS = new Set(['nome de usuario', 'username', 'nombre de usuario']);
export const DISPLAY_NAME_LABELS = new Set(['nome', 'name', 'nombre']);
export const URL_LABELS = new Set(['url', 'link']);

/** Byte inicial de UTF-8 (C2-F4) seguido de byte de continuação (80-BF). */
const SEQUENCIA_MOJIBAKE = /[Â-ô][-¿]/;

/** Marcas de acentuação, para comparar rótulo sem depender de acento. */
const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Conserta texto UTF-8 que foi lido como Latin-1 ("Nome de usuÃ¡rio").
 *
 * Não é paranoia: o export em JSON de agosto/2026 traz TODOS os rótulos e nomes
 * de exibição dessa forma — o próprio Instagram gera o arquivo assim. Sem isto,
 * o rótulo do @ nunca casa e listas inteiras somem sem aviso.
 *
 * A regra é conservadora. Só mexe quando o texto tem uma sequência que só
 * aparece em mojibake e quando a releitura produz UTF-8 válido. Qualquer dúvida,
 * devolve o original — estragar um nome legítimo é pior que deixar um nome feio.
 */
export function repairMojibake(text: string): string {
  if (!SEQUENCIA_MOJIBAKE.test(text)) return text;

  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Um caractere acima de 255 prova que a string não é Latin-1 mal lido.
    if (code > 0xff) return text;
    bytes.push(code);
  }

  return decodeUtf8(bytes) ?? text;
}

/**
 * UTF-8 -> string, ou null se a sequência for inválida.
 *
 * Escrito à mão porque o core é puro: TextDecoder existe no navegador e no Node,
 * mas não é garantido no Hermes, e o pacote roda nos três.
 */
function decodeUtf8(bytes: number[]): string | null {
  let saida = '';

  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];

    if (b0 < 0x80) {
      saida += String.fromCharCode(b0);
      i += 1;
      continue;
    }

    const extras = b0 >= 0xf0 ? 3 : b0 >= 0xe0 ? 2 : b0 >= 0xc2 ? 1 : -1;
    if (extras < 0 || i + extras >= bytes.length) return null;

    let ponto = b0 & (extras === 1 ? 0x1f : extras === 2 ? 0x0f : 0x07);
    for (let j = 1; j <= extras; j++) {
      const seguinte = bytes[i + j];
      if ((seguinte & 0xc0) !== 0x80) return null;
      ponto = (ponto << 6) | (seguinte & 0x3f);
    }

    // Rejeita sobrecodificação e substitutos soltos: nesses casos o texto
    // provavelmente não era mojibake, e devolver o original é o certo.
    if (ponto > 0x10ffff) return null;
    if (ponto >= 0xd800 && ponto <= 0xdfff) return null;
    if (extras === 2 && ponto < 0x800) return null;
    if (extras === 3 && ponto < 0x10000) return null;

    saida += String.fromCodePoint(ponto);
    i += extras + 1;
  }

  return saida;
}

/** Rótulo comparável: sem acento, sem espaço nas pontas, sem ":" final. */
export function normalizeLabel(text: string): string {
  return repairMojibake(text)
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .trim()
    .toLowerCase()
    .replace(/:$/, '');
}

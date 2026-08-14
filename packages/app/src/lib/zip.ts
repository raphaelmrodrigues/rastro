/**
 * Leitura do .zip do export em fluxo, sem carregar o arquivo inteiro.
 *
 * Por que não JSZip: ele exige o arquivo todo em memória antes de listar o que
 * há dentro. O export completo ("todas as informações", todos os anos) do dono
 * deste projeto tem 479 MB — o suficiente para derrubar a aba do navegador e o
 * app no celular antes de o parser ver um byte. E é quase tudo foto e vídeo:
 * dos milhares de arquivos, dez interessam, somando menos de 700 KB.
 *
 * Aqui o zip é empurrado em blocos para um descompactador de fluxo. Só os
 * arquivos que passam no filtro têm os bytes descomprimidos; o resto é
 * atravessado e descartado. O pico de memória é o bloco atual, não o arquivo.
 */

import { Unzip, UnzipInflate } from 'fflate';

/**
 * De onde os bytes vêm. Existe para o mesmo código servir ao navegador (File)
 * e ao aparelho (expo-file-system), que não têm API de leitura em comum.
 */
export interface FonteArquivo {
  nome: string;
  tamanho: number;
  /** Lê o intervalo [inicio, fim) do arquivo. */
  ler(inicio: number, fim: number): Promise<Uint8Array>;
}

export class ArquivoNaoEhZip extends Error {
  constructor() {
    super(
      'Esse arquivo não parece ser o .zip que o Instagram envia. ' +
        'Envie o arquivo como veio, sem descompactar e sem renomear.',
    );
    this.name = 'ArquivoNaoEhZip';
  }
}

/**
 * Múltiplo de 3 de propósito: no aparelho os bytes chegam via base64, e um bloco
 * que não fecha em grupo de 3 sai com padding no meio — a emenda com o bloco
 * seguinte quebraria o zip.
 */
const TAMANHO_BLOCO = 3 * 1024 * 1024;

/** Assinatura de um zip local ("PK\3\4"); vazio e zip só de comentário também valem. */
const ASSINATURAS = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

/**
 * Extrai do zip apenas os arquivos que interessam, como texto.
 *
 * `aoProgredir` recebe a fração lida (0..1) — o export grande leva dezenas de
 * segundos e uma tela parada nesse tempo parece travada.
 */
export async function extrairDoZip(
  fonte: FonteArquivo,
  interessa: (nome: string) => boolean,
  aoProgredir?: (fracao: number) => void,
): Promise<Record<string, string>> {
  const cabecalho = await fonte.ler(0, Math.min(4, fonte.tamanho));
  if (!pareceZip(cabecalho)) throw new ArquivoNaoEhZip();

  const saida: Record<string, string> = {};
  const pendentes: Array<Promise<void>> = [];

  const descompactador = new Unzip((arquivo) => {
    if (!interessa(arquivo.name)) return; // não chamar start() = bytes descartados

    const partes: Uint8Array[] = [];
    pendentes.push(
      new Promise<void>((resolve, reject) => {
        arquivo.ondata = (erro, pedaco, ultimo) => {
          if (erro) {
            reject(erro);
            return;
          }
          if (pedaco.length > 0) partes.push(pedaco);
          if (ultimo) {
            saida[arquivo.name] = textoUtf8(partes);
            resolve();
          }
        };
      }),
    );
    arquivo.start();
  });

  descompactador.register(UnzipInflate);

  let pos = 0;
  while (pos < fonte.tamanho) {
    const fim = Math.min(pos + TAMANHO_BLOCO, fonte.tamanho);
    const bloco = await fonte.ler(pos, fim);

    // Avançar pelo que a fonte realmente entregou, não pelo que foi pedido: uma
    // leitura curta com o cursor andando o bloco inteiro pularia bytes e
    // corromperia o fluxo — falha que só apareceria no meio do arquivo.
    if (bloco.length === 0) throw new ArquivoNaoEhZip();
    pos += bloco.length;

    try {
      descompactador.push(bloco, pos >= fonte.tamanho);
    } catch {
      // fflate lança em zip corrompido ou em formato que não conhece.
      throw new ArquivoNaoEhZip();
    }

    aoProgredir?.(pos / fonte.tamanho);
  }

  await Promise.all(pendentes);
  return saida;
}

function pareceZip(bytes: Uint8Array): boolean {
  return ASSINATURAS.some((assinatura) => assinatura.every((b, i) => bytes[i] === b));
}

/**
 * bytes -> string UTF-8.
 *
 * TextDecoder existe no navegador e no Node, mas não é garantido no Hermes;
 * o caminho manual evita que o import morra no aparelho por um global ausente.
 */
function textoUtf8(partes: Uint8Array[]): string {
  const total = partes.reduce((soma, p) => soma + p.length, 0);
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const parte of partes) {
    bytes.set(parte, pos);
    pos += parte.length;
  }

  const Decoder = globalThis.TextDecoder;
  if (typeof Decoder === 'function') return new Decoder('utf-8').decode(bytes);

  let saida = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];

    if (b0 < 0x80) {
      saida += String.fromCharCode(b0);
      i += 1;
      continue;
    }

    const extras = b0 >= 0xf0 ? 3 : b0 >= 0xe0 ? 2 : b0 >= 0xc2 ? 1 : 0;
    if (extras === 0 || i + extras >= bytes.length) {
      saida += '�';
      i += 1;
      continue;
    }

    let ponto = b0 & (extras === 1 ? 0x1f : extras === 2 ? 0x0f : 0x07);
    for (let j = 1; j <= extras; j++) ponto = (ponto << 6) | (bytes[i + j] & 0x3f);

    saida += String.fromCodePoint(ponto);
    i += extras + 1;
  }
  return saida;
}

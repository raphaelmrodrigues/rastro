/**
 * Escolha do arquivo do export pelo usuário.
 *
 * Devolve uma FonteArquivo (leitura por intervalo) em vez do conteúdo: quem lê é
 * o descompactador de fluxo, em blocos. Ver zip.ts para o porquê.
 *
 * No aparelho o seletor do expo-document-picker resolve. No navegador, não:
 * a implementação web dele chama FileReader.readAsDataURL, que transforma o
 * arquivo inteiro numa string base64. Num export de 479 MB isso pede ~639 MB de
 * string, acima do teto do V8 — o FileReader falha e o app só sabe dizer
 * "confira se é o .zip", culpando um arquivo que estava perfeito. Por isso o
 * caminho web usa um <input type="file"> próprio e fica com o objeto File, que
 * o navegador lê por fatia, sem cópia.
 */

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { bytesDeBase64 } from './base64';
import type { FonteArquivo } from './zip';

/** Múltiplo de 3: em base64 cada 3 bytes viram 4 chars sem padding no meio. */
const ALINHAMENTO_BASE64 = 3;

/** Devolve null quando o usuário desiste da escolha. */
export async function escolherArquivoDoExport(): Promise<FonteArquivo | null> {
  return Platform.OS === 'web' ? escolherNoNavegador() : escolherNoAparelho();
}

async function escolherNoNavegador(): Promise<FonteArquivo | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip';
  input.style.display = 'none';
  document.body.appendChild(input);

  try {
    const arquivo = await new Promise<File | null>((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });

    if (!arquivo) return null;

    return {
      nome: arquivo.name,
      tamanho: arquivo.size,
      async ler(inicio, fim) {
        // slice não copia: o navegador lê do disco só o pedaço pedido.
        return new Uint8Array(await arquivo.slice(inicio, fim).arrayBuffer());
      },
    };
  } finally {
    input.remove();
  }
}

async function escolherNoAparelho(): Promise<FonteArquivo | null> {
  const resultado = await DocumentPicker.getDocumentAsync({
    // O Instagram entrega .zip; alguns aparelhos reportam o mime genérico.
    type: ['application/zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
  });

  const escolhido = resultado.canceled ? undefined : resultado.assets?.[0];
  if (!escolhido) return null;

  const info = await FileSystem.getInfoAsync(escolhido.uri, { size: true });
  const tamanho =
    escolhido.size ?? (info.exists && typeof info.size === 'number' ? info.size : 0);

  return {
    nome: escolhido.name ?? 'export.zip',
    tamanho,
    async ler(inicio, fim) {
      // O expo-file-system só entrega bytes via base64, e só devolve o intervalo
      // pedido se position e length forem informados. Alinhar em múltiplo de 3
      // evita padding no meio da leitura, que corromperia a emenda dos blocos.
      const alinhado = fim - inicio;
      const sobra = alinhado % ALINHAMENTO_BASE64;
      const comprimento = sobra === 0 || fim >= tamanho ? alinhado : alinhado - sobra;

      const base64 = await FileSystem.readAsStringAsync(escolhido.uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: inicio,
        length: comprimento,
      });

      return bytesDeBase64(base64);
    },
  };
}

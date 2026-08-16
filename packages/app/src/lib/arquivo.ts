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
 *
 * ## A leitura no aparelho, depois do SDK 57
 *
 * A API antiga do expo-file-system só entregava bytes como base64, e só devolvia
 * o intervalo pedido se `position` e `length` fossem informados — o que obrigava
 * a alinhar cada bloco em múltiplo de 3 para o padding não cair no meio da
 * leitura e corromper a emenda. A API nova abre um `FileHandle` e lê bytes
 * brutos numa posição arbitrária. Some a conversão, some o alinhamento, e some
 * a classe de bug que vinha com eles.
 */

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import type { FonteArquivo } from './zip';

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
    const arquivo = await new Promise<globalThis.File | null>((resolve) => {
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
    /*
     * A cópia é necessária, e não é escolha nossa: no Android o seletor devolve
     * um `content://` que a API de arquivos não consegue abrir por intervalo, e
     * ler por intervalo é o que evita carregar o zip inteiro na memória. Sem a
     * cópia, o import de um export grande não funciona.
     *
     * O preço é um segundo arquivo do mesmo tamanho no cache do app — 479 MB no
     * export real de teste. Por isso `fechar()` apaga a cópia. Ver abaixo.
     */
    copyToCacheDirectory: true,
  });

  const escolhido = resultado.canceled ? undefined : resultado.assets?.[0];
  if (!escolhido) return null;

  const arquivo = new File(escolhido.uri);
  const tamanho = escolhido.size ?? arquivo.size;

  // Um handle só para o import inteiro: reabrir a cada bloco custaria uma syscall
  // por 3 MB, e num export de 479 MB isso são ~160 aberturas desnecessárias.
  const handle = arquivo.open();

  return {
    nome: escolhido.name ?? 'export.zip',
    tamanho,
    async ler(inicio, fim) {
      handle.offset = inicio;
      return handle.readBytes(fim - inicio);
    },
    fechar() {
      handle.close();
      descartarCopiaDoCache(arquivo);
    },
  };
}

/**
 * Apaga a cópia que o seletor fez no cache do app.
 *
 * Sem isto, cada import deixa um zip inteiro parado no aparelho: no export de
 * teste, 479 MB por importação, somados aos 479 MB que o usuário já tem na pasta
 * de downloads. O sistema até limpa cache sozinho, mas só sob pressão de espaço
 * e sem hora marcada — na prática a pessoa perde quase 1 GB e não sabe por quê.
 *
 * `fechar()` roda no `finally` do import (ver zip.ts), então isto vale também
 * quando a leitura falha no meio — que é justamente quando um arquivo grande
 * ficaria esquecido.
 */
function descartarCopiaDoCache(arquivo: File): void {
  try {
    /*
     * Só apaga dentro do cache. Em alguns aparelhos o seletor devolve o caminho
     * real do arquivo escolhido em vez de uma cópia, e aí apagar destruiria o
     * download do próprio usuário — que ele levou até 48h para conseguir.
     */
    if (!arquivo.uri.startsWith(Paths.cache.uri)) return;
    if (arquivo.exists) arquivo.delete();
  } catch {
    // Falhar aqui não pode derrubar um import que deu certo. O pior caso é o
    // arquivo sobrar, que é exatamente o comportamento anterior.
  }
}

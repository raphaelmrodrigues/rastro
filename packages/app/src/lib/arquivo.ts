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
 *
 * ## Por que não copiamos mais o arquivo (19/08/2026)
 *
 * Até aqui pedíamos `copyToCacheDirectory: true`, na suposição de que um
 * `content://` do seletor do Android não podia ser aberto por intervalo. Isso
 * deixou de ser verdade: no SDK 57 o `File.open()` aceita URI do SAF e assume
 * `FileMode.ReadOnly` sozinho.
 *
 * A suposição custava caro. A cópia duplicava o arquivo inteiro — 479 MB no
 * export real — antes de o app ler um byte, e durante essa cópia o seletor
 * simplesmente não retornava: da tela, o toque no botão não produzia nada, por
 * minutos, sem barra de progresso, sem mensagem. Em aparelho sem espaço
 * sobrando a cópia falhava, e a falha chegava como rejeição de promessa que
 * ninguém pegava, ou seja, silêncio absoluto.
 *
 * Agora o `content://` é aberto direto. A cópia continua existindo como
 * **fallback**, para o aparelho em que a abertura direta falhar, e só nesse
 * caso o arquivo copiado é apagado no fim.
 *
 * ## Abrir não é o mesmo que poder reposicionar (20/08/2026)
 *
 * A primeira versão desse fallback testava só `open()`, e passou. O import
 * morria depois, na primeira leitura, com:
 *
 *     java.io.IOException: Bad file descriptor
 *       at sun.nio.ch.FileChannelImpl.position0
 *       at expo.modules.filesystem.FileSystemFileHandle.setOffset
 *
 * O motivo: nem todo `content://` vira um descritor de arquivo. Vários
 * provedores do Android (nuvem, Downloads de alguns aparelhos, MTP) entregam um
 * **cano** — bytes em ordem, do começo ao fim, sem `lseek`. Abrir funciona, ler
 * do começo funciona, e `handle.offset = n` estoura.
 *
 * Isso é fatal aqui e não em outro app qualquer porque o zip se lê **de trás
 * para frente**: o diretório central fica no fim do arquivo, então o primeiro
 * salto que o descompactador pede é justamente o que o cano não faz.
 *
 * Por isso a sondagem agora reposiciona e lê nas duas pontas antes de decidir.
 * Quem não passa vai para a cópia, que é leitura sequencial e o cano aceita.
 */

import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode, Paths } from 'expo-file-system';
import type { FonteArquivo } from './zip';

/**
 * O arquivo foi escolhido, mas o app não conseguiu abri-lo para leitura.
 *
 * Separado de `ArquivoNaoEhZip` porque a causa e a saída são outras: aqui o
 * problema é acesso ou espaço, não o conteúdo. A mensagem carrega o motivo do
 * sistema porque, sem ele, esta falha é invisível — foi assim que ela passou
 * despercebida até o primeiro teste em aparelho de verdade.
 */
export class ArquivoIlegivel extends Error {
  constructor(motivo: string) {
    super(
      'O app não conseguiu abrir esse arquivo. Se ele estiver no Google Drive ou em outra ' +
        'nuvem, baixe para o celular antes de enviar. ' +
        `(detalhe técnico: ${motivo})`,
    );
    this.name = 'ArquivoIlegivel';
  }
}

/**
 * Devolve null quando o usuário desiste da escolha.
 *
 * `aoPreparar` avisa que o app teve de copiar o arquivo antes de conseguir lê-lo
 * — o caminho lento, de minutos num export completo. Sem esse aviso a tela fica
 * dizendo "abrindo seus arquivos" enquanto copia meio gigabyte, que é a mesma
 * aparência de travado que este arquivo inteiro existe para evitar.
 */
export async function escolherArquivoDoExport(
  aoPreparar?: () => void,
): Promise<FonteArquivo | null> {
  return Platform.OS === 'web' ? escolherNoNavegador() : escolherNoAparelho(aoPreparar);
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

async function escolherNoAparelho(aoPreparar?: () => void): Promise<FonteArquivo | null> {
  const resultado = await DocumentPicker.getDocumentAsync({
    // O Instagram entrega .zip; alguns aparelhos reportam o mime genérico.
    type: ['application/zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: false,
  });

  const escolhido = resultado.canceled ? undefined : resultado.assets?.[0];
  if (!escolhido) return null;

  const original = new File(escolhido.uri);

  /*
   * O tamanho é obrigatório: o descompactador lê por intervalo e, sem saber
   * onde o arquivo termina, o import roda em falso e falha no fim com uma
   * mensagem que não ajuda ninguém. Em `content://` o seletor às vezes não
   * informa o tamanho, daí a segunda tentativa pelo próprio arquivo — e, se nem
   * assim vier, a cópia abaixo resolve, porque de um arquivo no cache o tamanho
   * sempre se sabe.
   */
  let arquivo = original;
  let tamanho = escolhido.size ?? original.size;
  let ehCopia = false;

  if (!(tamanho > 0) || !aceitaLeituraPorIntervalo(original, tamanho)) {
    aoPreparar?.();
    arquivo = await copiarParaOCache(original);
    ehCopia = true;
    tamanho = arquivo.size;

    if (!(tamanho > 0) || !aceitaLeituraPorIntervalo(arquivo, tamanho)) {
      descartarCopiaDoCache(arquivo);
      throw new ArquivoIlegivel('nem depois de copiado o arquivo aceitou ser lido');
    }
  }

  /*
   * Um handle só para o import inteiro: reabrir a cada bloco custaria uma
   * syscall por 3 MB, e num export de 479 MB isso são ~160 aberturas
   * desnecessárias.
   */
  let handle;
  try {
    handle = arquivo.open(FileMode.ReadOnly);
  } catch (erro) {
    if (ehCopia) descartarCopiaDoCache(arquivo);
    throw new ArquivoIlegivel(mensagemDe(erro));
  }

  return {
    nome: escolhido.name ?? 'export.zip',
    tamanho,
    async ler(inicio, fim) {
      try {
        handle.offset = inicio;
        return handle.readBytes(fim - inicio);
      } catch (erro) {
        /*
         * A sondagem já provou que este arquivo reposiciona nas duas pontas, e
         * mesmo assim: se falhar no meio, que falhe com nome e motivo. O erro
         * cru daqui é um rastro de pilha do Java, e chegar ao usuário como
         * "não deu para ler" apagaria a única pista que o painel receberia.
         */
        throw new ArquivoIlegivel(mensagemDe(erro));
      }
    },
    fechar() {
      handle.close();
      // Só apaga o que foi este código que criou. O arquivo do usuário nunca.
      if (ehCopia) descartarCopiaDoCache(arquivo);
    },
  };
}

/**
 * O arquivo aceita ser lido por intervalo, e não só do começo ao fim?
 *
 * Duas leituras de um byte, e a segunda é a que importa: o descompactador
 * começa pelo fim do zip, onde mora o diretório central. Um descritor que só
 * entrega bytes em ordem passa na primeira e estoura na segunda — foi assim que
 * o `Bad file descriptor` chegou ao aparelho do dono. Ver o topo do arquivo.
 *
 * O custo é um descritor aberto por alguns microssegundos, contra os 479 MB de
 * cópia que a resposta errada aqui obrigaria a pagar.
 */
function aceitaLeituraPorIntervalo(arquivo: File, tamanho: number): boolean {
  let handle;
  try {
    handle = arquivo.open(FileMode.ReadOnly);
  } catch {
    return false;
  }

  try {
    handle.offset = 0;
    handle.readBytes(1);
    if (tamanho > 1) {
      handle.offset = tamanho - 1;
      handle.readBytes(1);
    }
    return true;
  } catch {
    return false;
  } finally {
    handle.close();
  }
}

/**
 * Traz o arquivo para dentro do app, quando ler no lugar dele não dá.
 *
 * Assíncrona de propósito: `copySync` segura a thread de JavaScript do início ao
 * fim, e meio gigabyte parado significa nem o rótulo do botão repintar. O
 * usuário veria de novo a tela sem reação que o teste em aparelho já pegou uma
 * vez.
 */
async function copiarParaOCache(original: File): Promise<File> {
  const destino = new File(Paths.cache, `import-${Date.now()}.zip`);
  try {
    await original.copy(destino);
  } catch (erro) {
    throw new ArquivoIlegivel(mensagemDe(erro));
  }
  return destino;
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Apaga a cópia de emergência feita por `abrirOuCopiar`.
 *
 * A verificação de caminho continua aqui como cinto e suspensório: um dia
 * alguém pode passar por engano o arquivo do próprio usuário, e apagá-lo
 * destruiria um download que levou até 48h para chegar.
 */
function descartarCopiaDoCache(arquivo: File): void {
  try {
    if (!arquivo.uri.startsWith(Paths.cache.uri)) return;
    if (arquivo.exists) arquivo.delete();
  } catch {
    // Falhar aqui não pode derrubar um import que deu certo. O pior caso é o
    // arquivo sobrar, que é exatamente o comportamento anterior.
  }
}

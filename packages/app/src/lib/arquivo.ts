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
 * ## O descritor que morre sozinho (20/08/2026)
 *
 * Em dois aparelhos e duas versões seguidas, o import morreu na **primeira**
 * leitura, sempre igual:
 *
 *     java.io.IOException: Bad file descriptor
 *       at sun.nio.ch.FileChannelImpl.position0
 *       at expo.modules.filesystem.FileSystemFileHandle.setOffset
 *
 * O detalhe que decide o diagnóstico é qual erro é: `Bad file descriptor` é
 * `EBADF` — descritor inválido ou já fechado. Um descritor que existe mas não
 * aceita reposicionar dá `ESPIPE`/`Illegal seek`, que é outra frase. Ou seja:
 * o problema não é o `content://` recusar `lseek`; é o descritor **já não estar
 * mais lá** na hora em que o app foi usá-lo.
 *
 * Isso muda o que dá para fazer. Não existe teste prévio confiável: uma sondagem
 * que abre, salta, lê e fecha passa — e foi o que a versão 0.2.1 fez, aprovando
 * um arquivo que morreu na leitura seguinte. Pior: a sondagem fecha um descritor
 * para o mesmo `content://` momentos antes da abertura definitiva, e é suspeita
 * de ser ela própria parte da causa. Ela saiu.
 *
 * O que sobrou é o que não depende de adivinhar: tenta ler no lugar; se a
 * leitura falhar, **copia e refaz a mesma leitura na cópia**, sem perguntar
 * nada a ninguém. A recuperação vale uma vez, em qualquer ponto do import, e
 * termina sempre num `file://` dentro do cache do app — o único caso em que dá
 * para garantir leitura por intervalo do começo ao fim.
 *
 * Custo do caminho rápido quando ele não serve: uma leitura de 4 bytes que
 * falha. A primeira coisa que o descompactador pede é a assinatura do zip, no
 * byte 0, então o desvio para a cópia acontece antes de qualquer trabalho.
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

  // Cópia de um import anterior que morreu no meio ficaria no cache para sempre,
  // e ela tem o tamanho do export. Varrer aqui é o momento certo: o import que
  // vem agora é o único que poderia precisar do espaço.
  descartarCopiasVelhas();

  const original = new File(escolhido.uri);

  /*
   * O tamanho é obrigatório: o descompactador lê por intervalo e, sem saber
   * onde o arquivo termina, o import roda em falso e falha no fim com uma
   * mensagem que não ajuda ninguém. Em `content://` o seletor às vezes não
   * informa o tamanho, daí a segunda tentativa pelo próprio arquivo — e, se nem
   * assim vier, a cópia resolve, porque de um arquivo no cache o tamanho sempre
   * se sabe.
   */
  let arquivo = original;
  let tamanho = escolhido.size ?? original.size;
  let ehCopia = false;

  if (!(tamanho > 0)) {
    aoPreparar?.();
    arquivo = await copiarParaOCache(original);
    ehCopia = true;
    tamanho = arquivo.size;
    if (!(tamanho > 0)) {
      descartarCopiaDoCache(arquivo);
      throw new ArquivoIlegivel('o sistema não informou o tamanho do arquivo');
    }
  }

  /*
   * Um handle só para o import inteiro: reabrir a cada bloco custaria uma
   * syscall por 3 MB, e num export de 479 MB isso são ~160 aberturas
   * desnecessárias.
   */
  let handle = abrir(arquivo);

  /** Lê de verdade. Separado porque a recuperação abaixo chama isto duas vezes. */
  const lerDoHandle = (inicio: number, fim: number): Uint8Array => {
    handle.offset = inicio;
    return handle.readBytes(fim - inicio);
  };

  /**
   * Troca o arquivo do usuário por uma cópia nossa, no meio do caminho.
   *
   * Depois disto tudo é `file://` dentro do cache do app, que é a única coisa
   * que se pode garantir que lê por intervalo até o fim.
   */
  const passarParaACopia = async (): Promise<void> => {
    aoPreparar?.();
    try {
      handle.close();
    } catch {
      // O descritor já estava ruim; é por isso que estamos aqui.
    }
    arquivo = await copiarParaOCache(original);
    ehCopia = true;
    handle = abrir(arquivo);
  };

  return {
    nome: escolhido.name ?? 'export.zip',
    tamanho,
    async ler(inicio, fim) {
      try {
        return lerDoHandle(inicio, fim);
      } catch (erro) {
        // Já estamos na cópia: não há para onde recuar, e o erro é real.
        // O prefixo diz ao painel em qual dos dois caminhos a leitura morreu —
        // sem ele os dois relatos chegam com o mesmo texto do Java.
        if (ehCopia) throw new ArquivoIlegivel(`na cópia: ${mensagemDe(erro)}`);

        /*
         * Primeira falha lendo o arquivo no lugar dele. Em vez de desistir,
         * copia e refaz **esta mesma leitura** — `ler` recebe o intervalo em
         * cada chamada, então repetir do zero na cópia dá o mesmo resultado, e
         * quem chamou nem fica sabendo.
         */
        await passarParaACopia();
        try {
          return lerDoHandle(inicio, fim);
        } catch (erroDaCopia) {
          descartarCopiaDoCache(arquivo);
          throw new ArquivoIlegivel(`na cópia recém-feita: ${mensagemDe(erroDaCopia)}`);
        }
      }
    },
    fechar() {
      try {
        handle.close();
      } catch {
        // Fechar um descritor que já morreu não é motivo para derrubar nada.
      }
      // Só apaga o que foi este código que criou. O arquivo do usuário nunca.
      if (ehCopia) descartarCopiaDoCache(arquivo);
    },
  };
}

/** Abre para leitura, traduzindo a falha do sistema em erro nosso. */
function abrir(arquivo: File) {
  try {
    return arquivo.open(FileMode.ReadOnly);
  } catch (erro) {
    throw new ArquivoIlegivel(mensagemDe(erro));
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
  const destino = new File(Paths.cache, `${PREFIXO_DA_COPIA}${Date.now()}.zip`);
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

/** Prefixo das cópias que este arquivo cria. Serve para reconhecê-las depois. */
const PREFIXO_DA_COPIA = 'import-';

/**
 * Apaga cópias que sobraram de imports anteriores.
 *
 * Uma cópia só é apagada em `fechar()`, e `fechar()` não roda se o app for
 * fechado no meio do import. Cada sobra tem o tamanho do export — deixar isso
 * acumular no cache é encher o aparelho do usuário sem ele saber por quê.
 */
function descartarCopiasVelhas(): void {
  try {
    for (const item of Paths.cache.list()) {
      if (item instanceof File && item.name.startsWith(PREFIXO_DA_COPIA)) item.delete();
    }
  } catch {
    // Limpeza é higiene, não requisito. Falhar aqui não pode impedir um import.
  }
}

/**
 * Apaga a cópia feita por `copiarParaOCache`.
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

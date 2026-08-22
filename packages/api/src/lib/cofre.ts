/**
 * Cofre ponta a ponta para o conteúdo que vem da API do Instagram.
 *
 * ## Por que isto existe, e por que não é `crypto.ts`
 *
 * `crypto.ts` cifra o token do Instagram em repouso com uma chave que vive no
 * servidor (`TOKEN_ENCRYPTION_KEY`). Isso protege contra dump do banco e é o
 * suficiente para um token — que o servidor precisa poder usar.
 *
 * Mensagem direta é outra coisa. Ela chega pelo webhook, e a partir de
 * 22/08/2026 o Rastro passa a guardá-la — foi decisão do dono, depois de eu
 * levantar o custo. O que torna a decisão defensável é que o servidor guarda sem
 * poder ler:
 *
 *   1. o aparelho gera um par de chaves e manda **só a pública**;
 *   2. o webhook chega, o servidor cifra com essa pública e grava;
 *   3. só o aparelho, com a privada que nunca saiu dele, decifra.
 *
 * Um dump do banco, um administrador curioso, uma intimação mal fundamentada ou
 * um comprometimento do servidor entregam bytes que ninguém consegue abrir. É a
 * diferença entre "prometemos não olhar" e "não temos como olhar".
 *
 * ## O que isto NÃO protege
 *
 * Ser honesto sobre a fronteira é parte do desenho:
 *
 * - **O momento da chegada.** Entre o webhook e a cifragem, o texto está na
 *   memória do processo. Um servidor comprometido *naquele instante* lê o que
 *   passa dali em diante. O que ele não consegue é ler o histórico.
 * - **Os metadados.** `thread_id`, quem mandou e quando ficam em claro, porque
 *   é por eles que a listagem ordena e pagina. Quem lê o banco sabe *que* houve
 *   conversa e *quando* — só não sabe o quê.
 * - **Trocar de aparelho.** A privada não sai do aparelho, então um celular novo
 *   não abre o que foi cifrado para o antigo. É o preço real da ponta a ponta, e
 *   a tela precisa dizer isso em vez de mostrar lista vazia.
 *
 * ## Formato
 *
 * NaCl box (X25519 + XSalsa20-Poly1305), no esquema de "sealed box": um par
 * efêmero por mensagem, do qual só a pública é guardada. O privado efêmero morre
 * na função — nem o servidor consegue decifrar o que ele mesmo acabou de cifrar.
 *
 * `v1.<pub efêmera>.<nonce>.<cifra>`, tudo em base64.
 *
 * tweetnacl e não `node:crypto`: o mesmo código roda no aparelho, e o React
 * Native não tem `node:crypto`. Ver `packages/app/src/lib/cofre.ts`.
 */

import nacl from 'tweetnacl';

const VERSAO = 'v1';

export class CofreInvalido extends Error {}

const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
const deB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

/** Uma chave pública utilizável? Rejeita antes de gravar lixo no banco. */
export function chavePublicaValida(publicKeyBase64: string): boolean {
  try {
    return deB64(publicKeyBase64).length === nacl.box.publicKeyLength;
  } catch {
    return false;
  }
}

/**
 * Cifra para o dono da chave pública.
 *
 * Depois desta função o processo não tem mais como voltar atrás: a chave privada
 * efêmera sai de escopo e é a única que abriria o resultado junto com a privada
 * do aparelho.
 */
export function selar(texto: string, publicKeyBase64: string): string {
  const destino = deB64(publicKeyBase64);
  if (destino.length !== nacl.box.publicKeyLength) {
    throw new CofreInvalido('Chave pública com tamanho inválido.');
  }

  const efemero = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cifra = nacl.box(Buffer.from(texto, 'utf8'), nonce, destino, efemero.secretKey);

  // Zera a privada efêmera. É higiene, não garantia — o GC decide o resto —,
  // mas encurta a janela em que ela existe na memória do processo.
  efemero.secretKey.fill(0);

  return [VERSAO, b64(efemero.publicKey), b64(nonce), b64(cifra)].join('.');
}

/**
 * Abre um selo. Existe para os testes e para o app; **o servidor em produção
 * nunca chama isto**, porque ele não tem a chave privada de ninguém.
 */
export function abrir(selado: string, secretKeyBase64: string): string {
  const partes = selado.split('.');
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new CofreInvalido('Formato desconhecido.');
  }
  const [, pub, nonce, cifra] = partes;
  const aberto = nacl.box.open(deB64(cifra!), deB64(nonce!), deB64(pub!), deB64(secretKeyBase64));
  if (!aberto) throw new CofreInvalido('Não foi possível abrir: chave errada ou dado alterado.');
  return Buffer.from(aberto).toString('utf8');
}

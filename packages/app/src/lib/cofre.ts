/**
 * A chave que fica no aparelho.
 *
 * ## O trato
 *
 * A partir de 22/08/2026 o Rastro guarda no servidor mensagens e comentários que
 * chegam pela API do Instagram. Até aqui nenhum texto de conversa saía do
 * celular, e essa mudança só é defensável por causa deste arquivo:
 *
 *   1. aqui nasce um par de chaves. A **pública** vai para o servidor;
 *   2. o webhook chega lá e sela o conteúdo com ela;
 *   3. a **privada** nunca sai daqui, e só ela abre.
 *
 * O servidor guarda sem poder ler. Não é "prometemos não olhar" — é não ter como.
 *
 * ## Onde a privada mora, e o que isso custa
 *
 * `expo-secure-store`: Keychain no iOS, Keystore no Android. Não vai para backup
 * de nuvem, não aparece em `atividade.json`, some com o app.
 *
 * O preço é real e a tela precisa dizer: **celular novo não abre o histórico do
 * antigo**. É o mesmo comportamento de qualquer coisa ponta a ponta, e a
 * alternativa — guardar a privada no servidor — apagaria a única razão de a
 * decisão de guardar DM ter sido tomada.
 *
 * ## Por que tweetnacl
 *
 * JS puro, sem módulo nativo, e o mesmo algoritmo do outro lado
 * (`packages/api/src/lib/cofre.ts`). O React Native não tem `node:crypto`, e
 * trazer uma implementação nativa de crypto para decifrar algumas centenas de
 * mensagens seria pagar um build inteiro por nada.
 *
 * A aleatoriedade vem do `expo-crypto`, injetada abaixo: o Hermes não tem
 * `crypto.getRandomValues`, e sem PRNG o tweetnacl **lança na geração da
 * chave** — o que aconteceria só no aparelho, nunca no navegador.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import { deBase64, paraBase64 } from '@rastro/core';

/** Onde a privada mora. Trocar esta chave é perder o histórico selado. */
const CHAVE_PRIVADA = 'rastro.cofre.privada';
const CHAVE_PUBLICA = 'rastro.cofre.publica';

let prngPronto = false;

/**
 * Liga o gerador de aleatoriedade do tweetnacl.
 *
 * `getRandomBytes` do expo-crypto é síncrono e vem do gerador do sistema
 * (SecRandomCopyBytes / SecureRandom). O tweetnacl exige um PRNG síncrono, então
 * a versão assíncrona não serviria.
 */
function garantirPrng(): void {
  if (prngPronto) return;
  nacl.setPRNG((x, n) => {
    const bytes = Crypto.getRandomBytes(n);
    for (let i = 0; i < n; i++) x[i] = bytes[i]!;
  });
  prngPronto = true;
}

export interface ParDeChaves {
  publicKey: string;
  /** Nova neste aparelho. O servidor descarta o histórico selado para a antiga. */
  recemCriada: boolean;
}

/**
 * A chave pública deste aparelho, criando o par se ainda não existir.
 *
 * Chamada antes de qualquer leitura de conteúdo selado. Devolve `null` no
 * navegador, onde o SecureStore não existe — e lá o modo fantasma não é
 * oferecido.
 */
export async function chaveDoAparelho(): Promise<ParDeChaves | null> {
  try {
    if (!(await SecureStore.isAvailableAsync())) return null;

    const guardada = await SecureStore.getItemAsync(CHAVE_PUBLICA);
    const privada = await SecureStore.getItemAsync(CHAVE_PRIVADA);
    // As duas ou nenhuma: meia chave guardada é histórico que não abre.
    if (guardada && privada) return { publicKey: guardada, recemCriada: false };

    garantirPrng();
    const par = nacl.box.keyPair();
    const publica = paraBase64(par.publicKey);

    await SecureStore.setItemAsync(CHAVE_PRIVADA, paraBase64(par.secretKey));
    await SecureStore.setItemAsync(CHAVE_PUBLICA, publica);

    return { publicKey: publica, recemCriada: true };
  } catch {
    return null;
  }
}

/**
 * Abre um selo vindo do servidor.
 *
 * Devolve `null` em vez de lançar, e isso é proposital: numa lista de mensagens,
 * uma que não abre — porque foi selada para a chave de um aparelho anterior — não
 * pode derrubar as outras. A tela mostra as que abriram e explica o resto.
 */
export async function abrirSelo(selado: string): Promise<string | null> {
  try {
    const privada = await SecureStore.getItemAsync(CHAVE_PRIVADA);
    if (!privada) return null;

    const partes = selado.split('.');
    if (partes.length !== 4 || partes[0] !== 'v1') return null;

    const aberto = nacl.box.open(
      deBase64(partes[3]!),
      deBase64(partes[2]!),
      deBase64(partes[1]!),
      deBase64(privada),
    );
    if (!aberto) return null;
    return new TextDecoder().decode(aberto);
  } catch {
    return null;
  }
}

/** Esquece o par. O que estava selado no servidor deixa de abrir — para sempre. */
export async function esquecerChave(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CHAVE_PRIVADA);
    await SecureStore.deleteItemAsync(CHAVE_PUBLICA);
  } catch {
    // Sem chave guardada não há o que apagar.
  }
}

/**
 * Onde os tokens ficam guardados no aparelho.
 *
 * O refresh token é o único segredo capaz de reabrir a conta: com ele, quem o
 * tiver entra sem senha e sem 2FA por 60 dias. Por isso ele vai para o
 * Keychain (iOS) / Keystore (Android) via `expo-secure-store`, e nunca para
 * AsyncStorage — que é um arquivo em texto claro, legível por qualquer app em
 * aparelho com root e copiado junto no backup.
 *
 * O access token dura 15 minutos e mora só na memória. Persistir também não
 * ajudaria: quando o app reabre, ele quase certamente já expirou, e o refresh
 * resolve em uma requisição.
 *
 * No navegador não existe Keychain. O fallback é `localStorage`, que é menos
 * seguro (qualquer XSS o alcança) — e é por isso que a versão web é ferramenta
 * de desenvolvimento e teste, não o alvo do produto.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const CHAVE_REFRESH = 'rastro.refreshToken';

const ehWeb = Platform.OS === 'web';

export async function lerRefreshToken(): Promise<string | null> {
  try {
    if (ehWeb) return globalThis.localStorage?.getItem(CHAVE_REFRESH) ?? null;
    return await SecureStore.getItemAsync(CHAVE_REFRESH);
  } catch {
    // Keychain indisponível (aparelho bloqueado logo após o boot, por exemplo).
    // Tratar como "sem sessão" é melhor que travar a abertura do app.
    return null;
  }
}

export async function guardarRefreshToken(token: string): Promise<void> {
  if (ehWeb) {
    globalThis.localStorage?.setItem(CHAVE_REFRESH, token);
    return;
  }
  await SecureStore.setItemAsync(CHAVE_REFRESH, token, {
    // Sem isto, o token sai no backup do iCloud e vai parar no aparelho novo
    // de quem restaurou o backup — inclusive se não for a mesma pessoa.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function apagarRefreshToken(): Promise<void> {
  try {
    if (ehWeb) globalThis.localStorage?.removeItem(CHAVE_REFRESH);
    else await SecureStore.deleteItemAsync(CHAVE_REFRESH);
  } catch {
    // Já não estava lá.
  }
}

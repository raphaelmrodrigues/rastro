/**
 * Abrir o perfil de alguém no Instagram.
 *
 * Este arquivo é a fronteira do que o Rastro faz com a conta de terceiros: ele
 * entrega o link e sai de cena. Nada é executado na conta do usuário nem na do
 * outro — quem segue, deixa de seguir ou manda mensagem é a pessoa, dentro do
 * Instagram. Ver regra 4 do CLAUDE.md. Se alguém pedir para esta função "já
 * deixar de seguir", a resposta é não: isso é automação de conta.
 *
 * Não confundir com integração: aqui não há chamada de API, token nem sessão.
 * É só uma URL. Por isso este arquivo não conflita com a regra do
 * `packages/api/src/lib/instagramApi.ts` ser o único a falar com o Instagram —
 * este não fala com ninguém.
 */

import { Linking, Platform } from 'react-native';

/** O @ já vem normalizado do parser, mas nem toda origem futura vai passar por lá. */
function limpar(username: string): string {
  return username.trim().replace(/^@+/, '');
}

/** URL universal. No celular, iOS e Android abrem isto no app do Instagram se ele estiver instalado. */
export function urlDoPerfil(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(limpar(username))}/`;
}

/** Deep link direto do app instalado. Só funciona se o Instagram estiver no aparelho. */
export function deepLinkDoPerfil(username: string): string {
  return `instagram://user?username=${encodeURIComponent(limpar(username))}`;
}

/**
 * Abre o perfil e devolve se conseguiu.
 *
 * Nunca lança: uma lista com centenas de linhas não pode quebrar porque um toque
 * caiu num aparelho sem navegador padrão.
 */
export async function abrirPerfil(username: string): Promise<boolean> {
  const web = urlDoPerfil(username);

  if (Platform.OS === 'web') {
    // Um <a> de verdade, e não `window.open`, por dois motivos:
    //
    // 1. navegador nenhum classifica o clique num link como popup, então não há
    //    o que bloquear — com `window.open` há, se o gesto se perder no caminho;
    // 2. `window.open(..., 'noopener')` devolve null SEMPRE, por especificação.
    //    Ou seja, o retorno não serve como sinal de sucesso: uma versão anterior
    //    deste arquivo lia esse null como falha e mostrava erro em toda abertura
    //    bem-sucedida. Só apareceu porque foi testado no navegador de verdade.
    //
    // Precisa ser síncrono dentro do gesto: qualquer `await` antes daqui e a
    // ativação do usuário se perde.
    try {
      const link = document.createElement('a');
      link.href = web;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
    } catch {
      return false;
    }
  }

  try {
    // De propósito sem `canOpenURL`: no Android 11+ ele exige declarar `queries`
    // no manifesto e devolve false por omissão, e no iOS exige
    // LSApplicationQueriesSchemes. Tentar e cair no catch funciona sem depender
    // de configuração nativa — e o https abaixo cobre quem não tem o app.
    await Linking.openURL(deepLinkDoPerfil(username));
    return true;
  } catch {
    try {
      await Linking.openURL(web);
      return true;
    } catch {
      // Sem log: o @ é conteúdo de snapshot e não vai para lugar nenhum (regra 5).
      return false;
    }
  }
}

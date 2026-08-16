/**
 * Botão voltar do Android.
 *
 * No Android o gesto e o botão de voltar são a navegação principal — mais usados
 * que qualquer seta desenhada na tela. Sem tratar `hardwareBackPress`, o sistema
 * usa o comportamento padrão, que é **fechar o app**: quem abrisse a lista de
 * quem deixou de seguir e voltasse cairia fora do Rastro em vez de voltar ao
 * início. Não aparece no navegador nem no iOS, onde voltar é gesto de borda
 * tratado pelo próprio sistema de navegação.
 *
 * O contrato do RN: devolver `true` significa "eu tratei, não faça mais nada";
 * `false` deixa o sistema seguir com o padrão (sair). Por isso a raiz da
 * navegação precisa devolver `false` — um app que nunca deixa sair pelo botão
 * de voltar irrita mais do que um que sai cedo demais.
 */

import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Registra o tratador do botão voltar.
 *
 * @param aoVoltar devolve `true` se consumiu o evento, `false` para deixar o
 *   sistema fechar o app.
 */
export function useBotaoVoltar(aoVoltar: () => boolean): void {
  useEffect(() => {
    // Só o Android tem esse evento. No web o react-native-web expõe um
    // `BackHandler` que não faz nada, e registrar lá só gera trabalho morto.
    if (Platform.OS !== 'android') return;

    const inscricao = BackHandler.addEventListener('hardwareBackPress', aoVoltar);
    // `removeEventListener` foi removido do RN 0.74; o descarte agora sai da
    // própria inscrição.
    return () => inscricao.remove();
  }, [aoVoltar]);
}

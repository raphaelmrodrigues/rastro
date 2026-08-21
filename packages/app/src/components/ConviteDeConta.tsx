/**
 * Convite para criar conta, mostrado depois do import.
 *
 * ## Por que aqui, e não na abertura
 *
 * Pedir cadastro antes de a pessoa ver qualquer resultado é a forma mais cara de
 * perder usuário num funil que já obriga a sair do app e esperar por um arquivo.
 * Depois do import é o oposto: ela acabou de ver a própria rede na tela e tem
 * algo concreto a perder.
 *
 * O texto vende exatamente isso — não perder — em vez de "sincronize seus
 * dados", que é vocabulário de quem construiu o app.
 *
 * ## Por que ele some, e volta
 *
 * Some ao ser dispensado e volta no import seguinte. Quem tem mais arquivos tem
 * mais a perder, então o convite fica mais relevante a cada vez; mas insistir na
 * mesma sessão depois de um "agora não" é o comportamento que faz a pessoa
 * associar o app a um vendedor chato.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { colors, elevation, radius, space, typography } from '../lib/theme';

interface Props {
  /** Quantos arquivos existem neste aparelho. Muda o peso do argumento. */
  snapshotCount: number;
  onCriarConta: () => void;
  onEntrar: () => void;
  onDispensar: () => void;
}

export function ConviteDeConta({ snapshotCount, onCriarConta, onEntrar, onDispensar }: Props) {
  /*
   * Com um arquivo só, "perder o histórico" ainda é abstrato — o argumento real
   * é o próximo import. Com dois ou mais, existe histórico de verdade, e o texto
   * pode nomear o que está em jogo.
   */
  const corpo =
    snapshotCount <= 1
      ? 'Seus dados estão só neste celular. Se você trocar de aparelho ou reinstalar o app, ' +
        'começa do zero — e o histórico é o que faz o Rastro mostrar quem saiu.'
      : `Você já tem ${snapshotCount} atualizações guardadas só neste celular. Uma conta guarda ` +
        'esse histórico fora do aparelho, para não perder nada se trocar de celular.';

  return (
    <View style={s.caixa}>
      <Text style={s.titulo}>Não perca o que você já juntou</Text>
      <Text style={s.corpo}>{corpo}</Text>
      <Text style={s.nota}>
        A senha é só do Rastro. Nunca pedimos a senha do seu Instagram.
      </Text>

      <View style={s.acoes}>
        <Button label="Criar conta" onPress={onCriarConta} />
        <View style={s.secundarias}>
          <View style={s.metade}>
            <Button label="Já tenho conta" variant="ghost" onPress={onEntrar} />
          </View>
          <View style={s.metade}>
            <Button label="Agora não" variant="ghost" onPress={onDispensar} />
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  /*
   * Cartão branco elevado, e não mais um segundo bloco de gradiente.
   *
   * O convite fica logo abaixo do cabeçalho do painel, que já é um cartão com
   * gradiente. Dois blocos coloridos empilhados viravam uma parede rosa sem
   * hierarquia: não dava para dizer qual era o retrato da rede e qual era o
   * anúncio. A cor do convite mora onde ela convence, que é o botão.
   */
  caixa: {
    // Cartão elevado sobre o fundo. No escuro isso significa mais claro que
    // `base`, nunca igual — ver a regra 2 no topo de `theme.ts`.
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
    marginBottom: space.md,
    ...elevation.cartao,
  },
  titulo: {
    color: colors.ink,
    fontFamily: typography.display.semibold,
    fontSize: typography.scale.section,
    letterSpacing: -0.2,
  },
  corpo: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  nota: { color: colors.inkFaint, fontSize: typography.scale.micro, lineHeight: 17, marginTop: 2 },
  acoes: { gap: space.xs, marginTop: space.sm },
  secundarias: { flexDirection: 'row', gap: space.xs },
  metade: { flex: 1 },
});

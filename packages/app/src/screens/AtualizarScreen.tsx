/**
 * Tela de atualização obrigatória.
 *
 * Aparece quando o servidor responde 426 — ou seja, quando esta versão do app
 * foi desligada. É um beco sem saída de propósito: não há botão de voltar nem
 * de continuar assim mesmo, porque a partir daqui nenhuma chamada vai funcionar
 * e "continuar" só levaria a erros piores.
 *
 * O texto não culpa o usuário nem fala em erro. Do ponto de vista dele não
 * houve falha nenhuma: o app dele simplesmente ficou velho, e a ação é uma só.
 *
 * Os dados dele continuam intactos — no aparelho e no servidor. Dizer isso é o
 * que impede a conclusão natural de que ele perdeu o histórico e precisa
 * recomeçar do zero.
 */

import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { Logotipo } from '../components/Marca';
import { colors, space, typography } from '../lib/theme';

/**
 * Onde o app mora em cada loja.
 *
 * O identificador vem do app.json e precisa continuar igual: se um dia o bundle
 * id mudar, estes links levam a uma página inexistente justamente no momento em
 * que o usuário está preso nesta tela.
 */
const LOJA = {
  ios: 'https://apps.apple.com/app/rastro/id0000000000',
  android: 'https://play.google.com/store/apps/details?id=com.urlsnapshot.rastro',
} as const;

export function AtualizarScreen() {
  const abrirLoja = () => {
    const url = Platform.OS === 'ios' ? LOJA.ios : LOJA.android;
    void Linking.openURL(url).catch(() => {
      // Sem loja no aparelho (navegador, emulador sem Play Services) o link não
      // abre. Falhar em silêncio é aceitável: o texto já diz o que fazer.
    });
  };

  return (
    <View style={s.raiz}>
      <Logotipo size="grande" />

      <Text style={s.titulo}>Tem uma versão nova</Text>
      <Text style={s.corpo}>
        Esta versão do Rastro não funciona mais. Atualize na loja para continuar de onde parou.
      </Text>
      <Text style={s.tranquilizador}>
        Seus dados e seu histórico estão guardados. Nada se perde com a atualização.
      </Text>

      {Platform.OS === 'web' ? null : (
        <View style={s.acao}>
          <Button label="Atualizar agora" onPress={abrirLoja} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  raiz: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    gap: space.md,
  },
  titulo: {
    color: colors.ink,
    fontSize: typography.scale.title,
    fontWeight: typography.weight.bold,
    marginTop: space.md,
  },
  corpo: {
    color: colors.inkMuted,
    fontSize: typography.scale.body,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  tranquilizador: {
    color: colors.inkFaint,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 320,
  },
  acao: { alignSelf: 'stretch', maxWidth: 320, marginTop: space.sm },
});

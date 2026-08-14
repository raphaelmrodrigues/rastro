/**
 * Aba Pessoas — o índice das listas.
 *
 * Existe porque as listas são o motivo real de o app ser aberto, e enterrá-las
 * no meio do painel obrigaria a rolar até achá-las toda vez. Aqui elas são a
 * tela inteira, na ordem em que as pessoas costumam querer: primeiro quem saiu.
 *
 * Cada linha traz o número junto do rótulo. Uma lista de menu sem contagem
 * obriga a abrir para descobrir se vale a pena abrir.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Reports } from '../lib/store';
import { MenuRow, SectionTitle } from '../components/ui';
import { colors, space, typography } from '../lib/theme';
import { formatNumber } from '../lib/format';
import type { ListaId } from './DashboardScreen';

interface Props {
  reports: Reports;
  onOpenList: (lista: ListaId) => void;
}

export function PessoasScreen({ reports, onOpenList }: Props) {
  const { insights, diff } = reports;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {diff ? (
        <>
          <SectionTitle>Desde a última atualização</SectionTitle>
          <MenuRow
            label="Deixaram de te seguir"
            value={formatNumber(diff.lost.length)}
            onPress={() => onOpenList('saíram')}
          />
          <MenuRow
            label="Começaram a te seguir"
            value={formatNumber(diff.gained.length)}
            onPress={() => onOpenList('entraram')}
          />
        </>
      ) : (
        <View style={s.aviso}>
          <Text style={s.avisoTexto}>
            Quem saiu e quem entrou aparece depois que você enviar um segundo arquivo. Por
            enquanto, dá para ver o retrato da sua rede hoje.
          </Text>
        </View>
      )}

      <SectionTitle>Sua rede hoje</SectionTitle>
      <MenuRow
        label="Não te seguem de volta"
        value={formatNumber(insights.notFollowingYouBack.length)}
        onPress={() => onOpenList('nao-seguem-de-volta')}
      />
      <MenuRow
        label="Você não segue de volta"
        value={formatNumber(insights.youDontFollowBack.length)}
        onPress={() => onOpenList('voce-nao-segue')}
      />
      <MenuRow
        label="Seguidores mútuos"
        value={formatNumber(insights.mutuals.length)}
        onPress={() => onOpenList('mutuos')}
      />
      <MenuRow
        label="Solicitações que você enviou"
        value={formatNumber(insights.pendingRequestsSent.length)}
        onPress={() => onOpenList('pendentes')}
      />

      <Text style={s.nota}>
        Toque em qualquer pessoa para abrir o perfil dela no Instagram.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.lg, paddingBottom: space.xl },
  aviso: { paddingVertical: space.md },
  avisoTexto: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  nota: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    marginTop: space.lg,
    lineHeight: 17,
  },
});

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
import type { Snapshot } from '@rastro/core';
import type { Reports } from '../lib/store';
import { Grupo, MenuRow, SectionTitle } from '../components/ui';
import { colors, space, typography } from '../lib/theme';
import { formatNumber } from '../lib/format';
import type { ListaId } from './DashboardScreen';

interface Props {
  reports: Reports;
  snapshot: Snapshot;
  onOpenList: (lista: ListaId) => void;
  onOpenAtividade: () => void;
  /** `null` quando ainda não veio export completo. Ver DashboardScreen. */
  conversasPendentes: number | null;
}

export function PessoasScreen({
  reports,
  snapshot,
  onOpenList,
  onOpenAtividade,
  conversasPendentes,
}: Props) {
  const { insights, diff } = reports;
  const { recentlyUnfollowed, blocked, closeFriends, restricted } = snapshot.relationships;

  /*
   * A seção só aparece se houver alguma coisa nela.
   *
   * Estas quatro listas são vazias para muita gente — ninguém bloqueia, ninguém
   * usa melhores amigos. Quatro linhas zeradas empurrariam as listas que a
   * pessoa realmente veio ver para fora da tela, e é justamente a aba onde ela
   * chega com pressa.
   */
  const temListasDoInstagram =
    recentlyUnfollowed.length + blocked.length + closeFriends.length + restricted.length > 0;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {diff ? (
        <>
          <SectionTitle>Desde a última atualização</SectionTitle>
          <Grupo>
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
          </Grupo>
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
      <Grupo>
        <MenuRow
          label="Você segue, eles não"
          value={formatNumber(insights.notFollowingYouBack.length)}
          onPress={() => onOpenList('nao-seguem-de-volta')}
        />
        <MenuRow
          label="Te seguem, você não"
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
      </Grupo>

      {temListasDoInstagram ? (
        <>
          <SectionTitle>Suas listas do Instagram</SectionTitle>
          <Text style={s.notaSecao}>
            Listas que você mesmo montou dentro do Instagram. Aqui elas ficam num lugar só, com
            busca — o app do Instagram não mostra nenhuma delas junta.
          </Text>

          {recentlyUnfollowed.length > 0 ? (
            <MenuRow
              label="Você deixou de seguir"
              value={formatNumber(recentlyUnfollowed.length)}
              onPress={() => onOpenList('deixei-de-seguir')}
            />
          ) : null}
          {closeFriends.length > 0 ? (
            <MenuRow
              label="Melhores amigos"
              value={formatNumber(closeFriends.length)}
              onPress={() => onOpenList('amigos-proximos')}
            />
          ) : null}
          {blocked.length > 0 ? (
            <MenuRow
              label="Contas bloqueadas"
              value={formatNumber(blocked.length)}
              onPress={() => onOpenList('bloqueados')}
            />
          ) : null}
          {restricted.length > 0 ? (
            <MenuRow
              label="Contas restritas"
              value={formatNumber(restricted.length)}
              onPress={() => onOpenList('restritos')}
            />
          ) : null}
        </>
      ) : null}

      <SectionTitle>Conversas</SectionTitle>
      <MenuRow
        label="Conversas e atividade"
        value={
          conversasPendentes === null ? 'ver mais' : `${formatNumber(conversasPendentes)} sem resposta`
        }
        onPress={onOpenAtividade}
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
  notaSecao: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
    marginBottom: space.xs,
  },
});

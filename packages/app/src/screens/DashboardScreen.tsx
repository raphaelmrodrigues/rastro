/**
 * Painel principal — a tela que o usuario abre depois do primeiro import.
 *
 * Ordem de leitura deliberada:
 *   1. avisos sobre a qualidade do proprio import (se o dado esta torto, isso vem
 *      antes de qualquer numero, nao como rodape);
 *   2. o que mudou desde o import anterior;
 *   3. o estado atual da rede;
 *   4. atalhos para as listas.
 *
 * O usuario chega ansioso para ver "quem saiu". Justamente por isso o aviso de
 * export incompleto vem antes: e o unico momento em que ele para para ler.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Reports } from '../lib/store';
import type { Snapshot } from '@rastro/core';
import { Banner, Button, SectionTitle, StatCard } from '../components/ui';
import { colors, space, typography } from '../lib/theme';
import { formatDate, formatNumber, formatPercent, formatRelative, formatSigned } from '../lib/format';

export type ListaId =
  | 'saíram'
  | 'entraram'
  | 'nao-seguem-de-volta'
  | 'voce-nao-segue'
  | 'mutuos'
  | 'pendentes';

interface Props {
  snapshot: Snapshot;
  reports: Reports;
  snapshotCount: number;
  onOpenList: (lista: ListaId) => void;
  onOpenStats: () => void;
  onImportAgain: () => void;
  onOpenModes: () => void;
  onOpenConta: () => void;
}

/** Dias apos os quais vale a pena reimportar. Abaixo disso, o diff diz pouco. */
const DIAS_PARA_REIMPORTAR = 14;

export function DashboardScreen({
  snapshot,
  reports,
  snapshotCount,
  onOpenList,
  onOpenStats,
  onImportAgain,
  onOpenModes,
  onOpenConta,
}: Props) {
  const { insights, diff } = reports;
  const diasDesdeImport = Math.floor((Date.now() - snapshot.importedAt) / 86_400_000);

  const exportParcial = snapshot.warnings.find((w) => w.code === 'PARTIAL_EXPORT');

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>Seu rastro</Text>
      <Text style={s.title}>{formatNumber(insights.followerCount)} seguidores</Text>
      <Text style={s.subtitle}>
        Último import {formatRelative(snapshot.importedAt)} · {formatDate(snapshot.importedAt)}
      </Text>

      {/* Qualidade do dado antes do dado. */}
      {exportParcial ? (
        <Banner
          tone="warning"
          title="Este export não cobre sua conta inteira"
          body={exportParcial.detail}
        />
      ) : null}

      {diff && diff.reliability.level === 'suspect' ? (
        <Banner
          tone="warning"
          title="Esta comparação pode estar errada"
          body={diff.reliability.reasons.join(' ')}
        />
      ) : null}

      {diff ? (
        <>
          <SectionTitle>Desde o import anterior</SectionTitle>
          <View style={s.row}>
            <StatCard
              label="Entraram"
              value={formatSigned(diff.gained.length)}
              tone="gained"
              hint="com data exata"
            />
            <StatCard
              label="Saíram"
              value={formatNumber(diff.lost.length)}
              tone="lost"
              hint="data aproximada"
            />
          </View>
          <View style={s.row}>
            <StatCard label="Saldo" value={formatSigned(diff.netChange)} />
            <StatCard
              label="Trocaram de @"
              value={formatNumber(diff.renames.length)}
              hint={diff.renames.length > 0 ? 'não contam como saída' : undefined}
            />
          </View>

          <View style={s.actions}>
            <Button label={`Ver quem saiu (${diff.lost.length})`} onPress={() => onOpenList('saíram')} />
            <Button
              label={`Ver quem entrou (${diff.gained.length})`}
              variant="ghost"
              onPress={() => onOpenList('entraram')}
            />
          </View>
        </>
      ) : (
        <Banner
          title="Ainda não dá para comparar"
          body={
            'Este é o seu primeiro import — ele é o ponto de partida. Quem saiu e quem ' +
            'entrou aparece a partir do segundo arquivo, porque a comparação nasce da ' +
            'diferença entre dois momentos.'
          }
        />
      )}

      <SectionTitle>Sua rede hoje</SectionTitle>
      <View style={s.row}>
        <StatCard label="Você segue" value={formatNumber(insights.followingCount)} />
        <StatCard
          label="Mútuos"
          value={formatNumber(insights.mutuals.length)}
          hint={formatPercent(
            insights.followerCount === 0 ? 0 : insights.mutuals.length / insights.followerCount,
            0,
          ) + ' dos seguidores'}
        />
      </View>

      <View style={s.actions}>
        <Button
          label={`Não te seguem de volta (${insights.notFollowingYouBack.length})`}
          variant="ghost"
          onPress={() => onOpenList('nao-seguem-de-volta')}
        />
        <Button
          label={`Você não segue de volta (${insights.youDontFollowBack.length})`}
          variant="ghost"
          onPress={() => onOpenList('voce-nao-segue')}
        />
        <Button
          label={`Seguidores mútuos (${insights.mutuals.length})`}
          variant="ghost"
          onPress={() => onOpenList('mutuos')}
        />
        <Button
          label={`Solicitações pendentes (${insights.pendingRequestsSent.length})`}
          variant="ghost"
          onPress={() => onOpenList('pendentes')}
        />
        {snapshotCount > 1 ? (
          <Button label="Estatísticas e safras" variant="ghost" onPress={onOpenStats} />
        ) : null}
      </View>

      {diasDesdeImport >= DIAS_PARA_REIMPORTAR ? (
        <Banner
          tone="warning"
          title="Hora de atualizar"
          body={`Faz ${diasDesdeImport} dias desde o último import. Quanto mais frequente, mais estreita fica a janela de "saiu entre tal e tal dia".`}
          action={<View style={s.bannerAction}><Button label="Importar de novo" onPress={onImportAgain} /></View>}
        />
      ) : null}

      <SectionTitle>Sobre a precisão</SectionTitle>
      <Text style={s.note}>
        Quem entrou tem data exata — o Instagram registra esse momento no arquivo.
        Quem saiu não tem: o app só sabe que a pessoa estava na lista de um import e
        não estava no seguinte. Por isso as saídas aparecem como intervalo, e não como
        dia e hora.
      </Text>

      <View style={s.actions}>
        <Button label="Existe um jeito sem arquivo?" variant="ghost" onPress={onOpenModes} />
        <Button label="Importar novo arquivo" variant="ghost" onPress={onImportAgain} />
        <Button label="Sincronizar entre aparelhos" variant="ghost" onPress={onOpenConta} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.lg, paddingBottom: space.xxl },
  eyebrow: {
    color: colors.gained,
    fontSize: typography.scale.micro,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: { color: colors.ink, fontSize: typography.scale.hero, marginTop: space.xs },
  subtitle: { color: colors.inkMuted, fontSize: typography.scale.caption },
  row: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  actions: { gap: space.sm, marginTop: space.md },
  bannerAction: { marginTop: space.sm },
  note: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
  },
});

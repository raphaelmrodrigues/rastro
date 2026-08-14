/**
 * Estatisticas: distribuicao de entrada, safras e os seguidores mais antigos.
 *
 * O grafico e desenhado com barras proprias em vez de biblioteca: sao poucas
 * series, todas categoricas, e uma dependencia de charting traria peso e um visual
 * generico que briga com a direcao de arte.
 *
 * Nota sobre safras: elas comparam o import mais antigo guardado com o mais
 * recente. Quem entrou antes do primeiro import so aparece se ainda estiver na
 * lista — a tela diz isso, porque uma retencao de "100%" numa safra antiga seria
 * ilusao de otica do proprio metodo.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Reports } from '../lib/store';
import { Banner, SectionTitle } from '../components/ui';
import { colors, radius, space, typography } from '../lib/theme';
import { formatDate, formatNumber, formatPercent, formatPeriod } from '../lib/format';

interface Props {
  reports: Reports;
  snapshotCount: number;
}

/** Barra horizontal proporcional ao maior valor da serie. */
function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone?: 'gained' | 'neutral' }) {
  const ratio = max === 0 ? 0 : value / max;
  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label}</Text>
      <View style={s.barTrack}>
        <View
          style={[
            s.barFill,
            { width: `${Math.max(ratio * 100, value > 0 ? 2 : 0)}%` },
            tone === 'gained' && { backgroundColor: colors.gained },
          ]}
        />
      </View>
      <Text style={s.barValue}>{formatNumber(value)}</Text>
    </View>
  );
}

export function StatsScreen({ reports, snapshotCount }: Props) {
  const { byPeriod, cohorts, insights } = reports;

  const ultimosMeses = byPeriod.slice(-12);
  const maxEntradas = Math.max(1, ...ultimosMeses.map((p) => p.count));
  const maxSafra = Math.max(1, ...cohorts.map((c) => c.initialCount));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.title}>Evolução</Text>

      <SectionTitle>Quando as pessoas te seguiram</SectionTitle>
      <Text style={s.explicacao}>
        Cada barra é um mês. Picos costumam ter causa: um post que rendeu, uma
        indicação, uma participação em algo. Esta data é exata — vem do arquivo.
      </Text>
      <View style={s.chart}>
        {ultimosMeses.map((p) => (
          <Bar key={p.period} label={formatPeriod(p.period)} value={p.count} max={maxEntradas} tone="gained" />
        ))}
      </View>

      {cohorts.length > 0 ? (
        <>
          <SectionTitle>Safras</SectionTitle>
          <Text style={s.explicacao}>
            De cada grupo que começou a te seguir num mês, quantos ainda estão aqui.
            Safras que evaporam rápido indicam público atraído por um assunto pontual;
            safras que ficam indicam público que veio para acompanhar você.
          </Text>
          <View style={s.chart}>
            {cohorts.slice(-12).map((c) => (
              <View key={c.period} style={s.cohortRow}>
                <Text style={s.barLabel}>{formatPeriod(c.period)}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { width: `${(c.initialCount / maxSafra) * 100}%`, backgroundColor: colors.lostSoft }]} />
                  <View
                    style={[
                      s.barFillOverlay,
                      { width: `${(c.survivingCount / maxSafra) * 100}%` },
                    ]}
                  />
                </View>
                <Text style={s.barValue}>{formatPercent(c.retentionRate, 0)}</Text>
              </View>
            ))}
          </View>
          <Text style={s.legenda}>
            Barra clara: quantos eram. Barra âmbar: quantos ficaram.
          </Text>
        </>
      ) : (
        <Banner
          title="Safras precisam de dois imports"
          body={`Você tem ${snapshotCount} import(s) guardado(s). A partir do segundo, dá para medir quantos de cada mês continuam seguindo.`}
        />
      )}

      <SectionTitle>Com você há mais tempo</SectionTitle>
      <View style={s.oldest}>
        {insights.oldestFollowers.slice(0, 10).map((f, i) => (
          <View key={f.username} style={s.oldestRow}>
            <Text style={s.oldestRank}>{String(i + 1).padStart(2, '0')}</Text>
            <Text style={s.oldestHandle} numberOfLines={1}>@{f.username}</Text>
            <Text style={s.oldestDate}>desde {formatDate(f.since)}</Text>
          </View>
        ))}
      </View>

      <Banner
        title="Uma ressalva honesta"
        body={
          'Se o seu export foi pedido com período limitado, "mais antigos" significa ' +
          'mais antigos dentro daquele período — não da conta inteira. Peça "Todo o ' +
          'período" no próximo download para esta lista ficar correta.'
        }
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.lg, paddingBottom: space.xxl },
  title: { color: colors.ink, fontSize: typography.scale.title, marginTop: space.sm },
  explicacao: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },

  chart: { marginTop: space.md, gap: space.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cohortRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  barLabel: { color: colors.inkMuted, fontSize: typography.scale.micro, width: 64 },
  barTrack: {
    flex: 1,
    height: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.surfaceRaised, borderRadius: radius.pill },
  barFillOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    backgroundColor: colors.gained,
    borderRadius: radius.pill,
  },
  barValue: { color: colors.inkFaint, fontSize: typography.scale.micro, width: 44, textAlign: 'right' },
  legenda: { color: colors.inkFaint, fontSize: typography.scale.micro, marginTop: space.sm },

  oldest: { marginTop: space.sm },
  oldestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  oldestRank: { color: colors.inkFaint, fontSize: typography.scale.micro, width: 24 },
  oldestHandle: { color: colors.ink, fontSize: typography.scale.body, flex: 1 },
  oldestDate: { color: colors.inkMuted, fontSize: typography.scale.micro },
});

/**
 * Pecas visuais compartilhadas.
 *
 * A direcao de arte esta em lib/theme.ts e o motivo dela tambem. O resumo que
 * importa na hora de mexer aqui: saida de seguidor e desenhada como ausencia
 * (lilas apagado), nunca como erro (vermelho). Vermelho fica reservado para
 * falha real do app.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, typography } from '../lib/theme';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={s.screen}>{children}</View>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

/** Numero grande com rotulo. A unidade de leitura do painel. */
export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'gained' | 'lost';
}) {
  const valueColor =
    tone === 'gained' ? colors.gained : tone === 'lost' ? colors.lost : colors.ink;

  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={[s.cardValue, { color: valueColor }]}>{value}</Text>
      {hint ? <Text style={s.cardHint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * Aviso. `tone` separa o que e limitacao conhecida (info) do que exige acao do
 * usuario (warning) e do que e falha (danger). Um export com periodo limitado e
 * warning: o app funciona, mas o resultado sai torto se o usuario nao souber.
 */
export function Banner({
  title,
  body,
  tone = 'info',
  action,
}: {
  title: string;
  body: string;
  tone?: 'info' | 'warning' | 'danger';
  action?: ReactNode;
}) {
  const accent =
    tone === 'danger' ? colors.danger : tone === 'warning' ? colors.gained : colors.approximate;

  return (
    <View style={[s.banner, { borderLeftColor: accent }]}>
      <Text style={s.bannerTitle}>{title}</Text>
      <Text style={s.bannerBody}>{body}</Text>
      {action}
    </View>
  );
}

/**
 * Linha de pessoa: @ em destaque, contexto temporal abaixo.
 *
 * Com `onPress`, a linha inteira e o alvo — nao so o texto do @. Numa lista de
 * centenas de nomes lida com o polegar, um alvo de uma linha de altura erra o
 * tempo todo. O "↗" a direita e a unica marca de que abre fora do app; o @ fica
 * na cor normal de proposito, porque ambar aqui significaria "entrou alguem".
 */
export function PersonRow({
  username,
  displayName,
  detail,
  approximate,
  badge,
  onPress,
}: {
  username: string;
  displayName?: string;
  detail?: string;
  /** Marca visualmente que a data e uma janela, nao um instante. */
  approximate?: boolean;
  badge?: string;
  onPress?: () => void;
}) {
  const conteudo = (pressionado: boolean) => (
    <View style={[s.person, pressionado && s.personPressed]}>
      <View style={s.personText}>
        <Text style={s.personHandle} numberOfLines={1}>
          @{username}
        </Text>
        {displayName ? (
          <Text style={s.personName} numberOfLines={1}>
            {displayName}
          </Text>
        ) : null}
        {detail ? (
          <Text style={[s.personDetail, approximate && s.personDetailApprox]} numberOfLines={1}>
            {approximate ? '~ ' : ''}
            {detail}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeLabel}>{badge}</Text>
        </View>
      ) : null}
      {onPress ? <Text style={s.personLinkIcon}>↗</Text> : null}
    </View>
  );

  if (!onPress) return conteudo(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Abrir o perfil de @${username} no Instagram`}
    >
      {({ pressed }) => conteudo(pressed)}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        s.button,
        isPrimary && s.buttonPrimary,
        variant === 'danger' && s.buttonDanger,
        disabled && s.buttonDisabled,
      ]}
    >
      <Text
        style={[
          s.buttonLabel,
          isPrimary && s.buttonLabelPrimary,
          variant === 'danger' && s.buttonLabelDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  sectionTitle: { color: colors.ink, fontSize: typography.scale.section },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    flex: 1,
    minWidth: 140,
    gap: space.xs,
  },
  cardLabel: {
    color: colors.inkMuted,
    fontSize: typography.scale.micro,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cardValue: { fontSize: typography.scale.title },
  cardHint: { color: colors.inkFaint, fontSize: typography.scale.micro },

  banner: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    marginTop: space.md,
  },
  bannerTitle: { color: colors.ink, fontSize: typography.scale.body },
  bannerBody: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },

  person: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space.sm,
  },
  // Feedback de toque. Vale para o dedo e, na web, o RNW ja aplica cursor de link.
  personPressed: { backgroundColor: colors.surface },
  personText: { flex: 1, gap: 2 },
  personLinkIcon: { color: colors.inkFaint, fontSize: typography.scale.body },
  personHandle: { color: colors.ink, fontSize: typography.scale.body },
  personName: { color: colors.inkMuted, fontSize: typography.scale.caption },
  personDetail: { color: colors.inkFaint, fontSize: typography.scale.micro },
  // Cinza-azulado marca dado aproximado. Mesmo token do tracejado da trilha.
  personDetailApprox: { color: colors.approximate, fontStyle: 'italic' },

  badge: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeLabel: { color: colors.inkMuted, fontSize: typography.scale.micro },

  button: {
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonPrimary: { backgroundColor: colors.gained, borderColor: colors.gained },
  buttonDanger: { borderColor: colors.danger },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: colors.ink, fontSize: typography.scale.body },
  buttonLabelPrimary: { color: colors.base },
  buttonLabelDanger: { color: colors.danger },

  empty: { padding: space.xl, alignItems: 'center', gap: space.sm },
  emptyTitle: { color: colors.ink, fontSize: typography.scale.body },
  emptyBody: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    lineHeight: 20,
  },
});

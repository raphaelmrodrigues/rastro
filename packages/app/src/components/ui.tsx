/**
 * Peças visuais compartilhadas.
 *
 * A direção de arte está em lib/theme.ts e o motivo dela também. O resumo que
 * importa na hora de mexer aqui: saída de seguidor é desenhada como ausência
 * (lilás apagado), nunca como erro (vermelho). Vermelho fica reservado para
 * falha real do app.
 *
 * A gramática de composição é a dos apps de rede social, porque é a que o
 * usuário já sabe ler sem aprender nada: linha de pessoa com avatar circular à
 * esquerda, identificação no meio, ação à direita; números de perfil lado a lado
 * em colunas; botão principal ocupando a largura toda.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, typography, chrome } from '../lib/theme';
import { IconeExterno, IconeAvancar } from './icons';

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

/**
 * Avatar.
 *
 * O app não tem as fotos de perfil — elas não vêm no export do Instagram, e ir
 * buscá-las exigiria bater no servidor deles com a lista inteira de quem o
 * usuário segue, que é rastreamento de terceiros disfarçado de enfeite.
 *
 * Então a inicial do @ desenhada num círculo. A cor sai do próprio texto, de
 * forma determinística: a mesma pessoa tem sempre a mesma cor, em qualquer tela
 * e em qualquer import, o que ajuda a reconhecer alguém ao correr a lista.
 */
const TONS_AVATAR = ['#3A3350', '#2F3B52', '#4A3A2C', '#2C4440', '#42324A', '#333F35'] as const;

export function Avatar({ username, size = 44 }: { username: string; size?: number }) {
  let soma = 0;
  for (let i = 0; i < username.length; i++) soma = (soma + username.charCodeAt(i)) % 997;
  const fundo = TONS_AVATAR[soma % TONS_AVATAR.length];
  const inicial = (username.replace(/[^a-z0-9]/gi, '')[0] ?? '?').toUpperCase();

  return (
    <View
      style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: fundo }]}
    >
      <Text style={[s.avatarInicial, { fontSize: size * 0.4 }]}>{inicial}</Text>
    </View>
  );
}

/**
 * Trio de números do topo do painel, no formato que todo perfil de rede social
 * usa: valor grande em cima, rótulo pequeno embaixo, colunas de larguras iguais.
 * É a informação que o usuário procura primeiro, então ela não fica dentro de
 * cartão nenhum — fica solta, alinhada, e some de vista rápido.
 */
export function StatRow({
  itens,
}: {
  itens: Array<{ label: string; value: string; tone?: 'neutral' | 'gained' | 'lost'; onPress?: () => void }>;
}) {
  return (
    <View style={s.statRow}>
      {itens.map((item) => {
        const cor =
          item.tone === 'gained' ? colors.gained : item.tone === 'lost' ? colors.lost : colors.ink;
        const conteudo = (
          <>
            <Text style={[s.statValue, { color: cor }]}>{item.value}</Text>
            <Text style={s.statLabel}>{item.label}</Text>
          </>
        );

        if (!item.onPress) {
          return (
            <View key={item.label} style={s.statCol}>
              {conteudo}
            </View>
          );
        }
        return (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            accessibilityRole="button"
            style={({ pressed }) => [s.statCol, pressed && s.pressed]}
          >
            {conteudo}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Número grande com rótulo, dentro de cartão. Para pares de métricas. */
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
 * Aviso. `tone` separa o que é limitação conhecida (info) do que exige ação do
 * usuário (warning) e do que é falha (danger). Um export com período limitado é
 * warning: o app funciona, mas o resultado sai torto se o usuário não souber.
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
 * Linha de pessoa.
 *
 * A linha inteira é o alvo, não só o texto do @: numa lista de centenas de nomes
 * lida com o polegar, um alvo de uma linha de altura erra o tempo todo. A altura
 * mínima segue o alvo de toque de 44pt da Apple.
 *
 * O ícone de link externo à direita é a única marca de que a linha sai do app; o
 * @ fica na cor normal de propósito, porque âmbar aqui significaria "entrou
 * alguém" e a lista de quem saiu ficaria pintada de boas-vindas.
 */
export function PersonRow({
  username,
  displayName,
  detail,
  approximate,
  badge,
  onPress,
  /**
   * Se o rótulo é um @ do Instagram.
   *
   * Falso nas listas do export completo, onde a linha pode ser o nome de uma
   * pessoa numa conversa ("Ana Ribeiro") ou de uma empresa ("Loja X") — o
   * arquivo de conversa não traz @, e anunciante não tem. Escrever "@Ana
   * Ribeiro" faria a linha parecer um perfil que não existe.
   */
  comoArroba = true,
}: {
  username: string;
  displayName?: string;
  detail?: string;
  /** Marca visualmente que a data é uma janela, não um instante. */
  approximate?: boolean;
  badge?: string;
  onPress?: () => void;
  comoArroba?: boolean;
}) {
  const rotulo = comoArroba ? `@${username}` : username;

  const conteudo = (pressionado: boolean) => (
    <View style={[s.person, pressionado && s.personPressed]}>
      <Avatar username={username} />
      <View style={s.personText}>
        <Text style={s.personHandle} numberOfLines={1}>
          {rotulo}
        </Text>
        {displayName ? (
          <Text style={s.personName} numberOfLines={1}>
            {displayName}
          </Text>
        ) : null}
        {detail ? (
          <Text style={[s.personDetail, approximate && s.personDetailApprox]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        {badge ? (
          <View style={s.badge}>
            <Text style={s.badgeLabel}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {onPress ? <IconeExterno /> : null}
    </View>
  );

  if (!onPress) return conteudo(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Abrir o perfil de ${rotulo} no Instagram`}
    >
      {({ pressed }) => conteudo(pressed)}
    </Pressable>
  );
}

/**
 * Linha de menu: rótulo à esquerda, valor e chevron à direita.
 * É o padrão de "Ajustes" das duas plataformas.
 */
export function MenuRow({
  label,
  value,
  onPress,
  tone,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  tone?: 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Sem o rótulo composto, o leitor de tela anuncia só "Não te seguem de
      // volta" e o número fica de fora — que é justamente a informação que faz
      // a pessoa decidir se abre a lista.
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [s.menuRow, pressed && s.pressed]}
    >
      <Text style={[s.menuLabel, tone === 'danger' && { color: colors.danger }]}>{label}</Text>
      <View style={s.menuRight}>
        {value ? <Text style={s.menuValue}>{value}</Text> : null}
        <IconeAvancar />
      </View>
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
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.button,
        isPrimary && s.buttonPrimary,
        variant === 'secondary' && s.buttonSecondary,
        variant === 'ghost' && s.buttonGhost,
        variant === 'danger' && s.buttonDanger,
        disabled && s.buttonDisabled,
        pressed && !disabled && s.pressed,
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
  pressed: { opacity: 0.6 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: typography.scale.section,
    fontWeight: typography.weight.semibold,
  },

  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarInicial: { color: colors.ink, fontWeight: typography.weight.semibold },

  statRow: {
    flexDirection: 'row',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  statCol: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.xs },
  statValue: { fontSize: typography.scale.title, fontWeight: typography.weight.bold },
  statLabel: { color: colors.inkMuted, fontSize: typography.scale.caption },

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
  cardValue: { fontSize: typography.scale.title, fontWeight: typography.weight.bold },
  cardHint: { color: colors.inkFaint, fontSize: typography.scale.micro },

  banner: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    marginTop: space.md,
  },
  bannerTitle: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  bannerBody: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },

  person: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: chrome.touchMin + 16,
    paddingVertical: space.sm,
    gap: space.md,
  },
  personPressed: { backgroundColor: colors.surface },
  personText: { flex: 1, gap: 1 },
  personHandle: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  personName: { color: colors.inkMuted, fontSize: typography.scale.caption },
  personDetail: { color: colors.inkFaint, fontSize: typography.scale.micro },
  /** Itálico e cinza-azulado marcam dado aproximado. Mesmo token do tracejado da trilha. */
  personDetailApprox: { color: colors.approximate, fontStyle: 'italic' },

  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    marginTop: 3,
  },
  badgeLabel: { color: colors.inkMuted, fontSize: typography.scale.micro },

  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: chrome.touchMin + 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  menuLabel: { color: colors.ink, fontSize: typography.scale.body },
  menuRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  menuValue: { color: colors.inkFaint, fontSize: typography.scale.caption },

  button: {
    borderRadius: radius.md,
    minHeight: chrome.touchMin + 4,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: colors.gained },
  buttonSecondary: { backgroundColor: colors.surfaceRaised },
  buttonGhost: { borderWidth: 1, borderColor: colors.border },
  buttonDanger: { borderWidth: 1, borderColor: colors.danger },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  buttonLabelPrimary: { color: colors.base },
  buttonLabelDanger: { color: colors.danger },

  empty: { padding: space.xl, alignItems: 'center', gap: space.sm },
  emptyTitle: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  emptyBody: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    lineHeight: 20,
  },
});

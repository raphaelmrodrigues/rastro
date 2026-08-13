/**
 * Tokens visuais do Rastro.
 *
 * Direção de arte, e o porquê — para as telas novas não derivarem para o genérico:
 *
 * O app fala sobre pessoas saindo da sua vida. Um app de seguidores que usa
 * vermelho-alarme para "deixou de seguir" transforma cada import numa pequena
 * ferida. Por isso a paleta recusa o par verde/vermelho de app financeiro:
 * "entrou" é âmbar quente, "saiu" é um cinza-lilás apagado. Saída é ausência,
 * não erro. Essa é a decisão emocional central do produto.
 *
 * A base é um azul-noite dessaturado, não preto: o app é de leitura calma e
 * longa, e o preto puro com acento saturado é justamente o visual dos apps
 * predatórios do nicho.
 */

export const colors = {
  /** Fundo. Azul-noite dessaturado, quente o suficiente para não parecer clínico. */
  base: '#151824',
  surface: '#1E2233',
  surfaceRaised: '#272C40',
  border: '#343A52',

  ink: '#EDEEF4',
  inkMuted: '#9BA1B8',
  inkFaint: '#6B7290',

  /** Chegou alguém. Âmbar: presença, calor. */
  gained: '#E8A33D',
  gainedSoft: '#3A2F1C',

  /** Saiu alguém. Lilás-cinza: ausência, não alarme. Nunca use vermelho aqui. */
  lost: '#8A83A8',
  lostSoft: '#2A2739',

  /** Reservado para erro real do app (falha de import, sem conexão). */
  danger: '#D46A6A',

  /** Marca dado aproximado, nunca dado exato. Ver "precision" no core. */
  approximate: '#5D6480',
} as const;

export const typography = {
  /**
   * Display: uma grotesca condensada de peso alto. Números grandes de
   * contagem de seguidores precisam ocupar pouca largura e ter presença.
   */
  display: 'ArchivoCondensed_700Bold',
  /** Corpo: legibilidade em lista longa de @s. */
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  /** Números tabulares para colunas de estatística não dançarem. */
  mono: 'IBMPlexMono_400Regular',

  scale: {
    hero: 48,
    title: 28,
    section: 20,
    body: 16,
    caption: 13,
    micro: 11,
  },
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 } as const;

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

/**
 * Elemento-assinatura: a "trilha". Na linha do tempo, cada evento é um ponto
 * numa linha vertical contínua, e os trechos entre dois imports são desenhados
 * tracejados — porque naquele intervalo o app literalmente não sabe o que houve.
 * A incerteza vira parte do desenho em vez de nota de rodapé.
 */
export const trail = {
  strokeWidth: 2,
  knownDash: undefined,
  unknownDash: [3, 5] as const,
} as const;

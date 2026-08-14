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
 *
 * ## Sobre a semelhança com o Instagram
 *
 * A **estrutura** é deliberadamente a que o usuário já conhece: cabeçalho fixo
 * com a marca à esquerda, barra de abas embaixo, listas de pessoas com avatar
 * circular à esquerda e ação à direita. Isso é gramática de app mobile, é o que
 * dispensa o usuário de aprender qualquer coisa.
 *
 * As **cores e a marca** são nossas, e isso não é preciosismo: publicar um app
 * que imita a identidade visual do Instagram é motivo de remoção das lojas, e
 * seria estranho num produto cujo argumento é justamente não se passar por eles.
 */

export const colors = {
  /** Fundo. Azul-noite dessaturado, quente o suficiente para não parecer clínico. */
  base: '#151824',
  surface: '#1E2233',
  surfaceRaised: '#272C40',
  border: '#343A52',
  /** Divisória interna de lista — mais fraca que `border`, no espírito do iOS. */
  hairline: '#252A3C',

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

/**
 * Tipografia.
 *
 * Fonte do sistema, de propósito: San Francisco no iOS, Roboto no Android. É o
 * que todo app do mercado faz, é o que o usuário lê mais rápido por já estar
 * acostumado, e evita a tela em branco enquanto uma fonte externa carrega.
 *
 * (Antes havia aqui três famílias declaradas — Archivo, Inter, IBM Plex — que
 * nenhuma tela chegava a aplicar, porque `expo-font` nunca entrou no projeto.
 * Eram nomes sem efeito nenhum.)
 */
export const typography = {
  scale: {
    hero: 44,
    title: 26,
    section: 17,
    body: 15,
    caption: 13,
    micro: 11,
  },
  /** Pesos nomeados: o número solto no meio do estilo não diz o que pretende. */
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40, xxl: 64 } as const;

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

/**
 * Medidas do "chrome" — as duas barras fixas que emolduram todas as telas.
 *
 * 56 e 52 não são números escolhidos por gosto: são a altura de cabeçalho e de
 * barra de abas dos apps nativos das duas plataformas, e o alvo de toque mínimo
 * de 44pt da Apple cabe folgado nos dois.
 */
export const chrome = { headerHeight: 56, tabBarHeight: 52, touchMin: 44 } as const;

/**
 * Elemento-assinatura: a "trilha". Na linha do tempo, cada evento é um ponto
 * numa linha vertical contínua, e os trechos entre dois imports são desenhados
 * tracejados — porque naquele intervalo o app literalmente não sabe o que houve.
 * A incerteza vira parte do desenho em vez de nota de rodapé.
 *
 * O logo do app é esse mesmo desenho: ver components/Marca.tsx.
 */
export const trail = {
  strokeWidth: 2,
  knownDash: undefined,
  unknownDash: [3, 5] as const,
} as const;

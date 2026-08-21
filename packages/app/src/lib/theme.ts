/**
 * Tokens visuais do Rastro.
 *
 * ## Tema escuro denso (20/08/2026)
 *
 * Terceira e definitiva virada de identidade, por decisão do dono, que achou o
 * resultado claro "amador". A referência pedida foram apps que passam seriedade
 * — Spotify, Linear — e o que esses apps têm em comum não é a cor: é que o
 * **fundo não compete**. Num fundo quase preto, o número de seguidores é a coisa
 * mais clara da tela e por isso a primeira que se lê. Num fundo branco, o número
 * disputa com o próprio fundo, e a única saída é engrossar a fonte — que foi
 * exatamente o caminho que as duas versões anteriores tentaram.
 *
 * Três regras que fazem este tema funcionar, e que se quebram fácil sem perceber:
 *
 * 1. **A cor de acento é rara.** O roxo aparece em ação (botão), em identidade
 *    (anel do avatar, marca) e em "chegou alguém". Em mais lugares que isso ele
 *    deixa de significar qualquer coisa e vira papel de parede. Se você está
 *    prestes a pintar de roxo um quarto elemento na mesma tela, provavelmente é
 *    hierarquia mal resolvida, não falta de cor.
 * 2. **Profundidade vem da superfície, não da sombra.** No escuro, sombra preta
 *    sobre fundo preto é invisível. O que separa um cartão do fundo é ele ser
 *    mais **claro** — `surface` acima de `base`, `surfaceRaised` acima de
 *    `surface`. Três níveis bastam; o quarto ninguém distingue.
 * 3. **Branco puro não existe.** Texto em `#FFFFFF` sobre fundo quase preto
 *    vibra e cansa em leitura longa. `ink` é branco levemente esfriado, e é o
 *    mais claro que a tela chega.
 *
 * ## A linha que não se atravessa
 *
 * Copiar a **estrutura** é gramática de app mobile e não pertence a ninguém:
 * cabeçalho fixo com a marca à esquerda, barra de abas embaixo, listas de
 * pessoas com avatar redondo e ação à direita. Isso é o que o usuário já sabe
 * operar, e é o que copiamos.
 *
 * O que **não** se copia, e não é preciosismo: o logotipo, o nome, a fonte
 * desenhada da marca e o gradiente roxo-rosa-laranja que identifica o Instagram.
 * Publicar um app que se passa por outro é motivo de remoção das duas lojas — e
 * seria estranho num produto cujo argumento de venda é justamente não se passar
 * pelo Instagram para pedir a senha de ninguém.
 *
 * A marca continua sendo a trilha desenhada em `components/Marca.tsx`.
 *
 * ## A decisão emocional continua de pé
 *
 * O app fala sobre pessoas saindo da sua vida. Um app de seguidores que pinta
 * "deixou de seguir" de vermelho-alarme transforma cada import numa pequena
 * ferida. A paleta recusa o par verde/vermelho de app financeiro:
 *
 * - **entrou** é o roxo da marca — presença, o que está vivo na tela;
 * - **saiu** é um cinza frio e sem brilho. Ausência, não erro. Nunca vermelho.
 *
 * O vermelho existe num token só, `danger`, e é para falha do app: import que
 * não leu, rede que caiu, conta sendo apagada.
 */

export const colors = {
  /**
   * Fundo. Quase preto, puxado para o violeta.
   *
   * Não é `#000000`: preto absoluto num OLED faz a borda de cada cartão brilhar
   * por contraste e dá a impressão de interface flutuando no vazio. O fio de
   * violeta (`10` no azul contra `0B` no vermelho) é o que faz o roxo da marca
   * parecer nascer do fundo em vez de estar colado por cima.
   */
  base: '#0B0B10',
  /** Cartão. Primeiro degrau acima do fundo. */
  surface: '#14141F',
  /** Segundo degrau: botão secundário, etiqueta, bolha de número, campo. */
  surfaceRaised: '#1E1E2C',
  /** Borda visível. Precisa ser mais clara que `surface` para existir. */
  border: '#2A2A3B',
  /** Divisória interna de lista. Quase imperceptível, e é para ser. */
  hairline: '#1D1D29',

  /** Texto principal. Branco esfriado, nunca `#FFFFFF` — ver o topo do arquivo. */
  ink: '#F1F1F7',
  /** Texto de apoio: legenda, data, explicação. */
  inkMuted: '#9B9BB0',
  /** Texto terciário: placeholder, rótulo de eixo, marca-d'água. */
  inkFaint: '#6C6C82',

  /**
   * Cor de ação e de "chegou alguém".
   *
   * Mais clara que o violeta do tema anterior (`#7B2FBE`), e isso é obrigatório:
   * no escuro quem precisa de contraste é a cor contra o fundo, não o texto
   * contra a cor. Este roxo dá 5,4:1 sobre `base`, então serve como texto.
   * Para texto branco **por cima** dele, use `gradients.marca`, que é mais
   * escuro justamente para isso.
   */
  gained: '#8B5CF6',
  /** Bloco de destaque roxo sobre o escuro. Escuro o bastante para texto claro. */
  gainedSoft: '#1C1533',

  /** Saiu alguém. Cinza frio: ausência, não alarme. Nunca use vermelho aqui. */
  lost: '#818AA0',
  lostSoft: '#181820',

  /** Reservado para erro real do app (falha de import, sem conexão). */
  danger: '#F4536A',
  /** Fundo do aviso de erro. */
  dangerSoft: '#2A1219',

  /** Marca dado aproximado, nunca dado exato. Ver "precision" no core. */
  approximate: '#7A8199',
} as const;

/**
 * Gradientes.
 *
 * ## Por que existem
 *
 * Roxo chapado em botão e ícone deixa o app com cara de protótipo: uma cor
 * sólida é o padrão de quem não escolheu nada. O gradiente dá profundidade sem
 * custar contraste.
 *
 * ## Por que ele vai para o magenta, e não para o laranja
 *
 * O caminho violeta → magenta é o oposto do gradiente do Instagram, que sai do
 * roxo e termina em laranja/amarelo. A semelhança de *técnica* é proposital e
 * inofensiva; a de *identidade* é o que dá remoção de loja.
 *
 * Sempre com `start`/`end` na diagonal: horizontal puro num botão largo faz a
 * transição parecer uma emenda mal-acabada.
 */
export const gradients = {
  /**
   * Ação principal: botão, barra de progresso, ícone ativo.
   *
   * Deliberadamente mais **escuro** que `colors.gained`: aqui o texto branco fica
   * por cima, e branco sobre `#8B5CF6` daria 3,5:1 — reprovado para corpo de
   * texto. Nesta faixa o pior ponto dá 4,6:1.
   */
  marca: ['#5B21B6', '#7C3AED', '#9333EA'] as const,
  /**
   * Anel do avatar — o elemento de identidade do app.
   *
   * Vai um passo além do `marca` e encosta no coral, porque num aro de 2px o
   * olho precisa de amplitude para perceber que há gradiente ali. No escuro ele
   * também é a única fonte de luz da tela, e por isso é mais claro que o botão.
   */
  aro: ['#7C3AED', '#B02BC7', '#F0567A'] as const,
  /**
   * Fundo de cartão de destaque.
   *
   * No tema claro isto era quase branco. No escuro é o inverso: um violeta
   * profundo, escuro o bastante para o texto continuar sendo `ink`. Se clarear
   * mais que isto, o cartão passa a competir com o botão pela atenção.
   */
  suave: ['#191233', '#231430'] as const,
} as const;

/**
 * Elevação.
 *
 * Existe, mas faz pouco: no escuro o que separa camadas é a superfície ser mais
 * clara (ver regra 2 no topo), não a sombra. A sombra aqui só ancora o cartão,
 * para ele não parecer recortado e colado.
 */
export const elevation = {
  cartao: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;

/**
 * Tipografia.
 *
 * Display em Outfit, corpo na fonte do sistema.
 */
export const typography = {
  /**
   * Família de display, para títulos e números grandes.
   *
   * Outfit: geométrica, com contraforma aberta e um "a" de andar único — o
   * bastante para os títulos deixarem de parecer texto de navegador sem folha
   * de estilo. Vem em pacote, não da rede: os arquivos são empacotados no app e
   * não há tela em branco esperando download.
   *
   * **Regra ao usar:** quem passa `fontFamily` não passa `fontWeight`. O peso
   * está no nome do arquivo; combinar os dois faz o Android sintetizar um negrito
   * falso por cima de um arquivo que já é negrito, e o resultado é uma letra
   * borrada que só aparece no aparelho.
   *
   * O corpo do texto continua na fonte do sistema, de propósito: é a que a
   * pessoa lê mais rápido em 13px, por já estar acostumada, e é a que respeita a
   * configuração de acessibilidade dela.
   */
  display: {
    medium: 'Outfit_500Medium',
    semibold: 'Outfit_600SemiBold',
    bold: 'Outfit_700Bold',
  },
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

/**
 * Títulos prontos: família, corpo e espaçamento entre letras num lugar só.
 *
 * O tracking negativo cresce com o tamanho, que é como toda tipografia de
 * display funciona — letras grandes com espaçamento normal parecem soltas. Em
 * `section`, que é quase corpo de texto, ele quase desaparece.
 */
export const heading = {
  hero: {
    fontFamily: typography.display.bold,
    fontSize: typography.scale.hero,
    letterSpacing: -1.6,
  },
  title: {
    fontFamily: typography.display.bold,
    fontSize: typography.scale.title,
    letterSpacing: -0.7,
  },
  section: {
    fontFamily: typography.display.semibold,
    fontSize: typography.scale.section,
    letterSpacing: -0.2,
  },
  /** Número grande de painel: mesma família, tabular pela forma da Outfit. */
  numero: {
    fontFamily: typography.display.bold,
    fontSize: typography.scale.title,
    letterSpacing: -0.8,
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
 * Largura máxima do conteúdo.
 *
 * Existe para o navegador. Num monitor, sem ela, uma linha de pessoa fica com o
 * @ na borda esquerda e o ícone de link a mil pixels de distância. Em celular a
 * tela é sempre mais estreita que isto, então lá não muda nada.
 */
export const layout = { maxWidth: 560 } as const;

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

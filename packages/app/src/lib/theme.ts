/**
 * Tokens visuais do Rastro.
 *
 * ## Tema claro, roxo (19/08/2026)
 *
 * O app nasceu escuro, com azul-noite e âmbar. Foi trocado por decisão do dono:
 * fundo branco e roxo, no vocabulário visual que a pessoa já usa o dia inteiro.
 * O argumento é de conversão, não de gosto — quem instala este app vem do
 * Instagram e volta para ele; quanto menos a interface parecer um lugar novo,
 * menos ela cobra atenção para ser entendida.
 *
 * ### A linha que não se atravessa
 *
 * Copiar a **estrutura** é gramática de app mobile e não pertence a ninguém:
 * cabeçalho fixo com a marca à esquerda, barra de abas embaixo, listas de
 * pessoas com avatar redondo e ação à direita, fundo branco, tipografia do
 * sistema. Isso é o que o usuário já sabe operar, e é o que copiamos.
 *
 * O que **não** se copia, e não é preciosismo: o logotipo, o nome, a fonte
 * desenhada da marca e o gradiente roxo-rosa-laranja que identifica o Instagram.
 * Publicar um app que se passa por outro é motivo de remoção das duas lojas — e
 * seria estranho num produto cujo argumento de venda é justamente não se passar
 * pelo Instagram para pedir a senha de ninguém.
 *
 * Por isso o roxo daqui é um violeta próprio, chapado, e a marca continua sendo
 * a trilha desenhada em `components/Marca.tsx`.
 *
 * ## A decisão emocional continua de pé
 *
 * O app fala sobre pessoas saindo da sua vida. Um app de seguidores que pinta
 * "deixou de seguir" de vermelho-alarme transforma cada import numa pequena
 * ferida. A paleta recusa o par verde/vermelho de app financeiro:
 *
 * - **entrou** é o roxo da marca, a mesma cor das ações — presença, o que está
 *   vivo na tela;
 * - **saiu** é um cinza frio e sem brilho. Ausência, não erro. Nunca vermelho.
 *
 * O vermelho existe num token só, `danger`, e é para falha do app: import que
 * não leu, rede que caiu, conta sendo apagada.
 */

export const colors = {
  /**
   * Fundo. Branco com um fio de lilás, não branco de papel.
   *
   * A diferença para `#FFFFFF` é de dois pontos de saturação e ninguém a nomeia
   * olhando — mas branco puro numa tela inteira lê como página não estilizada,
   * e é essa a sensação que o off-white tira. O mesmo desvio percorre `surface`
   * e `border`, para as camadas pertencerem à mesma família em vez de parecerem
   * cinzas emprestados.
   */
  base: '#FCFBFE',
  /** Cartão e bloco de destaque. */
  surface: '#F5F3FA',
  /** Uma camada acima do cartão: botão secundário, etiqueta, bolha de número. */
  surfaceRaised: '#EBE7F5',
  /** Borda visível — a mesma função da linha de contorno dos cartões do feed. */
  border: '#E3DEF0',
  /** Divisória interna de lista. Mais fraca que `border`, no espírito do iOS. */
  hairline: '#EFEBF7',

  ink: '#14151F',
  inkMuted: '#5E6474',
  inkFaint: '#7C8293',

  /**
   * Cor de ação e de "chegou alguém".
   *
   * Violeta próprio: escuro o suficiente para texto branco por cima passar em
   * contraste (7:1), e saturado o suficiente para não parecer cinza-azulado
   * numa tela de celular no sol.
   */
  gained: '#7B2FBE',
  /** Fundo do mesmo roxo, para bloco de destaque sobre branco. */
  gainedSoft: '#F3EAFC',

  /** Saiu alguém. Cinza frio: ausência, não alarme. Nunca use vermelho aqui. */
  lost: '#6E7482',
  lostSoft: '#F0F1F4',

  /** Reservado para erro real do app (falha de import, sem conexão). */
  danger: '#C62B3A',

  /** Marca dado aproximado, nunca dado exato. Ver "precision" no core. */
  approximate: '#79809A',
} as const;

/**
 * Gradientes.
 *
 * ## Por que existem
 *
 * Roxo chapado em botão, cabeçalho e ícone deixa o app com cara de protótipo:
 * uma cor sólida é o padrão de quem não escolheu nada. O gradiente é o que dá
 * profundidade sem custar contraste — o texto branco continua legível porque as
 * duas pontas são escuras o bastante.
 *
 * ## Por que ele vai para o magenta, e não para o laranja
 *
 * O caminho violeta → magenta é o oposto do gradiente do Instagram, que sai do
 * roxo e termina em laranja/amarelo. A semelhança de *técnica* é proposital e
 * inofensiva; a de *identidade* é o que dá remoção de loja. Ver a nota sobre a
 * linha que não se atravessa, no topo deste arquivo.
 *
 * Sempre com `start`/`end` na diagonal: horizontal puro num botão largo faz a
 * transição parecer uma emenda mal-acabada.
 */
export const gradients = {
  /** Ação principal: botão, barra de progresso, ícone ativo. */
  marca: ['#6D28D9', '#8B2FC9', '#B02BC7'] as const,
  /**
   * Anel do avatar — o elemento que quebra o branco onde o app é mais vazio.
   *
   * Vai um passo além do `marca` e encosta no coral, porque num aro de 2px o
   * olho precisa de amplitude para perceber que há gradiente ali.
   */
  aro: ['#6D28D9', '#B02BC7', '#F0567A'] as const,
  /** Fundo de cartão de destaque. Quase branco, só o suficiente para ter cor. */
  suave: ['#F6EEFF', '#FDF1F7'] as const,
} as const;

/**
 * Elevação.
 *
 * Sombra curta e muito clara, tingida de roxo em vez de preta: sombra preta
 * sobre off-white lilás vira uma mancha cinza que suja a cor do fundo.
 */
export const elevation = {
  cartao: {
    shadowColor: '#4B2A7B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
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
  /**
   * Família de display, para títulos e números grandes.
   *
   * Outfit: geométrica, com contraforma aberta e um "a" de andar único — o
   * bastante para os títulos deixarem de parecer texto de navegador sem folha
   * de estilo, que era a queixa. Vem em pacote, não da rede: os arquivos são
   * empacotados no app e não há tela em branco esperando download.
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

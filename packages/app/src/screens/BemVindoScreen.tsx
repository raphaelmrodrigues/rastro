/**
 * Boas-vindas: quatro telas antes da primeira importação.
 *
 * ## Por que isto existe
 *
 * A tela de importar carregava sozinha o trabalho inteiro de apresentar o
 * produto: o que o app faz, por que não pede senha, como pedir o arquivo, por
 * que o resultado só aparece no segundo arquivo — tudo numa página só, e a
 * pessoa caía nela no primeiro segundo de uso. Era muito texto num momento em
 * que ela ainda não tinha motivo para ler nenhum.
 *
 * Aqui a mesma informação vem em quatro passos, uma ideia por tela, com um
 * botão só. A pessoa avança no ritmo dela e chega na importação já sabendo o
 * que vai fazer — e, mais importante, já tendo lido a única frase que precisa
 * ficar: aqui ninguém pede a senha do Instagram.
 *
 * ## A ordem dos slides não é arbitrária
 *
 * 1. **O que o app faz.** Sem isso, nada mais importa.
 * 2. **A senha.** Vem em segundo, e não no fim, porque a pessoa chega vinda de
 *    apps que pediram a senha do Instagram dela. Se essa dúvida não morre cedo,
 *    ela lê o resto desconfiada.
 * 3. **A espera.** Na prática o arquivo chega em poucos minutos, porque o app
 *    manda pedir só a lista de seguidores. O teto de 48h que o Instagram publica
 *    vale para quem pede o export inteiro, com anos de fotos e vídeo — dizer
 *    "até 48 horas" para todo mundo assusta na hora errada e faz desistir gente
 *    que teria o arquivo antes de largar o celular. Ele fica na letra miúda,
 *    porque quem cair no caso raro precisa saber que é normal.
 * 4. **O segundo arquivo.** É a expectativa que mais frustra: a pessoa importa,
 *    não vê "quem saiu", e conclui que o app não funciona.
 *
 * ## Sobre a animação
 *
 * Os slides rolam na horizontal, com gesto e com botão — os dois, porque metade
 * das pessoas arrasta e a outra metade procura o botão. A transição usa
 * `useNativeDriver`, então roda na thread de UI e não engasga junto com o
 * JavaScript. Só opacidade e transformação são animadas, que são as duas
 * propriedades que o driver nativo aceita.
 */

import { useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Gradiente } from '../components/ui';
import { colors, gradients, heading, layout, radius, space, typography } from '../lib/theme';

/** Quanto o `scrollTo` animado leva. Não é configurável no React Native — este
 *  é o valor observado, e serve só para liberar o botão depois da transição. */
const DURACAO_DA_ROLAGEM_MS = 320;

/**
 * Se o salto do botão é animado.
 *
 * No navegador, não — e isso é limitação do Chrome, não escolha. O
 * `pagingEnabled` do react-native-web vira `scroll-snap-type: x mandatory` no
 * CSS, e um contêiner com snap obrigatório **descarta** rolagem programática
 * suave: `scrollTo({behavior:'smooth'})` simplesmente não sai do lugar, enquanto
 * o salto instantâneo funciona. Medido aqui em 19/08/2026, com o carrossel
 * parado no primeiro slide por mais tempo do que gostaria de admitir.
 *
 * No aparelho — que é onde o app existe — `pagingEnabled` é nativo, não tem
 * nada a ver com CSS, e a animação roda normalmente. Arrastar com o dedo é
 * animado nas duas plataformas de qualquer jeito: ali quem move é o usuário.
 */
const ANIMA_A_ROLAGEM = Platform.OS !== 'web';

interface Props {
  /** Chamado ao terminar ou pular. Leva para a tela de importar. */
  aoConcluir: () => void;
}

interface Slide {
  chave: string;
  titulo: string;
  corpo: string;
  /** Frase curta em destaque, quando há uma que precisa sobreviver sozinha. */
  destaque?: string;
  /** Letra miúda: a ressalva que precisa existir sem roubar a cena. */
  nota?: string;
  Arte: () => React.ReactElement;
}

const SLIDES: Slide[] = [
  {
    chave: 'oque',
    titulo: 'Veja quem saiu da sua lista',
    corpo:
      'O Instagram não avisa quando alguém para de te seguir. O Rastro guarda sua lista de ' +
      'seguidores e compara ao longo do tempo — quem entrou, quem saiu, quem nunca te seguiu de volta.',
    Arte: ArteTrilha,
  },
  {
    chave: 'senha',
    titulo: 'Sua senha do Instagram fica com você',
    destaque: 'Nunca pedimos a senha do seu Instagram.',
    corpo:
      'Aqui não existe campo para ela. O Rastro lê o arquivo de dados que o próprio Instagram ' +
      'entrega a você quando você pede. É por isso que sua conta não corre risco de bloqueio.',
    Arte: ArteEscudo,
  },
  {
    chave: 'arquivo',
    titulo: 'O arquivo chega em poucos minutos',
    destaque: 'São alguns toques dentro do Instagram, e o app mostra o caminho.',
    corpo:
      'Como o Rastro pede só a sua lista de seguidores, e não o histórico inteiro da conta, ' +
      'o Instagram costuma mandar o arquivo em questão de minutos. Você não precisa deixar ' +
      'nada aberto esperando: ele avisa por e-mail.',
    nota:
      'Em casos raros, de contas muito antigas, o Instagram pode levar mais tempo — o prazo ' +
      'máximo que ele publica é de 48 horas.',
    Arte: ArteArquivo,
  },
  {
    chave: 'segundo',
    titulo: 'O resultado aparece no segundo arquivo',
    corpo:
      'O primeiro é o ponto de partida: ele mostra sua rede de hoje. É comparando com o próximo ' +
      'que o Rastro descobre o que mudou. Quanto mais seguido você atualiza, mais preciso fica.',
    Arte: ArteComparacao,
  },
];

export function BemVindoScreen({ aoConcluir }: Props) {
  /*
   * A largura vem de duas fontes, e as duas são necessárias.
   *
   * O `onLayout` é o valor certo — mede a moldura de verdade, já descontada a
   * área segura. Mas ele não é garantido no primeiro quadro: o
   * `SafeAreaProvider` só entrega os filhos depois de medir os insets, e no
   * navegador houve renders em que o evento não chegou. Quando isso acontecia,
   * `largura` ficava em zero, os slides nasciam com largura zero e a tela abria
   * com o botão sozinho no meio do branco — que é pior do que qualquer erro,
   * porque não parece defeito, parece o app.
   *
   * A dimensão da janela é o piso: sempre existe, no primeiro quadro, e erra no
   * máximo pela largura da área segura lateral — desvio que o `onLayout`
   * corrige assim que chega.
   */
  const janela = useWindowDimensions();
  const [medida, setMedida] = useState(0);
  const largura = medida || Math.min(janela.width, layout.maxWidth);
  const [indice, setIndice] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scroller = useRef<ScrollView>(null);
  /*
   * Slide de destino, num ref e não no estado.
   *
   * Dois toques rápidos no "Continuar" chegavam antes de o React recomeçar o
   * render, e o segundo `scrollTo` era calculado sobre o índice velho — o
   * carrossel parava entre duas páginas, com metade de cada uma na tela.
   * O ref é atualizado no mesmo instante do toque, sem esperar render nenhum.
   */
  const alvo = useRef(0);
  /*
   * Trava enquanto o carrossel desliza.
   *
   * Um segundo toque no meio da animação disparava um `scrollTo` novo por cima
   * do anterior, e o resultado era o carrossel parar entre dois slides — no
   * navegador de forma permanente, porque nada ali faz o encaixe sozinho. São
   * ~300ms de espera, invisíveis para quem toca uma vez.
   */
  const rolando = useRef(false);

  const ultimo = indice === SLIDES.length - 1;

  const medir = (e: LayoutChangeEvent) => setMedida(e.nativeEvent.layout.width);

  const aoRolar = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: true,
  });

  /*
   * O índice sai do fim do movimento, não de cada quadro: atualizá-lo durante a
   * rolagem trocaria o rótulo do botão no meio do arrasto, que é o tipo de
   * detalhe que faz uma tela parecer instável.
   */
  const aoParar = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (largura <= 0) return;
    const onde = Math.round(e.nativeEvent.contentOffset.x / largura);
    alvo.current = onde;
    setIndice(onde);
  };

  const irPara = (destino: number) => {
    if (rolando.current) return;
    const i = Math.max(0, Math.min(destino, SLIDES.length - 1));
    alvo.current = i;
    rolando.current = true;
    setTimeout(() => {
      rolando.current = false;
    }, DURACAO_DA_ROLAGEM_MS);
    // Otimista de propósito: esperar o `onMomentumScrollEnd` deixaria o botão
    // com o rótulo antigo durante a animação inteira.
    setIndice(i);
    scroller.current?.scrollTo({ x: i * largura, animated: ANIMA_A_ROLAGEM });
  };

  const avancar = () => {
    if (ultimo) aoConcluir();
    else irPara(alvo.current + 1);
  };

  return (
    <View style={s.raiz} onLayout={medir}>
      <View style={s.topo}>
        <Pressable
          onPress={aoConcluir}
          accessibilityRole="button"
          hitSlop={12}
          style={({ pressed }) => pressed && s.pressed}
        >
          <Text style={s.pular}>{ultimo ? '' : 'Pular'}</Text>
        </Pressable>
      </View>

      <Animated.ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={aoRolar}
        onMomentumScrollEnd={aoParar}
        onScrollEndDrag={aoParar}
        scrollEventThrottle={16}
        style={s.trilho}
      >
        {SLIDES.map((slide, i) => (
          <SlideView key={slide.chave} slide={slide} indice={i} largura={largura} x={scrollX} />
        ))}
      </Animated.ScrollView>

      <View style={s.rodape}>
        <View style={s.pontos}>
          {SLIDES.map((slide, i) => (
            <Ponto key={slide.chave} indice={i} largura={largura} x={scrollX} />
          ))}
        </View>

        <Pressable
          onPress={avancar}
          accessibilityRole="button"
          style={({ pressed }) => [s.botaoFora, pressed && s.pressed]}
        >
          <Gradiente style={s.botao}>
            <Text style={s.botaoRotulo}>{ultimo ? 'Começar' : 'Continuar'}</Text>
          </Gradiente>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Um slide.
 *
 * A arte e o texto se movem em velocidades diferentes da rolagem — a arte mais
 * devagar, o texto mais rápido. É paralaxe, e o efeito prático é que cada tela
 * parece um lugar próprio em vez de uma faixa contínua deslizando.
 */
function SlideView({
  slide,
  indice,
  largura,
  x,
}: {
  slide: Slide;
  indice: number;
  largura: number;
  x: Animated.Value;
}) {
  const faixa = [(indice - 1) * largura, indice * largura, (indice + 1) * largura];

  const opacidade = x.interpolate({
    inputRange: faixa,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });
  const arteX = x.interpolate({
    inputRange: faixa,
    outputRange: [largura * 0.35, 0, -largura * 0.35],
    extrapolate: 'clamp',
  });
  const escala = x.interpolate({
    inputRange: faixa,
    outputRange: [0.82, 1, 0.82],
    extrapolate: 'clamp',
  });
  const textoY = x.interpolate({
    inputRange: faixa,
    outputRange: [28, 0, 28],
    extrapolate: 'clamp',
  });

  const { Arte } = slide;

  return (
    <View style={[s.slide, { width: largura }]}>
      <Animated.View
        style={[
          s.arte,
          {
            opacity: opacidade,
            transform: [{ translateX: arteX }, { scale: escala }],
          },
        ]}
      >
        {/*
         * Halo atrás da ilustração.
         *
         * Estas quatro telas são as mais vazias do app — uma figura pequena no
         * meio de muito branco. O disco de gradiente dá fundo à ilustração e
         * ancora o olho sem competir com ela: é quase branco, e só se percebe
         * como cor quando se olha para o conjunto.
         */}
        <Gradiente cores={gradients.suave} style={s.halo}>
          <Arte />
        </Gradiente>
      </Animated.View>

      <Animated.View style={[s.texto, { opacity: opacidade, transform: [{ translateY: textoY }] }]}>
        <Text style={s.titulo}>{slide.titulo}</Text>
        {slide.destaque ? <Text style={s.destaque}>{slide.destaque}</Text> : null}
        <Text style={s.corpo}>{slide.corpo}</Text>
        {slide.nota ? <Text style={s.nota}>{slide.nota}</Text> : null}
      </Animated.View>
    </View>
  );
}

/**
 * Indicador de página.
 *
 * Cresce em `scaleX` e não em `width`: largura não é animável pelo driver
 * nativo, e cair para o driver de JavaScript aqui faria os pontos engasgarem
 * exatamente durante a rolagem, que é o único momento em que alguém os olha.
 */
function Ponto({ indice, largura, x }: { indice: number; largura: number; x: Animated.Value }) {
  // Antes da primeira medição a largura é zero, e uma faixa [0, 0, 0] faz a
  // interpolação dividir por zero e devolver NaN — o ponto some da tela.
  const w = largura || 1;
  const faixa = [(indice - 1) * w, indice * w, (indice + 1) * w];

  const escala = x.interpolate({
    inputRange: faixa,
    outputRange: [1, 2.6, 1],
    extrapolate: 'clamp',
  });
  const opacidade = x.interpolate({
    inputRange: faixa,
    outputRange: [0.3, 1, 0.3],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View style={[s.ponto, { opacity: opacidade, transform: [{ scaleX: escala }] }]} />
  );
}

/* ---------------------------------------------------------------------------
 * As artes.
 *
 * Traço em vez de ilustração cheia, pelo mesmo motivo da marca (ver Marca.tsx):
 * a linguagem do produto é a trilha, e um desenho colorido de gente sorrindo
 * seria o visual dos apps do nicho que este aqui existe para não parecer.
 * ------------------------------------------------------------------------- */

const ARTE = 200;

/** Slide 1: a trilha da marca, em tamanho de ilustração. */
function ArteTrilha() {
  return (
    <Svg width={ARTE} height={ARTE} viewBox="0 0 120 120" fill="none">
      <Path
        d="M12 96 L38 78 L60 86"
        stroke={colors.inkFaint}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M68 74 L98 30"
        stroke={colors.gained}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="5 7"
      />
      <Circle cx={12} cy={96} r={5} fill={colors.inkFaint} />
      <Circle cx={38} cy={78} r={5} fill={colors.inkFaint} />
      <Circle cx={60} cy={86} r={6} fill={colors.inkMuted} />
      <Circle cx={104} cy={22} r={10} fill={colors.gainedSoft} />
      <Circle cx={104} cy={22} r={5.5} fill={colors.gained} />
      {/*
       * Quem saiu: pontos fora da linha, sem brilho. Ausência, não alarme.
       *
       * A opacidade era 0.55 e 0.35, herdada do tema escuro, onde um cinza
       * translúcido ainda se destaca do fundo azul-noite. Sobre branco eles
       * praticamente sumiam — e o slide que fala de quem saiu ficava sem
       * mostrar ninguém saindo.
       */}
      <Circle cx={80} cy={92} r={4.5} fill={colors.lost} opacity={0.85} />
      <Circle cx={97} cy={100} r={3} fill={colors.lost} opacity={0.6} />
    </Svg>
  );
}

/** Slide 2: escudo com a trilha dentro — a promessa e a marca no mesmo desenho. */
function ArteEscudo() {
  return (
    <Svg width={ARTE} height={ARTE} viewBox="0 0 120 120" fill="none">
      <Path
        d="M60 14 L100 30 V60 C100 84 82 100 60 108 C38 100 20 84 20 60 V30 Z"
        fill={colors.gainedSoft}
        stroke={colors.gained}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Path
        d="M40 70 L54 60 L66 65"
        stroke={colors.inkMuted}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M73 58 L84 44"
        stroke={colors.gained}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="4 5"
      />
      <Circle cx={40} cy={70} r={4} fill={colors.inkMuted} />
      <Circle cx={66} cy={65} r={4} fill={colors.inkMuted} />
      <Circle cx={87} cy={40} r={5} fill={colors.gained} />
    </Svg>
  );
}

/** Slide 3: o arquivo saindo do Instagram, e o relógio da espera. */
function ArteArquivo() {
  return (
    <Svg width={ARTE} height={ARTE} viewBox="0 0 120 120" fill="none">
      <Rect
        x={10}
        y={38}
        width={42}
        height={50}
        rx={8}
        fill={colors.surface}
        stroke={colors.border}
        strokeWidth={2.5}
      />
      <Path
        d="M20 54 H42 M20 63 H42 M20 72 H34"
        stroke={colors.inkFaint}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {/* A travessia. Tracejada, porque ela demora — e o tracejado é a marca. */}
      <Path
        d="M60 63 H84"
        stroke={colors.gained}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="4 6"
      />
      <Path
        d="M84 56 L92 63 L84 70"
        stroke={colors.gained}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* O relógio da espera de até 48h. Acima da linha, sem disputar com ela. */}
      <Circle
        cx={76}
        cy={30}
        r={14}
        fill={colors.surface}
        stroke={colors.inkFaint}
        strokeWidth={2.5}
      />
      <Path
        d="M76 22 V30 L82 34"
        stroke={colors.inkMuted}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Slide 4: dois arquivos lado a lado, e a diferença entre eles. */
function ArteComparacao() {
  return (
    <Svg width={ARTE} height={ARTE} viewBox="0 0 120 120" fill="none">
      {/* Primeiro arquivo: o ponto de partida, em cinza. */}
      <Rect
        x={6}
        y={28}
        width={40}
        height={48}
        rx={8}
        fill={colors.surface}
        stroke={colors.border}
        strokeWidth={2.5}
      />
      <Circle cx={19} cy={43} r={4} fill={colors.inkFaint} />
      <Circle cx={33} cy={43} r={4} fill={colors.inkFaint} />
      <Circle cx={19} cy={60} r={4} fill={colors.inkFaint} />
      <Circle cx={33} cy={60} r={4} fill={colors.lost} />

      <Path
        d="M52 52 H62"
        stroke={colors.inkFaint}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="3 4"
      />
      <Path
        d="M62 46 L68 52 L62 58"
        stroke={colors.inkFaint}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Segundo arquivo: o de agora. Borda âmbar, como o ponto vivo da marca. */}
      <Rect
        x={74}
        y={28}
        width={40}
        height={48}
        rx={8}
        fill={colors.surface}
        stroke={colors.gained}
        strokeWidth={2.5}
      />
      <Circle cx={87} cy={43} r={4} fill={colors.inkFaint} />
      <Circle cx={101} cy={43} r={4} fill={colors.inkFaint} />
      <Circle cx={87} cy={60} r={4} fill={colors.inkFaint} />
      <Circle cx={101} cy={60} r={4} fill={colors.gained} />

      {/*
       * O resultado da comparação, embaixo: um entrou, um saiu.
       *
       * Sinal em vez de texto: fonte dentro de SVG renderiza diferente em cada
       * plataforma, e duas linhas cruzadas dizem a mesma coisa em qualquer uma.
       */}
      <Circle cx={44} cy={98} r={11} fill={colors.gainedSoft} />
      <Path
        d="M44 92 V104 M38 98 H50"
        stroke={colors.gained}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <Circle cx={76} cy={98} r={11} fill={colors.lostSoft} />
      <Path d="M70 98 H82" stroke={colors.lost} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.base },
  pressed: { opacity: 0.55 },

  topo: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
  },
  pular: {
    color: colors.inkFaint,
    fontSize: typography.scale.caption,
    fontWeight: typography.weight.medium,
    // Altura fixa mesmo com o texto vazio no último slide: sem isso o conteúdo
    // inteiro sobe 20px quando o "Pular" some, e a tela dá um solavanco.
    minHeight: 18,
  },

  trilho: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  arte: { marginBottom: space.xl },
  halo: {
    width: ARTE + space.xl * 2,
    height: ARTE + space.xl * 2,
    borderRadius: (ARTE + space.xl * 2) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { alignItems: 'center', gap: space.sm, maxWidth: 340 },

  titulo: {
    color: colors.ink,
    ...heading.title,
    textAlign: 'center',
    lineHeight: 32,
  },
  destaque: {
    color: colors.gained,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
    textAlign: 'center',
  },
  corpo: {
    color: colors.inkMuted,
    fontSize: typography.scale.body,
    textAlign: 'center',
    lineHeight: 23,
  },
  nota: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: space.xs,
  },

  rodape: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.lg,
  },
  pontos: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
  },
  ponto: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.gained,
  },

  botaoFora: { borderRadius: radius.md, overflow: 'hidden' },
  botao: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  botaoRotulo: {
    color: colors.base,
    fontFamily: typography.display.semibold,
    fontSize: typography.scale.body,
  },
});

/**
 * Ícones da interface.
 *
 * Desenhados aqui em vez de vir de `@expo/vector-icons` por dois motivos: aquele
 * pacote traz famílias inteiras de fontes (megabytes) para usar seis glifos, e
 * as famílias dele não combinam entre si — misturar Material com Ionicons num
 * mesmo app é o detalhe que faz uma interface parecer montada às pressas.
 *
 * Todos seguem a mesma gramática: traço de 1.8, pontas arredondadas, grade de
 * 24. É o que dá a eles o ar de uma família só.
 *
 * O estado ativo engrossa o traço em vez de preencher a forma. Preencher exigiria
 * dois desenhos por ícone e o dobro de chance de eles divergirem.
 */

import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../lib/theme';

interface IconeProps {
  size?: number;
  cor?: string;
  ativo?: boolean;
}

function traco(ativo?: boolean): number {
  return ativo ? 2.4 : 1.8;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
});

/** Início: a casa, universal o bastante para não precisar de rótulo. */
export function IconeInicio({ size = 24, cor = colors.ink, ativo }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3.5 10.2 12 3.5l8.5 6.7V20a1 1 0 0 1-1 1h-4.2v-6.1H8.7V21H4.5a1 1 0 0 1-1-1z"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Pessoas: duas silhuetas. É a tela de listas (quem saiu, quem entrou…). */
export function IconePessoas({ size = 24, cor = colors.ink, ativo }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={9} cy={8} r={3.4} stroke={cor} strokeWidth={traco(ativo)} />
      <Path
        d="M3 20c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinecap="round"
      />
      <Path
        d="M16.2 5.2a3.4 3.4 0 0 1 0 6.4M17.5 14.4c2.1.6 3.5 2.2 3.5 4.3"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinecap="round"
        opacity={0.75}
      />
    </Svg>
  );
}

/**
 * Importar: seta entrando numa caixa.
 *
 * Fica no meio da barra, que é a posição do gesto principal nos apps mobile —
 * o alcance natural do polegar. No Rastro o gesto principal é trazer um arquivo
 * novo, então é ele que ocupa esse lugar.
 */
export function IconeImportar({ size = 24, cor = colors.ink, ativo }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M12 3.5v10.5m0 0 3.6-3.6M12 14l-3.6-3.6"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Evolução: a trilha da marca, deitada. Liga a tela à identidade do app. */
export function IconeEvolucao({ size = 24, cor = colors.ink, ativo }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3.5 18.5 8.5 14l4 2.2"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12.5 16.2 20.5 6"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinecap="round"
        strokeDasharray="2.5 3.5"
      />
      <Circle cx={20.5} cy={6} r={2.2} fill={cor} />
    </Svg>
  );
}

/** Perfil: contorno de pessoa. Leva à conta e às configurações. */
export function IconePerfil({ size = 24, cor = colors.ink, ativo }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={12} cy={8} r={3.8} stroke={cor} strokeWidth={traco(ativo)} />
      <Path
        d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"
        stroke={cor}
        strokeWidth={traco(ativo)}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Voltar. Uma seta, no ângulo do chevron de iOS. */
export function IconeVoltar({ size = 24, cor = colors.ink }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M14.5 5 8 12l6.5 7"
        stroke={cor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Busca. */
export function IconeBusca({ size = 20, cor = colors.inkFaint }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={cor} strokeWidth={1.8} />
      <Path d="m15.5 15.5 4 4" stroke={cor} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Link externo: marca que a linha abre o Instagram, fora do app. */
export function IconeExterno({ size = 16, cor = colors.inkFaint }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M9 5H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 19h11a1.5 1.5 0 0 0 1.5-1.5v-3"
        stroke={cor}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path d="M13 4.5h6.5V11M19 5l-8 8" stroke={cor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Chevron à direita: "esta linha leva a outra tela". */
export function IconeAvancar({ size = 18, cor = colors.inkFaint }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Path d="m9.5 5 7 7-7 7" stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Escudo: acompanha a promessa de que não pedimos a senha do Instagram. */
export function IconeEscudo({ size = 22, cor = colors.gained }: IconeProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M12 3.2 5 6v5.5c0 4.2 2.9 7.6 7 9.3 4.1-1.7 7-5.1 7-9.3V6z"
        stroke={cor}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="m8.8 12 2.2 2.2 4.2-4.4" stroke={cor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

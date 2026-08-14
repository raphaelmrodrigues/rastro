/**
 * A marca do Rastro.
 *
 * ## O conceito
 *
 * O símbolo é a "trilha" descrita em lib/theme.ts, que é a ideia central do
 * produto desenhada: uma linha que sobe da esquerda para a direita, com pontos
 * marcando os momentos que o app conhece — os imports. Entre o penúltimo e o
 * último ponto a linha vira **tracejada**, porque é exatamente ali que mora a
 * honestidade do Rastro: naquele intervalo o app sabe que alguém saiu, mas não
 * sabe o dia. O produto inteiro cabe nesse tracejado.
 *
 * O ponto final é âmbar e cheio — o import de agora, a única coisa que o app
 * sabe com certeza. Os anteriores são apagados, como memória.
 *
 * Isso também resolve o problema de marca do nicho: os concorrentes usam
 * olho, lupa e coração — vocabulário de vigilância, que é justamente o que este
 * app não faz. Uma trilha fala de percurso e de tempo, não de espionagem.
 *
 * ## Por que SVG e não um arquivo de imagem
 *
 * A marca aparece em cinco tamanhos diferentes no app, do cabeçalho de 20px à
 * tela de entrada. Em SVG ela é nítida em todos, muda de cor por prop e não
 * custa um único byte de download. O PNG existe só onde o sistema operacional
 * exige um: o ícone da loja e do launcher (ver scripts/gerar-icones.mjs).
 */

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, typography } from '../lib/theme';

/**
 * O símbolo sozinho, sem o nome. Use no cabeçalho, no avatar e onde o espaço é
 * quadrado.
 *
 * A viewBox é 32x32 e o desenho respira 3px nas bordas: assim o símbolo pode ser
 * recortado num círculo (avatar) sem encostar na borda.
 */
export function Simbolo({ size = 28, cor = colors.gained }: { size?: number; cor?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Trecho conhecido: linha contínua ligando os três primeiros pontos. */}
      <Path
        d="M4 26 L11 21 L17 23"
        stroke={colors.inkFaint}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/*
       * Trecho desconhecido: o intervalo entre o último arquivo e agora.
       *
       * As pontas param antes dos dois círculos, em vez de nascer dentro deles.
       * Coladas, o primeiro traço virava um cotoco que lia como falha de
       * desenho — e o conjunto ficava parecido com uma lupa, que é exatamente o
       * vocabulário de vigilância que esta marca evita.
       */}
      <Path
        d="M19.3 19.7 L25.2 11.1"
        stroke={cor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="2.2 2.4"
        opacity={0.8}
      />
      <Circle cx={4} cy={26} r={2} fill={colors.inkFaint} />
      <Circle cx={11} cy={21} r={2} fill={colors.inkFaint} />
      <Circle cx={17} cy={23} r={2.5} fill={colors.inkMuted} />
      {/* Agora. O único ponto que o app conhece com certeza. */}
      <Circle cx={28} cy={7} r={3.5} fill={cor} />
    </Svg>
  );
}

/**
 * Marca completa: símbolo + nome.
 *
 * O nome usa espaçamento entre letras negativo e peso alto — a mesma receita dos
 * logotipos de app atuais, que precisam funcionar a 18px numa barra de status.
 */
export function Logotipo({
  size = 'medio',
  cor = colors.gained,
}: {
  size?: 'pequeno' | 'medio' | 'grande';
  cor?: string;
}) {
  const dims = {
    pequeno: { simbolo: 22, texto: 19 },
    medio: { simbolo: 30, texto: 26 },
    grande: { simbolo: 52, texto: 44 },
  }[size];

  return (
    <View style={s.linha}>
      <Simbolo size={dims.simbolo} cor={cor} />
      <Text style={[s.nome, { fontSize: dims.texto }]}>Rastro</Text>
    </View>
  );
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nome: {
    color: colors.ink,
    fontWeight: typography.weight.bold,
    letterSpacing: -0.8,
  },
});

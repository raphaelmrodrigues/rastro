/**
 * Aba Importar — como conseguir o arquivo e enviá-lo.
 *
 * Esta é a tela mais importante do produto inteiro. A fricção de pedir o arquivo
 * no Instagram e esperar até 48h é o principal motivo de abandono. Cada palavra
 * aqui existe para reduzir dúvida.
 *
 * Duas instruções carregam destaque visual porque são as que, se erradas,
 * estragam o resultado sem o usuário perceber:
 *
 * 1. "Marque só Seguidores e seguindo" — sem isso o arquivo vem com fotos e
 *    conversas, passa de 100 MB e demora horas a mais para ficar pronto.
 *
 * 2. "Todo o período" — é o passo que mais gente erra. Um arquivo de 12 meses
 *    não traz a lista completa de seguidores, só quem entrou dentro da janela.
 *    Comparar um desses com um completo faz o app acusar centenas de saídas que
 *    nunca aconteceram.
 *
 * O texto foi reescrito para falar do que o usuário vê e faz. A versão anterior
 * explicava por que a data de saída é aproximada e o que acontece com o arquivo
 * dentro do app — informação verdadeira, mas que ninguém lê antes de ter o
 * resultado na mão. Ela vive agora no rodapé do painel, junto do resultado.
 */

import { ScrollView, Text, View, StyleSheet, Pressable, Linking } from 'react-native';
import { IconeEscudo } from '../components/icons';
import { colors, space, typography, radius } from '../lib/theme';

const PASSOS = [
  {
    title: 'Abra a Central de Contas',
    body: 'No Instagram: seu perfil → menu (☰) → Configurações e privacidade → Central de Contas.',
  },
  {
    title: 'Toque em "Suas informações e permissões"',
    body: 'Depois em "Baixar suas informações" e em "Solicitar um download".',
  },
  {
    title: 'Marque só "Seguidores e seguindo"',
    body: 'Escolha "Algumas das suas informações" e selecione apenas essa opção. O arquivo fica pronto em minutos, em vez de horas.',
    emphasis: true,
  },
  {
    title: 'Em período, escolha "Todo o período"',
    body: 'Este é o passo que mais gente erra. Se você limitar a 12 meses, o arquivo vem incompleto e o app vai achar que muita gente parou de te seguir sem ter parado.',
    emphasis: true,
  },
  {
    title: 'Escolha JSON, se aparecer',
    body: 'HTML também funciona. Com JSON as datas ficam mais precisas, mas não vale refazer o pedido só por isso.',
  },
  {
    title: 'Espere o e-mail do Instagram',
    body: 'Costuma levar alguns minutos, mas pode chegar a 48 horas. Você não precisa deixar o app aberto.',
  },
  {
    title: 'Volte aqui e envie o arquivo',
    body: 'Baixe o .zip que o Instagram mandar e toque no botão abaixo. Envie como veio: sem abrir, sem descompactar e sem renomear.',
  },
];

interface Props {
  onPickFile: () => void;
  onAbrirSobreArquivo: () => void;
  importing?: boolean;
  /** Fração já lida do arquivo (0..1). O arquivo completo passa de 400 MB. */
  progress?: number;
  /** Mensagem de falha do último envio, se houve. */
  error?: string | null;
  /** Muda o texto do topo: primeira vez pede contexto, depois vira rotina. */
  primeiraVez: boolean;
}

export function ImportGuideScreen({
  onPickFile,
  onAbrirSobreArquivo,
  importing,
  progress,
  error,
  primeiraVez,
}: Props) {
  // Sem porcentagem enquanto não há o que mostrar: um "0%" parado é pior que
  // nenhum número, porque parece travado.
  const rotulo = importing
    ? progress && progress > 0.01
      ? `Lendo… ${Math.round(progress * 100)}%`
      : 'Lendo o arquivo…'
    : 'Escolher arquivo';

  return (
    <View style={s.raiz}>
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Text style={s.title}>
          {primeiraVez ? 'Traga seus dados do Instagram' : 'Enviar um arquivo novo'}
        </Text>
        <Text style={s.subtitle}>
          {primeiraVez
            ? 'O Instagram entrega um arquivo com sua lista de seguidores. Peça a ele e envie aqui.'
            : 'Peça um arquivo novo ao Instagram e envie aqui para ver o que mudou.'}
        </Text>

        <View style={s.promessa}>
          <IconeEscudo />
          <Text style={s.promessaTexto}>
            <Text style={s.promessaForte}>Não pedimos sua senha do Instagram.</Text> É por isso
            que precisamos deste arquivo — e é o que mantém sua conta longe de risco de bloqueio.
          </Text>
        </View>

        {error ? (
          <View style={[s.nota, s.notaErro]}>
            <Text style={s.notaTitulo}>Não deu para ler esse arquivo</Text>
            <Text style={s.notaCorpo}>{error}</Text>
          </View>
        ) : null}

        {PASSOS.map((passo, i) => (
          <View key={passo.title} style={s.passo}>
            {/* Numeração faz sentido aqui: é um procedimento em ordem obrigatória. */}
            <Text style={s.passoNumero}>{i + 1}</Text>
            <View style={s.passoTexto}>
              <Text style={[s.passoTitulo, passo.emphasis && s.passoTituloDestaque]}>
                {passo.title}
              </Text>
              <Text style={s.passoCorpo}>{passo.body}</Text>
            </View>
          </View>
        ))}

        {/* `accessibilityRole` nos dois: sem ele o leitor de tela lê o texto
            como parágrafo e não avisa que dá para tocar. */}
        <Pressable
          onPress={() => Linking.openURL('https://www.instagram.com/download/request/')}
          accessibilityRole="link"
          style={({ pressed }) => pressed && s.pressed}
        >
          <Text style={s.linkSecundario}>Abrir a página de download do Instagram</Text>
        </Pressable>

        <Pressable
          onPress={onAbrirSobreArquivo}
          accessibilityRole="button"
          style={({ pressed }) => pressed && s.pressed}
        >
          <Text style={s.linkSecundario}>Por que preciso desse arquivo?</Text>
        </Pressable>
      </ScrollView>

      {/*
       * Botão fixo no rodapé, acima da barra de abas. É a ação da tela, e numa
       * página de sete passos ela ficaria fora de alcance se rolasse junto — o
       * usuário teria que percorrer a lista inteira toda vez que voltasse aqui
       * com o arquivo já baixado.
       */}
      <View style={s.rodape}>
        <Pressable
          style={({ pressed }) => [s.primario, importing && s.primarioInativo, pressed && s.pressed]}
          onPress={onPickFile}
          disabled={importing}
          accessibilityRole="button"
        >
          <Text style={s.primarioLabel}>{rotulo}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.base },
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.md, gap: space.sm },
  pressed: { opacity: 0.6 },

  title: {
    color: colors.ink,
    fontSize: typography.scale.title,
    fontWeight: typography.weight.bold,
  },
  subtitle: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
    marginBottom: space.sm,
  },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  promessaTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
  },
  promessaForte: { color: colors.ink, fontWeight: typography.weight.semibold },

  nota: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.gained,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  notaErro: { borderLeftColor: colors.danger },
  notaTitulo: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  notaCorpo: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },

  passo: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  passoNumero: {
    color: colors.inkFaint,
    fontSize: typography.scale.caption,
    fontWeight: typography.weight.semibold,
    width: 18,
    textAlign: 'center',
    lineHeight: 22,
  },
  passoTexto: { flex: 1, gap: 3 },
  passoTitulo: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.medium,
  },
  passoTituloDestaque: { color: colors.gained },
  passoCorpo: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },

  linkSecundario: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    paddingVertical: space.sm,
  },

  rodape: {
    padding: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.base,
  },
  primario: {
    backgroundColor: colors.gained,
    borderRadius: radius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarioInativo: { opacity: 0.5 },
  primarioLabel: {
    color: colors.base,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
});

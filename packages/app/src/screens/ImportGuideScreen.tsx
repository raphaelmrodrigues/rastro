/**
 * Aba Importar — como conseguir o arquivo e enviá-lo.
 *
 * Esta é a tela mais importante do produto inteiro. Sair do app, achar um menu
 * escondido dentro do Instagram e voltar é o principal motivo de abandono. Cada
 * palavra aqui existe para reduzir dúvida.
 *
 * Sobre a espera: pedindo só "Seguidores e seguindo", o arquivo chega em poucos
 * minutos — foi o observado num teste real, em 19/08/2026. As 48 horas são o
 * teto que o Instagram publica, e valem na prática para quem pede o export
 * inteiro. Anunciar "até 48 horas" como se fosse a regra assusta na hora errada
 * e faz desistir gente que teria o arquivo antes de largar o celular. A ressalva
 * fica no fim do passo, entre parênteses, porque quem cai no caso raro precisa
 * saber que aquilo é normal.
 *
 * ## O que mudou em 19/08/2026
 *
 * A tela era uma página só, com sete passos numerados abertos, um bloco sobre
 * senha e dois links soltos — e ela era a **primeira** coisa que uma pessoa via
 * ao abrir o app. Muito texto num momento em que ninguém tem motivo para ler.
 *
 * A apresentação do produto saiu daqui e virou `BemVindoScreen`. O que ficou é
 * o que esta tela realmente é: um procedimento. E procedimento se lê recolhido,
 * um passo de cada vez, não como parede.
 *
 * Duas instruções continuam com destaque visual porque são as que, se erradas,
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
 * ## As duas pessoas que chegam aqui
 *
 * Quem ainda não pediu o arquivo precisa do procedimento. Quem já pediu e
 * esperou precisa de um botão, e nada mais — obrigá-la a rolar sete
 * passos toda vez é castigo. Por isso o botão de enviar fica fixo no rodapé e o
 * procedimento vem recolhido a partir da segunda visita.
 */

import { useState } from 'react';
import { ScrollView, Text, View, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import { IconeEscudo, IconeExterno, IconeAvancar } from '../components/icons';
import { Gradiente } from '../components/ui';
import { colors, gradients, heading, radius, space, typography } from '../lib/theme';

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
    body: 'Pedindo só a lista de seguidores, ele costuma chegar em poucos minutos. Você não precisa deixar o app aberto — o Instagram avisa por e-mail. (Em contas muito antigas pode demorar mais; o prazo máximo que o Instagram publica é de 48 horas.)',
  },
  {
    title: 'Volte aqui e envie o arquivo',
    body: 'Baixe o .zip que o Instagram mandar e toque no botão abaixo. Envie como veio: sem abrir, sem descompactar e sem renomear.',
  },
];

/**
 * Em que ponto do envio a tela está. Cada fase tem um texto próprio no botão.
 *
 * `preparando` é o caminho lento: o aparelho não deixou ler o arquivo onde ele
 * está e o app teve de copiá-lo para dentro primeiro. Num export completo isso
 * leva minutos, e é a única fase que precisa se explicar em voz alta.
 */
export type FaseDoImport = 'parado' | 'escolhendo' | 'preparando' | 'lendo';

interface Props {
  onPickFile: () => void;
  onAbrirSobreArquivo: () => void;
  fase: FaseDoImport;
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
  fase,
  progress,
  error,
  primeiraVez,
}: Props) {
  // Na primeira visita o procedimento é o conteúdo da tela. Depois, quem volta
  // aqui volta com o arquivo na mão — e o passo a passo só atrapalha o botão.
  const [passosAbertos, setPassosAbertos] = useState(primeiraVez);

  const ocupado = fase !== 'parado';

  /*
   * Sem porcentagem enquanto não há o que mostrar: um "0%" parado é pior que
   * nenhum número, porque parece travado.
   *
   * A fase "escolhendo" existe porque o seletor do Android leva segundos para
   * abrir num aparelho ocupado. Sem um rótulo aqui, o toque não produzia nada
   * visível e a pessoa concluía que o botão estava quebrado — que foi
   * exatamente o que aconteceu no primeiro teste em aparelho.
   */
  const rotulo =
    fase === 'escolhendo'
      ? 'Abrindo seus arquivos…'
      : fase === 'preparando'
        ? 'Preparando o arquivo…'
        : fase === 'lendo'
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

        {error ? (
          <View style={s.notaErro}>
            <Text style={s.notaTitulo}>Não deu para ler esse arquivo</Text>
            <Text style={s.notaCorpo}>{error}</Text>
          </View>
        ) : null}

        {/*
         * Ação de verdade para quem ainda não tem o arquivo. Antes isto era um
         * link cinza no meio de outros dois, do mesmo tamanho e da mesma cor —
         * e era o passo que destrava o app inteiro.
         */}
        <Pressable
          onPress={() => Linking.openURL('https://www.instagram.com/download/request/')}
          accessibilityRole="link"
          style={({ pressed }) => [s.cartaoAcaoFora, pressed && s.pressed]}
        >
          <Gradiente cores={gradients.suave} style={s.cartaoAcao}>
            <View style={s.cartaoTexto}>
              <Text style={s.cartaoTitulo}>Pedir o arquivo ao Instagram</Text>
              <Text style={s.cartaoCorpo}>Abre a página de download na sua conta</Text>
            </View>
            <IconeExterno size={18} cor={colors.gained} />
          </Gradiente>
        </Pressable>

        {/* Procedimento, recolhível. */}
        <Pressable
          onPress={() => setPassosAbertos((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: passosAbertos }}
          style={({ pressed }) => [s.cabecalhoPassos, pressed && s.pressed]}
        >
          <Text style={s.cabecalhoPassosTexto}>Como pedir, passo a passo</Text>
          <View style={passosAbertos ? s.setaAberta : undefined}>
            <IconeAvancar size={18} cor={colors.inkMuted} />
          </View>
        </Pressable>

        {passosAbertos ? (
          <View style={s.passos}>
            {PASSOS.map((passo, i) => (
              <View key={passo.title} style={[s.passo, passo.emphasis && s.passoDestaque]}>
                {/* Numeração faz sentido aqui: é um procedimento em ordem obrigatória. */}
                <View style={[s.bolha, passo.emphasis && s.bolhaDestaque]}>
                  <Text style={[s.passoNumero, passo.emphasis && s.passoNumeroDestaque]}>
                    {i + 1}
                  </Text>
                </View>
                <View style={s.passoTexto}>
                  <Text style={[s.passoTitulo, passo.emphasis && s.passoTituloDestaque]}>
                    {passo.title}
                  </Text>
                  <Text style={s.passoCorpo}>{passo.body}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.promessa}>
          <IconeEscudo />
          <Text style={s.promessaTexto}>
            <Text style={s.promessaForte}>Não pedimos sua senha do Instagram.</Text> É por isso
            que precisamos deste arquivo — e é o que mantém sua conta longe de risco de bloqueio.
          </Text>
        </View>

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
          style={({ pressed }) => [
            s.primarioFora,
            ocupado && s.primarioInativo,
            pressed && s.pressed,
          ]}
          onPress={onPickFile}
          disabled={ocupado}
          accessibilityRole="button"
        >
          <Gradiente style={s.primario}>
            {ocupado ? <ActivityIndicator size="small" color={colors.base} /> : null}
            <Text style={s.primarioLabel}>{rotulo}</Text>
          </Gradiente>
        </Pressable>

        {/*
         * Barra de progresso do arquivo. Num export completo a leitura passa de
         * um minuto, e a porcentagem no rótulo sozinha não dá a sensação de
         * avanço que uma barra dá.
         */}
        {fase === 'lendo' && progress && progress > 0.01 ? (
          <View style={s.barra}>
            <Gradiente style={[s.barraCheia, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}

        {/*
         * A cópia não tem porcentagem para mostrar — o sistema não reporta o
         * avanço dela. Então ela ao menos diz que está viva e por quê: um botão
         * girando por dois minutos sem explicação é indistinguível de travado.
         */}
        {fase === 'preparando' ? (
          <Text style={s.aviso}>
            Copiando para o app, porque este arquivo não pôde ser lido de onde está. Pode levar
            alguns minutos.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.base },
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.lg, gap: space.sm },
  pressed: { opacity: 0.6 },

  title: {
    color: colors.ink,
    ...heading.title,
  },
  subtitle: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
    marginBottom: space.sm,
  },

  cartaoAcaoFora: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gained,
    overflow: 'hidden',
  },
  cartaoAcao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  cartaoTexto: { flex: 1, gap: 2 },
  cartaoTitulo: {
    color: colors.gained,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  cartaoCorpo: { color: colors.inkMuted, fontSize: typography.scale.caption },

  cabecalhoPassos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    marginTop: space.xs,
  },
  cabecalhoPassosTexto: {
    color: colors.ink,
    ...heading.section,
  },
  // A seta aponta para a direita quando fechado e para baixo quando aberto —
  // sem um ícone novo, só girando o que já existe.
  setaAberta: { transform: [{ rotate: '90deg' }] },

  passos: { gap: space.sm },
  passo: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
  },
  passoDestaque: { borderLeftWidth: 3, borderLeftColor: colors.gained },
  bolha: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bolhaDestaque: { backgroundColor: colors.gainedSoft },
  passoNumero: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    fontWeight: typography.weight.semibold,
  },
  passoNumeroDestaque: { color: colors.gained },
  passoTexto: { flex: 1, gap: 3 },
  passoTitulo: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.medium,
  },
  passoTituloDestaque: { color: colors.gained },
  passoCorpo: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
  },
  promessaTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
  },
  promessaForte: { color: colors.ink, fontWeight: typography.weight.semibold },

  notaErro: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  notaTitulo: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  notaCorpo: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },

  linkSecundario: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    paddingVertical: space.md,
  },

  rodape: {
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.base,
    gap: space.sm,
  },
  primarioFora: { borderRadius: radius.md, overflow: 'hidden' },
  primario: {
    flexDirection: 'row',
    gap: space.sm,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarioInativo: { opacity: 0.6 },
  primarioLabel: {
    color: colors.base,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },

  barra: { height: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  aviso: {
    marginTop: space.sm,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 17,
    textAlign: 'center',
  },
  barraCheia: { height: 4, borderRadius: radius.pill },
});

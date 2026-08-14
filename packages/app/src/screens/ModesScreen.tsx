/**
 * "Dá para usar sem baixar o arquivo?"
 *
 * Esta tela existe porque a pergunta é inevitável — o export demora até 48h e o
 * processo é chato. A resposta honesta é "em parte", e a tela mostra exatamente
 * onde está a linha.
 *
 * A tabela vem de MODE_CAPABILITIES, no core, e não de texto escrito aqui. Motivo:
 * a promessa do produto e o comportamento do produto precisam mudar no mesmo lugar.
 * Se um dia o modo conectado passar a listar nomes, ou é porque a Meta mudou a API,
 * ou é porque alguém trocou a API oficial por uma privada — e a segunda hipótese
 * custa a conta do usuário.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CONNECTED_MODE_REQUIREMENTS, MODE_CAPABILITIES } from '@rastro/core';
import { Banner, SectionTitle } from '../components/ui';
import { colors, radius, space, typography } from '../lib/theme';

const MARCA: Record<'yes' | 'no' | 'partial', { simbolo: string; cor: string }> = {
  yes: { simbolo: '✓', cor: colors.gained },
  no: { simbolo: '—', cor: colors.inkFaint },
  partial: { simbolo: '≈', cor: colors.approximate },
};

/** O voltar fica no cabeçalho, montado pelo App — a tela não desenha o seu. */
export function ModesScreen() {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.title}>Dá para usar sem baixar o arquivo?</Text>
      <Text style={s.lead}>
        Em parte. O Instagram tem uma API oficial que entrega números — quantos
        seguidores você tem, quantos entraram e saíram, de onde é seu público. Ela
        atualiza sozinha, sem espera e sem arquivo.
      </Text>
      <Text style={s.lead}>
        O que ela não entrega, para ninguém, é a lista de quem são essas pessoas.
        Não existe permissão a pedir: o endpoint não existe. Por isso "quem deixou de
        te seguir" continua vindo só do arquivo de export.
      </Text>

      <Banner
        tone="warning"
        title="Se algum app promete essa lista sem arquivo"
        body={
          'Ele está entrando na sua conta com sua senha ou usando uma API não autorizada. ' +
          'É isso que faz contas serem bloqueadas — a sua, não a do app. Foi por causa ' +
          'desse risco que o Rastro foi construído do outro jeito.'
        }
      />

      <SectionTitle>O que cada modo responde</SectionTitle>
      <View style={s.tableHeader}>
        <Text style={[s.cellQuestion, s.headerText]}>Pergunta</Text>
        <Text style={[s.cellMark, s.headerText]}>Arquivo</Text>
        <Text style={[s.cellMark, s.headerText]}>Conectado</Text>
      </View>

      {MODE_CAPABILITIES.map((cap) => (
        <View key={cap.question} style={s.tableRow}>
          <View style={s.cellQuestion}>
            <Text style={s.question}>{cap.question}</Text>
            {cap.note ? <Text style={s.note}>{cap.note}</Text> : null}
          </View>
          <Text style={[s.cellMark, s.mark, { color: MARCA[cap.fileMode].cor }]}>
            {MARCA[cap.fileMode].simbolo}
          </Text>
          <Text style={[s.cellMark, s.mark, { color: MARCA[cap.connectedMode].cor }]}>
            {MARCA[cap.connectedMode].simbolo}
          </Text>
        </View>
      ))}

      <SectionTitle>Para ligar o modo conectado</SectionTitle>
      {CONNECTED_MODE_REQUIREMENTS.map((req) => (
        <View key={req} style={s.requisito}>
          <Text style={s.bullet}>•</Text>
          <Text style={s.requisitoTexto}>{req}</Text>
        </View>
      ))}

      <Banner
        title="Os dois juntos funcionam melhor"
        body={
          'O modo conectado acompanha o dia a dia sem esforço e sem espera. O import, ' +
          'de vez em quando, preenche os nomes. Um cobre a fraqueza do outro: a API não ' +
          'tem passado nem nomes, e o arquivo não tem frequência.'
        }
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.lg, paddingBottom: space.xxl },
  title: { color: colors.ink, fontSize: typography.scale.title, marginVertical: space.sm },
  lead: {
    color: colors.inkMuted,
    fontSize: typography.scale.body,
    lineHeight: 24,
    marginBottom: space.sm,
  },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerText: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cellQuestion: { flex: 1, paddingRight: space.sm, gap: 2 },
  // Largura suficiente para "CONECTADO" caber numa linha só no cabeçalho.
  cellMark: { width: 92, textAlign: 'center' },
  question: { color: colors.ink, fontSize: typography.scale.caption },
  note: { color: colors.inkFaint, fontSize: typography.scale.micro, lineHeight: 16 },
  mark: { fontSize: typography.scale.section },

  requisito: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  bullet: { color: colors.gained, fontSize: typography.scale.body },
  requisitoTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
  },
});

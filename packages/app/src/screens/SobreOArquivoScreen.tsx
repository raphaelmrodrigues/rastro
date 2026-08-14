/**
 * "Preciso mesmo baixar esse arquivo?"
 *
 * A pergunta é inevitável: pedir o arquivo ao Instagram e esperar até 48h é o
 * maior atrito do produto, e é onde o usuário desiste. Esta tela existe para
 * responder isso sem enrolação e, de quebra, transformar o atrito em argumento —
 * o motivo do arquivo é o mesmo motivo pelo qual a conta dele não corre risco.
 *
 * ## O que saiu daqui, e por quê
 *
 * A versão anterior trazia uma tabela comparando "modo arquivo" e "modo
 * conectado", alimentada por MODE_CAPABILITIES do core, mais a lista de
 * requisitos técnicos para ligar o modo conectado. Dois problemas:
 *
 * 1. O modo conectado **não existe na interface**. Não há nada para o usuário
 *    ligar. Uma coluna "Conectado" com ✓ e ≈ prometia recurso inexistente, o que
 *    é pior do que técnico demais — é enganoso.
 * 2. "Para ligar o modo conectado: [requisitos]" é item de roadmap. Quem lê é o
 *    cliente, e ele não vai criar app na Meta nem configurar OAuth.
 *
 * O acoplamento que a tabela garantia — promessa e comportamento mudando no
 * mesmo lugar — continua valendo, e MODE_CAPABILITIES segue no core como fonte
 * da verdade. Quando o modo conectado existir de fato na interface, esta tela
 * volta a consumi-lo. Ver docs/MODO-CONECTADO.md.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner } from '../components/ui';
import { IconeEscudo } from '../components/icons';
import { colors, radius, space, typography } from '../lib/theme';

/** O voltar fica no cabeçalho, montado pelo App — a tela não desenha o seu. */
export function SobreOArquivoScreen() {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.titulo}>Por que preciso desse arquivo?</Text>

      <Text style={s.lead}>
        Porque é a única forma de saber quem são as pessoas que deixaram de te seguir sem
        pedir a sua senha do Instagram.
      </Text>

      <View style={s.promessa}>
        <IconeEscudo />
        <Text style={s.promessaTexto}>
          O arquivo é o mesmo que o Instagram entrega a qualquer pessoa que peça os próprios
          dados. Ele sai do site oficial e vai direto para o seu celular.
        </Text>
      </View>

      <Text style={s.secao}>O que vem nele</Text>
      <Item texto="Quem te segue hoje" />
      <Item texto="Quem você segue" />
      <Item texto="A data em que cada pessoa começou a te seguir" />
      <Item texto="As solicitações que você enviou e ninguém respondeu" />

      <Text style={s.secao}>O que o Rastro faz com isso</Text>
      <Text style={s.corpo}>
        Guarda uma fotografia da sua lista. Quando você enviar o próximo arquivo, ele compara
        as duas e mostra quem saiu, quem entrou e quem só trocou de nome de usuário.
      </Text>
      <Text style={s.corpo}>
        Por isso o primeiro arquivo não mostra saídas: ele é o ponto de partida. A partir do
        segundo, cada envio revela o que mudou no intervalo.
      </Text>

      <Text style={s.secao}>Com que frequência devo enviar</Text>
      <Text style={s.corpo}>
        A cada duas semanas costuma ser um bom ritmo. Quanto mais seguido, mais estreita fica
        a janela de tempo de cada saída — se você envia uma vez por mês, o app dirá que
        alguém saiu "em algum dia daquele mês".
      </Text>

      <Banner
        tone="warning"
        title="Cuidado com apps que dispensam o arquivo"
        body={
          'Se um aplicativo mostra quem deixou de te seguir sem pedir nenhum arquivo, é ' +
          'porque ele está entrando na sua conta por dentro. É assim que perfis são ' +
          'bloqueados ou invadidos — e quem perde a conta é você, não o app. O Rastro foi ' +
          'feito do jeito mais trabalhoso justamente para isso nunca acontecer com você.'
        }
      />

      <Text style={s.secao}>Uma pergunta comum</Text>
      <Text style={s.pergunta}>Não dá para o app pegar isso sozinho?</Text>
      <Text style={s.corpo}>
        Não. O Instagram não entrega a lista de seguidores para nenhum aplicativo, em nenhuma
        situação — não é uma permissão que dê para pedir. Ele só entrega essa lista para o
        dono da conta, e é exatamente esse o arquivo que você baixa.
      </Text>
    </ScrollView>
  );
}

function Item({ texto }: { texto: string }) {
  return (
    <View style={s.item}>
      <Text style={s.marcador}>•</Text>
      <Text style={s.itemTexto}>{texto}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.lg, paddingBottom: space.xl },

  titulo: {
    color: colors.ink,
    fontSize: typography.scale.title,
    fontWeight: typography.weight.bold,
    marginBottom: space.sm,
  },
  lead: {
    color: colors.ink,
    fontSize: typography.scale.body,
    lineHeight: 24,
    marginBottom: space.md,
  },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
  },
  promessaTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
  },

  secao: {
    color: colors.ink,
    fontSize: typography.scale.section,
    fontWeight: typography.weight.semibold,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  corpo: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 21,
    marginBottom: space.sm,
  },
  pergunta: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.medium,
    marginBottom: space.xs,
  },

  item: { flexDirection: 'row', gap: space.sm, marginBottom: space.xs },
  marcador: { color: colors.gained, fontSize: typography.scale.body, lineHeight: 21 },
  itemTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 21,
  },
});

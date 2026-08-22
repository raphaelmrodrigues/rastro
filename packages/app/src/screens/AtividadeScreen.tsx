/**
 * Aba Atividade — o que só existe com o export completo.
 *
 * Duas telas no mesmo lugar, e a diferença entre elas é o ponto do produto:
 *
 * - quem só mandou o export rápido vê o **convite**, com o que ganharia e quanto
 *   custa em espera;
 * - quem mandou o completo vê os dados.
 *
 * O convite é escrito para não enganar em dois pontos onde é fácil enganar:
 * a espera de até 48h é do **Instagram preparando o arquivo**, não do app
 * processando; e o arquivo é grande de verdade. Prometer "rapidinho" aqui
 * garante um usuário irritado dali a dois dias.
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ActivityData } from '@rastro/core';
import { Button, MenuRow, SectionTitle } from '../components/ui';
import { IconeEscudo } from '../components/icons';
import { colors, heading, radius, space, typography } from '../lib/theme';
import { formatNumber, formatRelative } from '../lib/format';
import type { ListaDeAtividade } from './AtividadeListaScreen';

interface Props {
  atividade: ActivityData | null;
  onAbrir: (lista: ListaDeAtividade) => void;
  onComoConseguir: () => void;
}

export function AtividadeScreen({ atividade, onAbrir, onComoConseguir }: Props) {
  if (!atividade) return <Convite onComoConseguir={onComoConseguir} />;

  const pendentes = atividade.conversations.filter((c) => c.awaitingYou).length;
  // `?? false` porque os dois campos entraram em 21/08/2026: o `atividade.json`
  // de quem importou antes não os tem. Ver `completar` em lib/storage.ts.
  const nuncaRespondi = atividade.conversations.filter((c) => c.neverReplied ?? false).length;
  const solicitacoes = atividade.conversations.filter((c) => c.isRequest ?? false).length;
  const anunciantes = atividade.advertisers.reduce((s, g) => s + g.advertisers.length, 0);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      <Text style={s.resumoTopo}>
        Retrato do arquivo que você enviou {formatRelative(atividade.builtAt)}.
      </Text>

      <SectionTitle>Conversas</SectionTitle>
      <MenuRow
        label="Você não respondeu"
        value={formatNumber(pendentes)}
        onPress={() => onAbrir('nao-respondidas')}
      />
      {/*
       * "Nunca respondeu" vem logo abaixo de "não respondeu" porque é o recorte
       * pequeno do mesmo problema: no arquivo do dono são 28 contra 647. A lista
       * grande é um inventário; esta é uma tarefa que cabe numa tarde.
       */}
      {nuncaRespondi > 0 ? (
        <MenuRow
          label="Você nunca respondeu"
          value={formatNumber(nuncaRespondi)}
          onPress={() => onAbrir('nunca-respondi')}
        />
      ) : null}
      {solicitacoes > 0 ? (
        <MenuRow
          label="Pedidos de mensagem"
          value={formatNumber(solicitacoes)}
          onPress={() => onAbrir('solicitacoes')}
        />
      ) : null}
      <MenuRow
        label="Todas as conversas"
        value={formatNumber(atividade.conversations.length)}
        onPress={() => onAbrir('conversas')}
      />
      {/*
       * Sem saber qual participante é o dono da conta, "você não respondeu" não
       * tem como ser calculado — e um palpite inverteria a lista inteira. Dizer
       * isso é melhor do que mostrar zero, que a pessoa leria como "estou em dia".
       */}
      {atividade.self === null && atividade.conversations.length > 0 ? (
        <Text style={s.aviso}>
          Não conseguimos identificar qual participante é você neste arquivo, então a lista de
          não respondidas pode estar incompleta.
        </Text>
      ) : null}

      {atividade.commentedOn.length > 0 ? (
        <>
          <SectionTitle>Interação</SectionTitle>
          <MenuRow
            label="Quem você mais comenta"
            value={formatNumber(atividade.commentedOn.length)}
            onPress={() => onAbrir('comentei')}
          />
        </>
      ) : null}

      {anunciantes > 0 || atividade.profileSearches.length > 0 ? (
        <>
          <SectionTitle>Seus dados</SectionTitle>
          {anunciantes > 0 ? (
            <MenuRow
              label="Empresas com seus dados"
              value={formatNumber(anunciantes)}
              onPress={() => onAbrir('anunciantes')}
            />
          ) : null}
          {atividade.profileSearches.length > 0 ? (
            <MenuRow
              label="Perfis que você procurou"
              value={formatNumber(atividade.profileSearches.length)}
              onPress={() => onAbrir('buscas')}
            />
          ) : null}
        </>
      ) : null}

      <View style={s.promessa}>
        <IconeEscudo size={20} />
        <Text style={s.promessaTexto}>
          Nada disso sai do seu aparelho, nem para a sua conta do Rastro. Das conversas ficam
          guardadas as duas últimas mensagens de cada uma, para a lista dizer do que era —
          o resto o app lê, conta e descarta.
        </Text>
      </View>
    </ScrollView>
  );
}

/**
 * O convite para o export completo.
 *
 * Mostra o custo antes do benefício de propósito. Quem decide encarar 48h de
 * espera sabendo disso não se sente enganado depois; quem descobre no meio,
 * sim — e desiste com o app já instalado.
 */
function Convite({ onComoConseguir }: { onComoConseguir: () => void }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      <Text style={s.titulo}>Tem mais dentro do seu arquivo</Text>
      <Text style={s.explicacao}>
        O arquivo que você enviou traz só suas listas de seguidores, porque é o pedido que fica
        pronto rápido. Existe um pedido maior, com o resto da sua conta.
      </Text>

      <SectionTitle>O que você veria</SectionTitle>
      <Item titulo="Conversas que você não respondeu">
        As que terminaram com a outra pessoa falando — aquelas que descem no meio da caixa de
        entrada e somem.
      </Item>
      <Item titulo="Com quem você mais interage">
        De quem são os posts que você mais comenta.
      </Item>
      <Item titulo="Empresas que têm seus dados">
        Quantas e quais empresas passaram seus dados para a Meta poder te anunciar. No arquivo de
        teste deste app eram mais de cinco mil.
      </Item>
      <Item titulo="Perfis que você procurou">Seu histórico de busca de perfis.</Item>

      <View style={s.custo}>
        <Text style={s.custoTitulo}>O que custa</Text>
        <Text style={s.custoTexto}>
          <Text style={s.destaque}>A espera é do Instagram, não do app.</Text> Ele leva de algumas
          horas até 48 horas para preparar esse arquivo maior, e avisa por e-mail quando ficar
          pronto. O arquivo rápido costuma sair em minutos.
        </Text>
        <Text style={s.custoTexto}>
          Ele também é grande — no teste deste app, quase 500 MB. Vale conferir o espaço do
          celular antes de baixar. Depois de enviar aqui, você pode apagar o arquivo.
        </Text>
      </View>

      <Button label="Como pedir o arquivo completo" onPress={onComoConseguir} />

      <Text style={s.rodape}>
        Você não precisa disso para acompanhar seus seguidores. Tudo que já funciona continua
        funcionando com o arquivo rápido.
      </Text>
    </ScrollView>
  );
}

function Item({ titulo, children }: { titulo: string; children: string }) {
  return (
    <View style={s.item}>
      <Text style={s.itemTitulo}>{titulo}</Text>
      <Text style={s.itemTexto}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  conteudo: { padding: space.lg, paddingBottom: space.xl, gap: space.xs },

  resumoTopo: {
    color: colors.inkFaint,
    fontSize: typography.scale.caption,
    marginBottom: space.xs,
  },
  aviso: {
    color: colors.inkMuted,
    fontSize: typography.scale.micro,
    lineHeight: 17,
    paddingVertical: space.xs,
  },

  titulo: {
    color: colors.ink,
    ...heading.title,
  },
  explicacao: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
    marginBottom: space.sm,
  },

  item: { paddingVertical: space.sm, gap: 2 },
  itemTitulo: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  itemTexto: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 19 },

  custo: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
    marginTop: space.md,
    marginBottom: space.md,
  },
  custoTitulo: {
    color: colors.ink,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  custoTexto: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  destaque: { color: colors.ink, fontWeight: typography.weight.semibold },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.lg,
  },
  promessaTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
  },

  rodape: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    lineHeight: 17,
    marginTop: space.lg,
  },
});

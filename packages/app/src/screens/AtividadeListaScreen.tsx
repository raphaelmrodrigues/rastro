/**
 * As listas que vêm do export completo.
 *
 * Uma tela para os cinco recortes, como em PeopleListScreen — a forma de ler é a
 * mesma, muda a fonte e o texto.
 *
 * Duas decisões que atravessam o arquivo:
 *
 * 1. **Conversa quase nunca abre perfil, e agora se sabe por quê.** O arquivo da
 *    conversa traz nome de exibição, não @. O nome da pasta também não é o @: em
 *    1.480 de 1.573 conversas do export real ele é o *título* achatado. E as
 *    listas de seguidores vêm sem nome de exibição, então não existe chave que
 *    ligue os dois lados. O link só aparece nas poucas contas cujo nome de
 *    exibição é igual ao @. Para todas as outras a linha oferece **buscar o nome
 *    no Instagram**, que é o que a pessoa faria na mão.
 * 2. **A prévia das duas últimas mensagens aparece aqui** desde 20/08/2026, por
 *    decisão do dono: sem ela a lista é um monte de nome e data que não diz do
 *    que era a conversa. Só texto, truncado, e só as duas — o limite mora em
 *    `core/src/activity.ts` e nada disso sobe para o servidor.
 */

import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ActivityData, MessagePreview } from '@rastro/core';
import { Banner, EmptyState, PersonRow } from '../components/ui';
import { IconeBusca } from '../components/icons';
import { colors, radius, space, typography } from '../lib/theme';
import { formatDate, formatNumber, formatRelative } from '../lib/format';
import { abrirPerfil, buscarNoInstagram } from '../lib/perfil';

export type ListaDeAtividade =
  | 'nao-respondidas'
  | 'nunca-respondi'
  | 'solicitacoes'
  | 'conversas'
  | 'comentei'
  | 'anunciantes'
  | 'buscas';

export const TITULOS_ATIVIDADE: Record<
  ListaDeAtividade,
  { title: string; explicacao: string; vazio: string }
> = {
  'nao-respondidas': {
    title: 'Você não respondeu',
    explicacao:
      'Conversas em que a última mensagem é da outra pessoa e você não respondeu nem reagiu. ' +
      'Reagir com emoji conta como resposta.',
    vazio: 'Nenhuma conversa esperando por você. Caixa de entrada em dia.',
  },
  /*
   * As duas listas abaixo existem porque "quem eu não visualizei" foi pedido e
   * não é possível: o arquivo do Instagram não guarda status de leitura em
   * lugar nenhum — nem no JSON, nem no HTML, nem em campo escondido. As chaves
   * de mensagem foram varridas em 21/08/2026 e estão em docs/EXPORT-INSTAGRAM.md.
   *
   * Estas são as duas aproximações que a fonte permite, e a explicação de cada
   * uma diz o que ela é de verdade. Nenhuma promete "não visto".
   */
  'nunca-respondi': {
    title: 'Você nunca respondeu',
    explicacao:
      'Conversas em que a outra pessoa falou e você nunca mandou nada — nem uma ' +
      'mensagem, nem antes. O arquivo do Instagram não registra o que você abriu ' +
      'ou deixou de abrir, então esta é a lista mais próxima disso que dá para montar.',
    vazio: 'Você respondeu, em algum momento, todas as conversas do seu arquivo.',
  },
  solicitacoes: {
    title: 'Pedidos de mensagem',
    explicacao:
      'Mensagens de quem não te segue. O Instagram guarda essas conversas numa ' +
      'caixa separada, atrás de "Solicitações" — é onde ficam as que ninguém abre.',
    vazio: 'Nenhum pedido de mensagem no seu arquivo.',
  },
  conversas: {
    title: 'Todas as conversas',
    explicacao: 'Suas conversas, da mais recente para a mais antiga.',
    vazio: 'Nenhuma conversa no arquivo.',
  },
  comentei: {
    title: 'Quem você mais comenta',
    explicacao:
      'De quem são os posts que você comentou. O Instagram não informa o dono de todos os ' +
      'comentários no arquivo, então o total aqui é menor que o real.',
    vazio: 'Nenhum comentário com dono identificado no seu arquivo.',
  },
  anunciantes: {
    title: 'Empresas com seus dados',
    explicacao:
      'Empresas que forneceram seus dados à Meta, ou que te rastrearam, para poder te anunciar. ' +
      'Nenhuma delas veio de nós — a lista é a que o próprio Instagram entrega.',
    vazio: 'Nenhuma empresa listada no seu arquivo.',
  },
  buscas: {
    title: 'Perfis que você procurou',
    explicacao: 'Seu histórico de busca de perfis, do mais recente ao mais antigo.',
    vazio: 'Nenhuma busca de perfil no seu arquivo.',
  },
};

/**
 * Uma mensagem já pronta para a linha: quem falou e o quê, numa string só.
 *
 * Montada aqui e não no core porque é texto de interface — o core devolve os
 * pedaços (`fromYou`, `text`, `kind`, `reaction`) e quem escreve em português
 * é a camada de tela.
 */
function previaDaMensagem(m: MessagePreview): string {
  const quem = m.fromYou ? 'Você' : 'Ela(e)';
  const corpo = m.text || ROTULO_DA_MIDIA[m.kind ?? 'share'];
  // A reação vai no fim porque ela é o desfecho da mensagem, não o começo.
  const reacao = m.reaction ? ` ${m.reaction}${m.reactedByYou ? ' (você)' : ''}` : '';
  return `${quem}: ${corpo}${reacao}`;
}

/** O que mostrar quando a mensagem não tinha texto. */
const ROTULO_DA_MIDIA: Record<NonNullable<MessagePreview['kind']>, string> = {
  photo: 'mandou uma foto',
  video: 'mandou um vídeo',
  audio: 'mandou um áudio',
  share: 'compartilhou um post',
  call: 'chamada',
};

interface Item {
  chave: string;
  titulo: string;
  /** @ para abrir o perfil. Ausente = a linha não é clicável. */
  username?: string;
  /**
   * Nome para procurar no Instagram, quando não há @.
   *
   * É a saída honesta do problema descrito no topo do arquivo: sem chave que
   * ligue conversa a perfil, o melhor que o app pode fazer é abrir a busca.
   */
  buscar?: string;
  /** Prévia das últimas mensagens, da mais nova para a mais antiga. */
  previa?: string[];
  detalhe?: string;
  etiqueta?: string;
}

interface Props {
  lista: ListaDeAtividade;
  atividade: ActivityData;
}

function toItems(lista: ListaDeAtividade, a: ActivityData): Item[] {
  const daConversa = (c: ActivityData['conversations'][number]): Item => ({
    chave: `${c.with}-${c.lastMessageAt}`,
    titulo: c.with,
    ...(c.username ? { username: c.username } : { buscar: c.with }),
    /*
     * `?? []` e não `c.lastMessages.length`: quem importou antes de 20/08/2026
     * tem um `atividade.json` sem este campo, e o acesso direto derrubava a tela
     * inteira. O `completar` do storage já preenche, e isto é o cinto de
     * segurança — dado que veio do disco nunca tem a forma que o tipo promete.
     */
    ...((c.lastMessages ?? []).length > 0
      ? { previa: (c.lastMessages ?? []).map(previaDaMensagem) }
      : {}),
    detalhe:
      c.lastMessageAt > 0
        ? `última mensagem ${formatRelative(c.lastMessageAt)} · ${formatDate(c.lastMessageAt)}`
        : undefined,
    // Grupo precisa estar marcado: "você não respondeu" num grupo de 22 pessoas
    // não é a mesma cobrança que numa conversa de dois.
    ...(c.participantCount > 2 ? { etiqueta: `grupo de ${c.participantCount}` } : {}),
  });

  switch (lista) {
    case 'nao-respondidas':
      return a.conversations.filter((c) => c.awaitingYou).map(daConversa);

    // `?? false` nas duas: são campos de 21/08/2026, e o `atividade.json` de
    // quem importou antes não os tem. Ver `completar` em lib/storage.ts.
    case 'nunca-respondi':
      return a.conversations.filter((c) => c.neverReplied ?? false).map(daConversa);

    case 'solicitacoes':
      return a.conversations.filter((c) => c.isRequest ?? false).map(daConversa);

    case 'conversas':
      return a.conversations.map(daConversa);

    case 'comentei':
      return a.commentedOn.map((i) => ({
        chave: i.username,
        titulo: `@${i.username}`,
        username: i.username,
        detalhe:
          i.lastAt > 0 ? `último comentário em ${formatDate(i.lastAt)}` : undefined,
        etiqueta: `${formatNumber(i.count)} ${i.count === 1 ? 'comentário' : 'comentários'}`,
      }));

    case 'buscas':
      return a.profileSearches.map((b) => ({
        chave: `${b.username}-${b.at}`,
        titulo: `@${b.username}`,
        username: b.username,
        detalhe: b.at > 0 ? formatDate(b.at) : undefined,
      }));

    case 'anunciantes':
      // Achatado, com a categoria virando etiqueta: agrupar em seções faria a
      // busca (que é o motivo de a pessoa abrir uma lista de 5 mil) parar de
      // funcionar de forma óbvia.
      return a.advertisers.flatMap((g) =>
        g.advertisers.map((nome) => ({
          chave: `${g.label}-${nome}`,
          titulo: nome,
          etiqueta: g.label,
        })),
      );
  }
}

export function AtividadeListaScreen({ lista, atividade }: Props) {
  const [busca, setBusca] = useState('');
  const [falhouAoAbrir, setFalhouAoAbrir] = useState(false);
  const { explicacao, vazio } = TITULOS_ATIVIDADE[lista];

  const items = useMemo(() => toItems(lista, atividade), [lista, atividade]);
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return items;
    // A busca alcança a prévia, e não só o nome: com o texto na tela, procurar
    // pelo assunto ("aluguel", "churrasco") é a forma natural de achar de novo
    // uma conversa cujo nome não se lembra.
    return items.filter(
      (i) =>
        i.titulo.toLowerCase().includes(termo) ||
        (i.previa ?? []).some((linha) => linha.toLowerCase().includes(termo)),
    );
  }, [items, busca]);

  /*
   * Verdadeiro quando há conversa mas nenhuma tem prévia — a assinatura de um
   * `atividade.json` escrito antes de 20/08/2026. Só vale nas duas listas de
   * conversa; nas outras não existe prévia nenhuma e o aviso seria mentira.
   */
  const precisaReimportar =
    (lista === 'nao-respondidas' || lista === 'conversas') &&
    atividade.conversations.length > 0 &&
    atividade.conversations.every((c) => (c.lastMessages ?? []).length === 0);

  const abrir = (username: string) => {
    void abrirPerfil(username).then((ok) => setFalhouAoAbrir(!ok));
  };

  /*
   * Sem @ conhecido, abre a busca do Instagram pelo nome. Não é o mesmo que
   * abrir o perfil e a tela não finge que é: a pessoa cai na busca e escolhe.
   */
  const procurar = (nome: string) => {
    void buscarNoInstagram(nome).then((ok) => setFalhouAoAbrir(!ok));
  };

  return (
    <View style={s.screen}>
      <FlatList
        data={filtrados}
        keyExtractor={(item) => item.chave}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        // A lista de anunciantes passa de cinco mil linhas no arquivo real.
        initialNumToRender={20}
        windowSize={10}
        ListHeaderComponent={
          <View style={s.listHeader}>
            <Text style={s.explicacao}>{explicacao}</Text>

            {items.length > 0 ? (
              <View style={s.buscaCaixa}>
                <IconeBusca />
                <TextInput
                  style={s.buscaInput}
                  value={busca}
                  onChangeText={setBusca}
                  placeholder="Buscar"
                  placeholderTextColor={colors.inkFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              </View>
            ) : null}

            <Text style={s.count}>
              {filtrados.length === items.length
                ? formatNumber(items.length)
                : `${formatNumber(filtrados.length)} de ${formatNumber(items.length)}`}
            </Text>

            {/*
             * Arquivo antigo: as conversas existem, mas nenhuma tem prévia. Só
             * o próximo import escreve o campo — sem esta linha a pessoa fica
             * procurando um recurso que o app anunciou e que, no arquivo dela,
             * ainda não existe.
             */}
            {precisaReimportar ? (
              <Banner
                title="Envie o arquivo de novo para ver as mensagens"
                body={
                  'Suas conversas foram lidas por uma versão anterior do app, que não guardava ' +
                  'o trecho das mensagens. O próximo import já traz.'
                }
              />
            ) : null}

            {falhouAoAbrir ? (
              <Banner
                title="Não consegui abrir o Instagram"
                tone="danger"
                body={
                  'O aparelho recusou abrir o link. Se o navegador estiver bloqueando janelas ' +
                  'novas, libere para este site e tente de novo.'
                }
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View>
            <PersonRow
              username={item.titulo}
              // "comentei" e "buscas" já trazem o @ montado no título; conversa e
              // anunciante são nome de pessoa e de empresa, e não levam arroba.
              comoArroba={false}
              {...(item.detalhe ? { detail: item.detalhe } : {})}
              {...(item.etiqueta ? { badge: item.etiqueta } : {})}
              {...(item.username
                ? { onPress: () => abrir(item.username as string) }
                : item.buscar
                  ? { onPress: () => procurar(item.buscar as string) }
                  : {})}
            />

            {/*
             * A prévia fica sob a linha, recuada até onde o avatar termina, para
             * ler como continuação daquele nome e não como item novo. Duas
             * linhas no máximo, que é o que o core guarda.
             */}
            {item.previa?.length ? (
              <View style={s.previa}>
                {item.previa.map((linha, i) => (
                  <Text key={i} style={i === 0 ? s.previaRecente : s.previaAnterior}>
                    {linha}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            title="Nada por aqui"
            body={busca ? 'Nenhum resultado com esse termo.' : vazio}
          />
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  count: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  listHeader: { gap: space.sm, paddingTop: space.md, paddingBottom: space.xs },
  /*
   * Recuo de 52: o avatar tem 40 e a linha usa 12 de espaço entre ele e o texto.
   * Alinhar a prévia com o nome, e não com a borda, é o que a faz ler como
   * continuação da conversa em vez de item solto.
   */
  previa: { paddingLeft: 52, paddingRight: space.md, paddingBottom: space.sm, gap: 2 },
  previaRecente: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 17,
  },
  // A anterior é mais apagada: ela existe como contexto da mais recente.
  previaAnterior: {
    color: colors.inkFaint,
    fontSize: typography.scale.caption,
    lineHeight: 17,
  },
  explicacao: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 19 },
  buscaCaixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    marginTop: space.xs,
  },
  buscaInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: space.sm + 4,
    fontSize: typography.scale.body,
  },
});

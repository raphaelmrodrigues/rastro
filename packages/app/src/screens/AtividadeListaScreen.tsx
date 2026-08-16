/**
 * As listas que vêm do export completo.
 *
 * Uma tela para os cinco recortes, como em PeopleListScreen — a forma de ler é a
 * mesma, muda a fonte e o texto.
 *
 * Duas decisões que atravessam o arquivo:
 *
 * 1. **Conversa não abre perfil por padrão.** O arquivo da conversa traz nome de
 *    exibição, não @; o @ só existe no nome da pasta, e lá o Instagram remove os
 *    pontos. Como `ana.souza` e `anasouza` viram a mesma coisa, adivinhar
 *    mandaria a pessoa para o perfil de um estranho. Só vira link quando bate
 *    exatamente com um @ que já conhecemos das listas de seguidores.
 * 2. **Nenhum texto de mensagem aparece aqui**, nem prévia. O app não guarda
 *    isso — ver `core/src/activity.ts`.
 */

import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ActivityData } from '@rastro/core';
import { Banner, EmptyState, PersonRow } from '../components/ui';
import { IconeBusca } from '../components/icons';
import { colors, radius, space, typography } from '../lib/theme';
import { formatDate, formatNumber, formatRelative } from '../lib/format';
import { abrirPerfil } from '../lib/perfil';

export type ListaDeAtividade =
  | 'nao-respondidas'
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
      'Conversas em que a última mensagem é da outra pessoa. O app não lê o conteúdo — só ' +
      'quem falou por último e quando.',
    vazio: 'Nenhuma conversa esperando por você. Caixa de entrada em dia.',
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

interface Item {
  chave: string;
  titulo: string;
  /** @ para abrir o perfil. Ausente = a linha não é clicável. */
  username?: string;
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
    ...(c.username ? { username: c.username } : {}),
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
    return items.filter((i) => i.titulo.toLowerCase().includes(termo));
  }, [items, busca]);

  const abrir = (username: string) => {
    void abrirPerfil(username).then((ok) => setFalhouAoAbrir(!ok));
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
          <PersonRow
            username={item.titulo}
            // "comentei" e "buscas" já trazem o @ montado no título; conversa e
            // anunciante são nome de pessoa e de empresa, e não levam arroba.
            comoArroba={false}
            {...(item.detalhe ? { detail: item.detalhe } : {})}
            {...(item.etiqueta ? { badge: item.etiqueta } : {})}
            {...(item.username ? { onPress: () => abrir(item.username as string) } : {})}
          />
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

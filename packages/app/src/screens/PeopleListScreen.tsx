/**
 * Lista de pessoas. Uma tela para os seis recortes, porque a diferenca entre eles
 * e so a fonte dos dados e o texto — a forma de ler e identica.
 *
 * Cuidado central: cada item mostra o contexto temporal com a precisao correta.
 * Saida sempre em intervalo, entrada sempre em data. Ver lib/format.ts.
 */

import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  hasKnownDate,
  type Account,
  type Relationship,
  type Snapshot,
  type SnapshotDiff,
  type SnapshotInsights,
} from '@rastro/core';
import { Banner, EmptyState, PersonRow } from '../components/ui';
import { IconeBusca } from '../components/icons';
import { colors, radius, space, typography } from '../lib/theme';
import { describeEvent, formatDate, formatRelative } from '../lib/format';
import { abrirPerfil } from '../lib/perfil';
import type { ListaId } from './DashboardScreen';

interface Item {
  username: string;
  displayName?: string;
  detail?: string;
  approximate?: boolean;
  badge?: string;
}

interface Props {
  lista: ListaId;
  insights: SnapshotInsights;
  diff: SnapshotDiff | null;
  /** As listas que o usuário mantém no Instagram vêm daqui, cruas do export. */
  snapshot: Snapshot;
}

/**
 * Título e explicação de cada recorte.
 *
 * A explicação é uma frase, não um parágrafo: quem abriu esta tela quer ver os
 * nomes, e um texto longo antes da lista é um obstáculo entre a pessoa e o que
 * ela veio buscar. O que sobreviveu ao corte foi só o que muda a interpretação
 * do que está sendo mostrado — sobretudo em "deixaram de seguir", onde a data é
 * aproximada e omitir isso induziria a conclusão errada.
 */
export const TITULOS: Record<
  ListaId,
  { title: string; explicacao: string; /** Texto do estado vazio, quando "vazio" merece explicação. */ vazio?: string }
> = {
  'saíram': {
    title: 'Deixaram de seguir',
    explicacao:
      'Estas pessoas estavam na sua lista antes e não estão agora. A data é aproximada: ' +
      'mostramos o intervalo entre as duas atualizações.',
  },
  entraram: {
    title: 'Novos seguidores',
    explicacao: 'Aqui a data é exata — o próprio Instagram registra quando cada pessoa te seguiu.',
  },
  'nao-seguem-de-volta': {
    title: 'Não te seguem de volta',
    explicacao: 'Você segue estas contas e elas não seguem você.',
  },
  'voce-nao-segue': {
    title: 'Você não segue de volta',
    explicacao: 'Estas contas te seguem e você não segue de volta.',
  },
  mutuos: {
    title: 'Seguidores mútuos',
    explicacao: 'Vocês se seguem. É a base real da sua rede.',
  },
  pendentes: {
    title: 'Solicitações pendentes',
    explicacao:
      'Pedidos que você enviou e que ninguém aceitou nem recusou. Os mais antigos costumam ' +
      'ser de contas inativas.',
  },

  /*
   * As quatro abaixo são listas que a pessoa mesma montou dentro do Instagram.
   * O texto não pode dar a entender que o Rastro descobriu algo: ele só está
   * mostrando, num lugar onde dá para buscar e contar, o que o app do Instagram
   * esconde em telas de configuração.
   *
   * O `vazio` existe porque em todas elas a lista vazia é o caso comum e é uma
   * informação boa — mas também pode significar que o arquivo veio sem aquele
   * pedaço, e o texto genérico ("nada por aqui") não distingue as duas coisas.
   */
  'deixei-de-seguir': {
    title: 'Você deixou de seguir',
    explicacao:
      'Contas que você parou de seguir. O Instagram guarda essa lista dos últimos meses, ' +
      'então ela não cobre a sua conta inteira.',
    vazio: 'Nada aqui. Ou você não deixou ninguém recentemente, ou seu arquivo veio sem essa parte.',
  },
  bloqueados: {
    title: 'Contas bloqueadas',
    explicacao: 'Contas que você bloqueou. Elas não conseguem ver seu perfil nem falar com você.',
    vazio: 'Você não bloqueou ninguém — ou seu arquivo veio sem essa parte.',
  },
  'amigos-proximos': {
    title: 'Melhores amigos',
    explicacao:
      'Sua lista de melhores amigos: só estas contas veem os stories que você publica com o ' +
      'círculo verde.',
    vazio: 'Sua lista de melhores amigos está vazia — ou seu arquivo veio sem essa parte.',
  },
  restritos: {
    title: 'Contas restritas',
    explicacao:
      'Contas que você restringiu. Elas continuam te seguindo, mas os comentários delas só ' +
      'aparecem para elas mesmas, e você não recebe aviso de mensagem.',
    vazio: 'Você não restringiu ninguém — ou seu arquivo veio sem essa parte.',
  },
};

function toItems(
  lista: ListaId,
  insights: SnapshotInsights,
  diff: SnapshotDiff | null,
  snapshot: Snapshot,
): Item[] {
  const daRelationship = (r: Relationship, prefixo: string): Item => ({
    username: r.username,
    ...(r.displayName ? { displayName: r.displayName } : {}),
    detail: `${prefixo} ${formatDate(r.since)}`,
  });

  /**
   * Lista crua do export, do mais recente para o mais antigo.
   *
   * A data só é exibida quando veio mesmo do arquivo. Quando o export não traz
   * data, o parser preenche `since` com o instante do import — mostrar isso
   * daria a alguém a impressão de ter bloqueado uma conta hoje, quando o app não
   * faz ideia de quando foi. Ver `hasKnownDate` no core.
   */
  const doExport = (kind: 'recentlyUnfollowed' | 'blocked' | 'closeFriends' | 'restricted', prefixo: string): Item[] =>
    snapshot.relationships[kind]
      .slice()
      .sort((a, b) => b.since - a.since)
      .map((r) =>
        hasKnownDate(r, snapshot)
          ? daRelationship(r, prefixo)
          : {
              username: r.username,
              ...(r.displayName ? { displayName: r.displayName } : {}),
            },
      );

  switch (lista) {
    case 'saíram':
      return (diff?.lost ?? []).map((event) => ({
        username: event.username,
        detail: describeEvent(event),
        // Saida nunca tem instante conhecido: marcar como aproximado sempre.
        approximate: true,
        ...(event.suspectedRename
          ? { badge: `talvez seja @${event.suspectedRename.counterpart}` }
          : {}),
      }));

    case 'entraram':
      return (diff?.gained ?? []).map((event) => ({
        username: event.username,
        detail: describeEvent(event),
      }));

    case 'nao-seguem-de-volta':
      return insights.notFollowingYouBack.map((a: Account) => ({
        username: a.username,
        ...(a.displayName ? { displayName: a.displayName } : {}),
      }));

    case 'voce-nao-segue':
      return insights.youDontFollowBack.map((a: Account) => ({
        username: a.username,
        ...(a.displayName ? { displayName: a.displayName } : {}),
      }));

    case 'mutuos':
      return insights.mutuals.map((a: Account) => ({
        username: a.username,
        ...(a.displayName ? { displayName: a.displayName } : {}),
      }));

    case 'pendentes':
      return insights.pendingRequestsSent
        .slice()
        .sort((a, b) => a.since - b.since)
        .map((r) => ({
          ...daRelationship(r, 'enviado em'),
          badge: formatRelative(r.since),
        }));

    case 'deixei-de-seguir':
      return doExport('recentlyUnfollowed', 'você deixou de seguir em');

    case 'bloqueados':
      return doExport('blocked', 'bloqueado em');

    case 'amigos-proximos':
      return doExport('closeFriends', 'adicionado em');

    case 'restritos':
      return doExport('restricted', 'restringido em');
  }
}

export function PeopleListScreen({ lista, insights, diff, snapshot }: Props) {
  const [busca, setBusca] = useState('');
  // Só aparece se o aparelho recusar tanto o app quanto o navegador. Raro, mas
  // silenciar seria pior: o usuário ficaria tocando numa linha que não responde.
  const [falhouAoAbrir, setFalhouAoAbrir] = useState(false);
  const { explicacao, vazio } = TITULOS[lista];

  const items = useMemo(
    () => toItems(lista, insights, diff, snapshot),
    [lista, insights, diff, snapshot],
  );
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return items;
    return items.filter(
      (i) =>
        i.username.includes(termo) || (i.displayName ?? '').toLowerCase().includes(termo),
    );
  }, [items, busca]);

  const renames = lista === 'saíram' ? (diff?.renames ?? []) : [];

  const abrir = (username: string) => {
    void abrirPerfil(username).then((ok) => setFalhouAoAbrir(!ok));
  };

  return (
    <View style={s.screen}>
      <FlatList
        data={filtrados}
        keyExtractor={(item) => item.username}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
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
                ? `${items.length} ${items.length === 1 ? 'pessoa' : 'pessoas'}`
                : `${filtrados.length} de ${items.length}`}
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

            {renames.length > 0 ? (
              <Banner
                title={`${renames.length} ${renames.length === 1 ? 'conta trocou' : 'contas trocaram'} de @`}
                body="Elas continuam te seguindo, só mudaram de nome de usuário. Não contamos como saída."
              />
            ) : null}
          </View>
        }
        /*
         * Aro colorido só na lista de quem entrou: é a única em que o destaque
         * significa alguma coisa, e a única que o usuário abre com expectativa
         * boa. Nas outras ele seria enfeite — e enfeite numa lista de quem saiu
         * é de mau gosto.
         */
        renderItem={({ item }) => (
          <PersonRow
            username={item.username}
            {...(item.displayName ? { displayName: item.displayName } : {})}
            {...(item.detail ? { detail: item.detail } : {})}
            {...(item.approximate ? { approximate: true } : {})}
            {...(item.badge ? { badge: item.badge } : {})}
            {...(lista === 'entraram' ? { destaque: true } : {})}
            onPress={() => abrir(item.username)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="Nada por aqui"
            body={
              busca
                ? 'Nenhuma conta com esse termo.'
                : (vazio ??
                  'Esta lista está vazia — o que, dependendo da lista, é uma boa notícia.')
            }
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

  /** Busca no formato de campo arredondado, como nas listas de seguidores. */
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

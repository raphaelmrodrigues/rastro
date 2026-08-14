/**
 * Lista de pessoas. Uma tela para os seis recortes, porque a diferenca entre eles
 * e so a fonte dos dados e o texto — a forma de ler e identica.
 *
 * Cuidado central: cada item mostra o contexto temporal com a precisao correta.
 * Saida sempre em intervalo, entrada sempre em data. Ver lib/format.ts.
 */

import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Account, Relationship, SnapshotDiff, SnapshotInsights } from '@rastro/core';
import { Banner, Button, EmptyState, PersonRow } from '../components/ui';
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
  onBack: () => void;
}

const TITULOS: Record<ListaId, { title: string; explicacao: string }> = {
  'saíram': {
    title: 'Deixaram de seguir',
    explicacao:
      'O app compara dois imports. Ele sabe que estas pessoas estavam na sua lista antes ' +
      'e não estão agora — mas não sabe o dia exato em que cada uma saiu, só o intervalo.',
  },
  entraram: {
    title: 'Novos seguidores',
    explicacao:
      'Aqui a data é exata: o próprio arquivo do Instagram registra o momento em que cada ' +
      'pessoa passou a te seguir.',
  },
  'nao-seguem-de-volta': {
    title: 'Não te seguem de volta',
    explicacao: 'Você segue estas contas e elas não seguem você. A data é de quando você começou a seguir.',
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
      'Pedidos que você enviou e que nunca foram aceitos nem recusados. Os mais antigos ' +
      'costumam ser de contas inativas — dá para limpar.',
  },
};

function toItems(lista: ListaId, insights: SnapshotInsights, diff: SnapshotDiff | null): Item[] {
  const daRelationship = (r: Relationship, prefixo: string): Item => ({
    username: r.username,
    ...(r.displayName ? { displayName: r.displayName } : {}),
    detail: `${prefixo} ${formatDate(r.since)}`,
  });

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
  }
}

export function PeopleListScreen({ lista, insights, diff, onBack }: Props) {
  const [busca, setBusca] = useState('');
  // So aparece se o aparelho recusar tanto o app quanto o navegador. Raro, mas
  // silenciar seria pior: o usuario ficaria tocando numa linha que nao responde.
  const [falhouAoAbrir, setFalhouAoAbrir] = useState(false);
  const { title, explicacao } = TITULOS[lista];

  const items = useMemo(() => toItems(lista, insights, diff), [lista, insights, diff]);
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
      <View style={s.header}>
        <Button label="Voltar" variant="ghost" onPress={onBack} />
        <Text style={s.title}>{title}</Text>
        <Text style={s.count}>
          {filtrados.length}
          {filtrados.length !== items.length ? ` de ${items.length}` : ''}
        </Text>
      </View>

      <FlatList
        data={filtrados}
        keyExtractor={(item) => item.username}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View style={s.listHeader}>
            <Text style={s.explicacao}>{explicacao}</Text>
            <Text style={s.dica}>Toque em qualquer linha para abrir o perfil no Instagram.</Text>

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
                title={`${renames.length} conta(s) só trocaram de @`}
                body={
                  'Elas continuam te seguindo, com outro nome de usuário. Não estão contadas ' +
                  'como saída — a maioria dos apps do gênero conta, e o número fica errado.'
                }
              />
            ) : null}

            {items.length > 0 ? (
              <TextInput
                style={s.input}
                value={busca}
                onChangeText={setBusca}
                placeholder="Buscar @ ou nome"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <PersonRow
            username={item.username}
            {...(item.displayName ? { displayName: item.displayName } : {})}
            {...(item.detail ? { detail: item.detail } : {})}
            {...(item.approximate ? { approximate: true } : {})}
            {...(item.badge ? { badge: item.badge } : {})}
            onPress={() => abrir(item.username)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="Nada por aqui"
            body={
              busca
                ? 'Nenhuma conta com esse termo.'
                : 'Esta lista está vazia neste import — o que, dependendo da lista, é uma boa notícia.'
            }
          />
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.xs },
  title: { color: colors.ink, fontSize: typography.scale.title },
  count: { color: colors.inkFaint, fontSize: typography.scale.caption },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  listHeader: { gap: space.sm, paddingBottom: space.sm },
  explicacao: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
    marginTop: space.sm,
  },
  dica: { color: colors.inkFaint, fontSize: typography.scale.micro },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    marginTop: space.sm,
    fontSize: typography.scale.body,
  },
});

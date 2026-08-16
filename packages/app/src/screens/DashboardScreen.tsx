/**
 * Aba Início — a tela que o usuário abre depois do primeiro import.
 *
 * Ordem de leitura deliberada:
 *   1. avisos sobre a qualidade do próprio import (se o dado está torto, isso vem
 *      antes de qualquer número, não como rodapé);
 *   2. o retrato da rede hoje, no formato de contadores que todo perfil de rede
 *      social usa — é o que o olho procura primeiro;
 *   3. o que mudou desde o import anterior;
 *   4. atalhos para as listas.
 *
 * O usuário chega ansioso para ver "quem saiu". Justamente por isso o aviso de
 * export incompleto vem antes: é o único momento em que ele para para ler.
 *
 * Sobre o texto: nada aqui explica como o app funciona por dentro. A explicação
 * sobre precisão de datas ficou, porque ela muda o que o usuário conclui do que
 * está vendo — mas em uma frase, não em parágrafo.
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Reports } from '../lib/store';
import type { Snapshot } from '@rastro/core';
import { Avatar, Banner, Button, MenuRow, SectionTitle, StatCard, StatRow } from '../components/ui';
import { colors, space, typography } from '../lib/theme';
import { formatDate, formatNumber, formatRelative, formatSigned } from '../lib/format';

export type ListaId =
  | 'saíram'
  | 'entraram'
  | 'nao-seguem-de-volta'
  | 'voce-nao-segue'
  | 'mutuos'
  | 'pendentes'
  /*
   * As quatro abaixo saem direto de `snapshot.relationships`, e não de um
   * cálculo sobre seguidores. São listas que o usuário mantém dentro do
   * Instagram e que o export entrega prontas — o app só as torna visíveis e
   * pesquisáveis, coisa que o próprio Instagram não faz bem.
   */
  | 'deixei-de-seguir'
  | 'bloqueados'
  | 'amigos-proximos'
  | 'restritos';

interface Props {
  snapshot: Snapshot;
  reports: Reports;
  handle: string | null;
  onOpenList: (lista: ListaId) => void;
  onOpenStats: () => void;
  onImportAgain: () => void;
  onOpenAtividade: () => void;
  /**
   * Convite para criar conta, ou `null` quando não é hora de mostrar.
   *
   * Vem pronto de cima em vez de a tela decidir: quem sabe se há conta é o
   * `useConta`, e o painel não deveria precisar conhecer o estado de sessão para
   * desenhar seguidores.
   */
  convite?: ReactNode;
  /**
   * Quantas conversas esperam resposta, ou `null` quando o usuário ainda não
   * mandou o export completo — que é o caso da maioria, já que o onboarding
   * pede o arquivo rápido.
   */
  conversasPendentes: number | null;
}

/** Dias após os quais vale a pena reimportar. Abaixo disso, o diff diz pouco. */
const DIAS_PARA_REIMPORTAR = 14;

export function DashboardScreen({
  snapshot,
  reports,
  handle,
  onOpenList,
  onOpenStats,
  onImportAgain,
  onOpenAtividade,
  conversasPendentes,
  convite,
}: Props) {
  const { insights, diff } = reports;
  const diasDesdeImport = Math.floor((Date.now() - snapshot.importedAt) / 86_400_000);
  const exportParcial = snapshot.warnings.find((w) => w.code === 'PARTIAL_EXPORT');

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {/* Cabeçalho de perfil: avatar, @ e data — igual ao topo de um perfil. */}
      <View style={s.perfil}>
        <Avatar username={handle ?? 'rastro'} size={64} />
        <View style={s.perfilTexto}>
          <Text style={s.handle}>{handle ? `@${handle}` : 'Sua conta'}</Text>
          <Text style={s.desde}>
            Atualizado {formatRelative(snapshot.importedAt)} · {formatDate(snapshot.importedAt)}
          </Text>
        </View>
      </View>

      <StatRow
        itens={[
          { label: 'Seguidores', value: formatNumber(insights.followerCount) },
          { label: 'Seguindo', value: formatNumber(insights.followingCount) },
          {
            label: 'Mútuos',
            value: formatNumber(insights.mutuals.length),
            onPress: () => onOpenList('mutuos'),
          },
        ]}
      />

      {/* Qualidade do dado antes do dado. */}
      {exportParcial ? (
        <Banner
          tone="warning"
          title="Este arquivo não traz sua lista completa"
          body={exportParcial.detail}
        />
      ) : null}

      {convite}

      {diff && diff.reliability.level === 'suspect' ? (
        <Banner
          tone="warning"
          title="Esta comparação pode estar errada"
          body={diff.reliability.reasons.join(' ')}
        />
      ) : null}

      {diff ? (
        <>
          <SectionTitle>O que mudou</SectionTitle>
          <View style={s.row}>
            <StatCard label="Entraram" value={formatSigned(diff.gained.length)} tone="gained" />
            <StatCard label="Saíram" value={formatNumber(diff.lost.length)} tone="lost" />
          </View>
          <View style={s.row}>
            <StatCard label="Saldo" value={formatSigned(diff.netChange)} />
            <StatCard
              label="Trocaram de @"
              value={formatNumber(diff.renames.length)}
              hint={diff.renames.length > 0 ? 'continuam te seguindo' : undefined}
            />
          </View>

          <View style={s.acoes}>
            <Button
              label={`Ver quem saiu (${diff.lost.length})`}
              onPress={() => onOpenList('saíram')}
            />
            <Button
              label={`Ver quem entrou (${diff.gained.length})`}
              variant="secondary"
              onPress={() => onOpenList('entraram')}
            />
          </View>
        </>
      ) : (
        <Banner
          title="Volte depois do próximo arquivo"
          body={
            'Este é o seu primeiro arquivo, e ele é o ponto de partida. Quem saiu e quem entrou ' +
            'aparece a partir do segundo — é a diferença entre os dois que revela as mudanças.'
          }
        />
      )}

      <SectionTitle>Suas listas</SectionTitle>
      <View style={s.lista}>
        <MenuRow
          label="Não te seguem de volta"
          value={formatNumber(insights.notFollowingYouBack.length)}
          onPress={() => onOpenList('nao-seguem-de-volta')}
        />
        <MenuRow
          label="Você não segue de volta"
          value={formatNumber(insights.youDontFollowBack.length)}
          onPress={() => onOpenList('voce-nao-segue')}
        />
        <MenuRow
          label="Seguidores mútuos"
          value={formatNumber(insights.mutuals.length)}
          onPress={() => onOpenList('mutuos')}
        />
        <MenuRow
          label="Solicitações pendentes"
          value={formatNumber(insights.pendingRequestsSent.length)}
          onPress={() => onOpenList('pendentes')}
        />
        <MenuRow label="Evolução e estatísticas" onPress={onOpenStats} />
        {/*
         * A entrada da Atividade fica aqui, na tela inicial, e não numa sexta
         * aba: cinco já é o limite do que cabe numa barra de celular sem os
         * rótulos se atropelarem — é o número que o próprio Instagram usa.
         *
         * O contador some quando ainda não há export completo, e aí a linha vira
         * o convite. Mostrar "0" convidaria a pessoa a abrir esperando conteúdo.
         */}
        <MenuRow
          label="Conversas e atividade"
          value={
            conversasPendentes === null
              ? 'ver mais'
              : `${formatNumber(conversasPendentes)} sem resposta`
          }
          onPress={onOpenAtividade}
        />
      </View>

      {diasDesdeImport >= DIAS_PARA_REIMPORTAR ? (
        <Banner
          tone="warning"
          title="Hora de atualizar"
          body={`Faz ${diasDesdeImport} dias desde a última atualização. Quanto mais seguido você atualiza, mais preciso fica o "quando" de cada saída.`}
          action={
            <View style={s.acaoBanner}>
              <Button label="Atualizar agora" onPress={onImportAgain} />
            </View>
          }
        />
      ) : null}

      <Text style={s.nota}>
        A data de quem entrou é exata. A de quem saiu é aproximada: o Instagram não registra o
        momento em que alguém deixa de seguir, então o app mostra o intervalo entre as duas
        atualizações.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.lg, paddingBottom: space.xl },

  perfil: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  perfilTexto: { flex: 1, gap: 2 },
  handle: {
    color: colors.ink,
    fontSize: typography.scale.title,
    fontWeight: typography.weight.bold,
  },
  desde: { color: colors.inkMuted, fontSize: typography.scale.caption },

  row: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  acoes: { gap: space.sm, marginTop: space.sm },
  lista: { marginTop: space.xs },
  acaoBanner: { marginTop: space.sm },
  nota: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    lineHeight: 17,
    marginTop: space.lg,
  },
});

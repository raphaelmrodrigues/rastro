/**
 * As duas barras fixas que emolduram o app: cabeçalho em cima, abas embaixo.
 *
 * É a estrutura de todo app de rede social, e a razão de copiá-la é prática: o
 * usuário não gasta um segundo aprendendo onde as coisas estão. As abas embaixo
 * também são a única posição alcançável pelo polegar em telas grandes — menu no
 * topo obriga a trocar a mão de posição a cada toque.
 *
 * Regra que não deve ser quebrada: a barra de abas fica **fora** da área que
 * rola. Ela precisa estar sempre visível; uma navegação que some quando a lista
 * é longa é a mesma coisa que não existir, e as listas aqui têm centenas de @s.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, typography, chrome } from '../lib/theme';
import { Logotipo } from './Marca';
import {
  IconeInicio,
  IconePessoas,
  IconeImportar,
  IconeEvolucao,
  IconePerfil,
  IconeVoltar,
} from './icons';

export type Aba = 'inicio' | 'pessoas' | 'importar' | 'evolucao' | 'perfil';

/**
 * Cabeçalho.
 *
 * Em duas formas: com a marca (nas telas de aba, como a tela inicial de
 * qualquer app) ou com voltar e título (nas telas empilhadas). Nunca as duas —
 * marca junto de botão voltar confunde o que é raiz e o que é profundidade.
 */
export function Header({
  titulo,
  onVoltar,
  acao,
}: {
  titulo?: string;
  onVoltar?: () => void;
  acao?: ReactNode;
}) {
  return (
    <View style={s.header}>
      {onVoltar ? (
        <Pressable
          onPress={onVoltar}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={12}
          style={({ pressed }) => [s.voltar, pressed && s.pressed]}
        >
          <IconeVoltar />
        </Pressable>
      ) : null}

      {titulo ? (
        <Text style={s.titulo} numberOfLines={1}>
          {titulo}
        </Text>
      ) : (
        <Logotipo size="pequeno" />
      )}

      <View style={s.headerAcao}>{acao}</View>
    </View>
  );
}

const ABAS: Array<{
  id: Aba;
  rotulo: string;
  Icone: (p: { size?: number; cor?: string; ativo?: boolean }) => ReactNode;
}> = [
  { id: 'inicio', rotulo: 'Início', Icone: IconeInicio },
  { id: 'pessoas', rotulo: 'Pessoas', Icone: IconePessoas },
  { id: 'importar', rotulo: 'Importar', Icone: IconeImportar },
  { id: 'evolucao', rotulo: 'Evolução', Icone: IconeEvolucao },
  { id: 'perfil', rotulo: 'Perfil', Icone: IconePerfil },
];

export function TabBar({ ativa, aoTrocar }: { ativa: Aba; aoTrocar: (aba: Aba) => void }) {
  return (
    <View style={s.tabBar}>
      {ABAS.map(({ id, rotulo, Icone }) => {
        const selecionada = id === ativa;
        return (
          <Pressable
            key={id}
            onPress={() => aoTrocar(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: selecionada }}
            accessibilityLabel={rotulo}
            style={({ pressed }) => [s.tab, pressed && s.pressed]}
          >
            <Icone cor={selecionada ? colors.gained : colors.inkFaint} ativo={selecionada} />
            {/*
             * Rótulo sob o ícone: ícone sozinho é adivinhação, e o custo de
             * onze pixels de altura é menor que o de um usuário que não acha a
             * tela de importar.
             */}
            <Text style={[s.tabRotulo, selecionada && s.tabRotuloAtivo]}>{rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    height: chrome.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.base,
  },
  voltar: { padding: space.xs, marginLeft: -space.xs },
  titulo: {
    flex: 1,
    color: colors.ink,
    fontSize: typography.scale.section,
    fontWeight: typography.weight.semibold,
  },
  headerAcao: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: space.sm },

  tabBar: {
    height: chrome.tabBarHeight,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.base,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabRotulo: { color: colors.inkFaint, fontSize: typography.scale.micro - 1 },
  tabRotuloAtivo: { color: colors.gained, fontWeight: typography.weight.medium },

  pressed: { opacity: 0.55 },
});

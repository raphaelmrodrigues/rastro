/**
 * A fila de faxina, uma conta por vez.
 *
 * O que esta tela faz e o que ela **não** faz está no topo de `lib/fila.ts`, e
 * vale repetir a parte que muda o texto: o app não executa nada na conta de
 * ninguém. Ele abre o perfil no Instagram e guarda o lugar na fila. Quem toca em
 * "Deixar de seguir" é a pessoa, dentro do app do Instagram.
 *
 * Por isso todo texto aqui é na primeira pessoa dela — "Deixei de seguir", e não
 * "Pronto, deixamos de seguir". O app não sabe se aconteceu, e escrever como se
 * soubesse seria mentir sobre a única coisa que este produto vende, que é não
 * mentir sobre o que sabe.
 *
 * ## A ordem dos botões
 *
 * "Abrir no Instagram" é o único botão até a pessoa ter aberto o perfil. Só
 * depois aparecem "Deixei de seguir" e "Pular". Confirmar antes de abrir seria
 * oferecer um jeito de varrer a fila sem fazer nada — e uma fila falsamente
 * limpa é pior que fila nenhuma, porque as mesmas contas voltam no próximo
 * import sem explicação.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar, Banner, Button, EmptyState, Gradiente } from '../components/ui';
import { IconeExterno } from '../components/icons';
import { abrirPerfil } from '../lib/perfil';
import { progresso, resolver, TEXTO_DA_ACAO, type Fila } from '../lib/fila';
import { colors, gradients, heading, radius, space, typography } from '../lib/theme';

interface Props {
  fila: Fila;
  onMudar: (fila: Fila) => void;
  /** Fecha a tela e **mantém** a fila. O lugar guardado é o ponto do recurso. */
  onSair: () => void;
  /** Joga a fila fora. Só no fim, ou quando a pessoa pede explicitamente. */
  onDescartar: () => void;
}

export function FilaScreen({ fila, onMudar, onSair, onDescartar }: Props) {
  /* Se o perfil do topo já foi aberto. Reinicia a cada conta. */
  const [abriu, setAbriu] = useState(false);
  const [falhouAoAbrir, setFalhouAoAbrir] = useState(false);

  const atual = fila.pendentes[0];
  const { feitas, total } = progresso(fila);
  const texto = TEXTO_DA_ACAO[fila.acao];

  if (!atual) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
        <EmptyState
          title="Fila concluída"
          body={
            `Você resolveu ${fila.feitos.length} de ${total} ${total === 1 ? 'conta' : 'contas'}. ` +
            'O resultado só aparece no Rastro depois que você enviar um arquivo novo — é o ' +
            'próximo export que confirma o que mudou de verdade.'
          }
        />
        <Button label="Concluir" onPress={onDescartar} />
      </ScrollView>
    );
  }

  const abrir = () => {
    setAbriu(true);
    void abrirPerfil(atual).then((ok) => setFalhouAoAbrir(!ok));
  };

  const seguir = (como: 'feito' | 'pulado') => {
    setAbriu(false);
    setFalhouAoAbrir(false);
    onMudar(resolver(fila, atual, como));
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      {/* Progresso: o número é o que sustenta a paciência numa fila de 300. */}
      <View style={s.progresso}>
        <View style={s.barra}>
          <Gradiente style={[s.barraCheia, { width: `${Math.round((feitas / total) * 100)}%` }]} />
        </View>
        <Text style={s.contagem}>
          {feitas} de {total}
        </Text>
      </View>

      <View style={s.cartao}>
        <Avatar username={atual} size={72} />
        <Text style={s.handle}>@{atual}</Text>
        <Text style={s.instrucao}>{texto.comoFazer}</Text>

        <Pressable
          onPress={abrir}
          accessibilityRole="button"
          style={({ pressed }) => [s.abrirFora, pressed && s.pressed]}
        >
          <Gradiente style={s.abrir}>
            <IconeExterno size={16} cor={colors.ink} />
            <Text style={s.abrirLabel}>
              {abriu ? 'Abrir de novo' : `Abrir @${atual} no Instagram`}
            </Text>
          </Gradiente>
        </Pressable>
      </View>

      {falhouAoAbrir ? (
        <Banner
          title="Não consegui abrir o Instagram"
          tone="danger"
          body="O aparelho recusou abrir o link. Você pode pular esta conta e seguir a fila."
        />
      ) : null}

      {/*
       * Os dois botões de desfecho só existem depois de a pessoa ter aberto o
       * perfil. Ver a nota sobre a ordem dos botões, no topo do arquivo.
       */}
      {abriu ? (
        <View style={s.desfecho}>
          <Button label={texto.confirmar} onPress={() => seguir('feito')} />
          <Button label="Pular esta" variant="secondary" onPress={() => seguir('pulado')} />
        </View>
      ) : (
        <Text style={s.dica}>
          Abra o perfil, faça a alteração dentro do Instagram e volte aqui. O Rastro guarda o seu
          lugar na fila — dá para parar no meio e continuar depois.
        </Text>
      )}

      {/*
       * Sair **não** apaga a fila: quem sai daqui costuma estar indo conferir
       * outra lista, e perder 200 marcações por isso seria o pior desfecho
       * possível. Descartar é uma escolha à parte, logo abaixo.
       */}
      <Pressable onPress={onSair} accessibilityRole="button">
        <Text style={s.sair}>Sair e continuar depois</Text>
      </Pressable>

      <Pressable onPress={onDescartar} accessibilityRole="button">
        <Text style={s.descartar}>Descartar esta fila</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  conteudo: { padding: space.lg, paddingBottom: space.xl, gap: space.md },

  progresso: { gap: space.sm },
  barra: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barraCheia: { height: 4, borderRadius: radius.pill },
  contagem: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  cartao: {
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  handle: { ...heading.title, color: colors.ink, textAlign: 'center' },
  instrucao: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
    textAlign: 'center',
  },

  abrirFora: { borderRadius: radius.md, overflow: 'hidden', alignSelf: 'stretch' },
  abrir: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.md,
  },
  abrirLabel: {
    color: colors.ink,
    fontFamily: typography.display.semibold,
    fontSize: typography.scale.body,
  },
  pressed: { opacity: 0.7 },

  desfecho: { gap: space.sm },
  dica: {
    color: colors.inkFaint,
    fontSize: typography.scale.caption,
    lineHeight: 19,
    textAlign: 'center',
  },
  sair: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    paddingVertical: space.md,
  },
  descartar: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textAlign: 'center',
  },
});

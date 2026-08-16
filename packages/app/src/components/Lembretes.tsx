/**
 * Escolha do lembrete de atualização.
 *
 * O texto aqui tem um trabalho específico: não deixar a pessoa achar que o app
 * vai avisar **na hora** em que alguém deixar de segui-la. Esse é o recurso que
 * os concorrentes anunciam, é o que ela espera ao ver a palavra "notificação", e
 * é o que este app não faz — porque só dá para saber quem saiu lendo a lista de
 * seguidores, e a lista só chega pelo arquivo que ela mesma pede.
 *
 * Prometer aqui e entregar outra coisa seria a pior troca possível: a pessoa
 * desliga a notificação na primeira vez que percebe, e nunca mais liga.
 */

import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, SectionTitle } from './ui';
import {
  INTERVALOS,
  ativarLembrete,
  desativarLembrete,
  lembretesDisponiveis,
  lerIntervalo,
  type IntervaloDeLembrete,
} from '../lib/notificacoes';
import { colors, radius, space, typography } from '../lib/theme';

interface Props {
  /** Quando foi o último import, para o lembrete contar a partir dali. */
  ultimaAtualizacao: number | null;
}

export function Lembretes({ ultimaAtualizacao }: Props) {
  const [escolhido, setEscolhido] = useState<IntervaloDeLembrete | null>(null);
  const [negada, setNegada] = useState(false);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    void lerIntervalo().then(setEscolhido);
  }, []);

  // No navegador não há notificação agendada; a seção some em vez de mostrar
  // botões que não fazem nada.
  if (!lembretesDisponiveis()) return null;

  const escolher = async (dias: IntervaloDeLembrete | null) => {
    setNegada(false);
    setFalhou(false);

    if (dias === null) {
      await desativarLembrete();
      setEscolhido(null);
      return;
    }

    const resultado = await ativarLembrete(dias, ultimaAtualizacao);
    if (resultado.ok) {
      setEscolhido(dias);
      return;
    }
    // O estado só muda quando o agendamento deu certo. Marcar a opção antes
    // mostraria um lembrete ligado que o sistema nunca vai disparar.
    if (resultado.motivo === 'sem-permissao') setNegada(true);
    else setFalhou(true);
  };

  return (
    <View style={s.bloco}>
      <SectionTitle>Lembretes</SectionTitle>

      <Text style={s.explicacao}>
        O Rastro avisa quando estiver na hora de pedir um arquivo novo ao Instagram. Ele não
        consegue avisar no momento em que alguém deixa de seguir — isso só aparece quando você
        envia um arquivo novo.
      </Text>

      <View style={s.opcoes}>
        <Opcao rotulo="Desligado" ativo={escolhido === null} onPress={() => void escolher(null)} />
        {INTERVALOS.map((intervalo) => (
          <Opcao
            key={intervalo.dias}
            rotulo={intervalo.rotulo}
            ativo={escolhido === intervalo.dias}
            onPress={() => void escolher(intervalo.dias)}
          />
        ))}
      </View>

      {negada ? (
        <Banner
          title="As notificações estão bloqueadas"
          body="O aparelho não está deixando o Rastro avisar você. Libere as notificações do Rastro nos ajustes do celular e escolha de novo aqui."
          tone="warning"
          action={
            <Text style={s.link} accessibilityRole="button" onPress={() => void Linking.openSettings()}>
              Abrir os ajustes
            </Text>
          }
        />
      ) : null}

      {falhou ? (
        <Banner
          title="Não deu para programar o lembrete"
          body="Tente de novo daqui a pouco. Nada mais do app foi afetado."
          tone="warning"
        />
      ) : null}
    </View>
  );
}

function Opcao({
  rotulo,
  ativo,
  onPress,
}: {
  rotulo: string;
  ativo: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: ativo }}
      style={({ pressed }) => [s.opcao, ativo && s.opcaoAtiva, pressed && s.pressionada]}
    >
      <Text style={[s.opcaoTexto, ativo && s.opcaoTextoAtivo]}>{rotulo}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bloco: { gap: space.sm },
  explicacao: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
  },
  opcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  opcao: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  opcaoAtiva: { borderColor: colors.gained, backgroundColor: colors.surface },
  pressionada: { opacity: 0.6 },
  opcaoTexto: { color: colors.inkMuted, fontSize: typography.scale.caption },
  opcaoTextoAtivo: { color: colors.ink, fontWeight: typography.weight.semibold },
  link: {
    color: colors.gained,
    fontSize: typography.scale.caption,
    fontWeight: typography.weight.semibold,
    marginTop: space.sm,
  },
});

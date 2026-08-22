/**
 * O que a vistoria encontrou, na tela.
 *
 * ## Por que é um modal e não um aviso no painel
 *
 * Porque a decisão é agora. Um arquivo recortado que entra vira a base de
 * comparação do próximo import, e a partir daí o app afirma, com nome e
 * sobrenome, que centenas de pessoas deixaram de seguir — o `MASS_LOSS` medido
 * no arquivo do dono são 1.137 pessoas que não foram a lugar nenhum. Depois de
 * salvo não há desfazer que valha: o estrago é a confiança na lista.
 *
 * Então este componente interrompe. É o único lugar do app que faz isso, e por
 * isso ele precisa dar em troca o que a interrupção custa: o número concreto que
 * o app viu, e o que fazer a respeito.
 *
 * ## O que ele não faz
 *
 * Não mostra `warn`. Aviso que não muda a decisão não merece uma parede: quem
 * mandou o export sem conversas fez um import válido, e descobre a aba Atividade
 * vazia com a explicação no lugar dela.
 *
 * A lógica de decidir está em `packages/core/src/completeness.ts`, e é lá que
 * ela deve continuar: este arquivo desenha, não julga.
 */

import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ExportCheck, ExportProblem } from '@rastro/core';
import { Button } from './ui';
import { colors, heading, radius, space, typography } from '../lib/theme';

export function VistoriaDoArquivo({
  check,
  onConfirmar,
  onDescartar,
  onVerComoPedir,
}: {
  /** `null` fecha o modal. */
  check: ExportCheck | null;
  /** Só existe quando o arquivo passou e falta a palavra do usuário. */
  onConfirmar?: () => void;
  onDescartar: () => void;
  /** Abre o passo a passo de pedir o export. */
  onVerComoPedir: () => void;
}) {
  if (!check) return null;

  const visiveis = check.problems.filter((p) => p.severity !== 'warn');
  if (visiveis.length === 0) return null;

  const bloqueado = !check.ok;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDescartar}>
      <View style={s.fundo}>
        <View style={s.caixa}>
          <ScrollView
            contentContainerStyle={s.conteudo}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={s.titulo}>
              {bloqueado ? 'Este arquivo não serve' : 'Confira antes de guardar'}
            </Text>
            <Text style={s.abertura}>
              {bloqueado
                ? 'Ele não foi guardado. Guardar um arquivo assim faria o app dizer que ' +
                  'pessoas saíram sem elas terem saído.'
                : 'O arquivo foi lido e está pronto. Só uma coisa depende de você.'}
            </Text>

            {visiveis.map((p) => (
              <Problema key={p.code} problema={p} />
            ))}
          </ScrollView>

          <View style={s.acoes}>
            {bloqueado ? (
              <>
                <Button label="Ver como pedir o certo" onPress={onVerComoPedir} />
                <Button label="Fechar" variant="ghost" onPress={onDescartar} />
              </>
            ) : (
              <>
                {/*
                 * O rótulo afirma em primeira pessoa, e não "Continuar": quem
                 * toca aqui está declarando que conferiu o número no Instagram.
                 * "Continuar" seria só o caminho de menor esforço, e a pergunta
                 * inteira perderia o sentido.
                 */}
                <Button label="Conferi, pode guardar" onPress={onConfirmar ?? onDescartar} />
                <Button label="Vou pedir o arquivo de novo" variant="ghost" onPress={onDescartar} />
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Problema({ problema }: { problema: ExportProblem }) {
  const bloqueio = problema.severity === 'block';
  return (
    <View style={[s.problema, { borderLeftColor: bloqueio ? colors.danger : colors.gained }]}>
      <Text style={s.problemaTitulo}>{problema.title}</Text>
      <Text style={s.problemaDetalhe}>{problema.detail}</Text>
      {problema.fix ? <Text style={s.problemaConserto}>{problema.fix}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  /*
   * O fundo escurecido é tocável e não fecha nada. Um toque fora que descarta a
   * confirmação transformaria "conferi" em "encostei sem querer" — e o modal
   * existe justamente para essa resposta ser deliberada.
   */
  fundo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: space.md,
  },
  caixa: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '84%',
    overflow: 'hidden',
  },
  conteudo: { padding: space.lg, gap: space.md },
  titulo: { ...heading.title, color: colors.ink },
  abertura: {
    fontSize: typography.scale.body,
    lineHeight: 21,
    color: colors.inkMuted,
  },

  problema: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    padding: space.md,
    gap: space.xs,
  },
  problemaTitulo: {
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
    color: colors.ink,
  },
  problemaDetalhe: {
    fontSize: typography.scale.caption,
    lineHeight: 19,
    color: colors.inkMuted,
  },
  /** O que fazer fica em roxo: é a única linha do bloco que pede ação. */
  problemaConserto: {
    fontSize: typography.scale.caption,
    lineHeight: 19,
    color: colors.gained,
    marginTop: space.xs,
  },

  acoes: {
    padding: space.md,
    paddingTop: 0,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});

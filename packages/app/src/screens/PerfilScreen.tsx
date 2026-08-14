/**
 * Aba Perfil — conta, sincronização e sair.
 *
 * Antes esta tela precisava convencer o usuário a criar conta, e por isso
 * explicava a arquitetura do produto: o que ficava no aparelho, o que subia para
 * o servidor, o que era opcional. Com a conta obrigatória, nada disso é decisão
 * dele — e explicar uma decisão que a pessoa não toma é só ruído.
 *
 * O que sobrou é o que ele de fato usa: qual @ está sendo acompanhado, se a
 * última atualização chegou ao servidor, e como sair.
 *
 * Nenhum campo aqui pede senha do Instagram, e nunca vai pedir. É a regra 1 do
 * CLAUDE.md, e é o que separa este app dos que queimam a conta de quem usa.
 */

import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar, Banner, Button, MenuRow, SectionTitle } from '../components/ui';
import { IconeEscudo } from '../components/icons';
import { useConta } from '../lib/conta';
import { API_URL } from '../api/client';
import { colors, radius, space, typography } from '../lib/theme';

interface Props {
  /** Quantos arquivos já foram enviados neste aparelho. */
  snapshotCount: number;
  onImportar: () => void;
  onAbrirModos: () => void;
}

export function PerfilScreen({ snapshotCount, onImportar, onAbrirModos }: Props) {
  const { perfil, ocupado, erro, envio, sair, definirPerfil, enviarPendente } = useConta();
  const [handle, setHandle] = useState('');

  // Sem perfil ainda: é o passo seguinte ao cadastro, e a tela não deve
  // oferecer mais nada até ele terminar.
  if (!perfil) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
        <Text style={s.titulo}>Qual é o seu @?</Text>
        <Text style={s.explicacao}>
          Serve para identificar de qual conta são seus arquivos. O app não se conecta ao
          Instagram — nada é verificado ou acessado lá.
        </Text>

        <TextInput
          style={s.input}
          value={handle}
          onChangeText={setHandle}
          placeholder="@seu.usuario"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />

        {erro ? <Banner title="Não deu certo" body={erro} tone="danger" /> : null}

        <Button
          label={ocupado ? 'Salvando…' : 'Continuar'}
          onPress={() => void definirPerfil(handle)}
          disabled={handle.trim().length === 0 || ocupado}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      <View style={s.cabecalho}>
        <Avatar username={perfil.handle} size={64} />
        <View style={s.cabecalhoTexto}>
          <Text style={s.handle}>@{perfil.handle}</Text>
          {/*
           * "guardadas neste aparelho", e não "enviadas": este número vem do
           * índice local, não do servidor. Chamá-lo de enviado afirmaria algo
           * que o app não verificou — e faria o usuário confiar num envio que
           * pode estar pendente.
           */}
          <Text style={s.sub}>
            {snapshotCount === 0
              ? 'Nenhuma atualização ainda'
              : snapshotCount === 1
                ? '1 atualização guardada neste aparelho'
                : `${snapshotCount} atualizações guardadas neste aparelho`}
          </Text>
        </View>
      </View>

      <EstadoDoEnvio envio={envio} onTentarDeNovo={enviarPendente} />

      <SectionTitle>Seus dados</SectionTitle>
      <MenuRow label="Enviar um arquivo novo" onPress={onImportar} />
      <MenuRow label="Como conseguir o arquivo" onPress={onAbrirModos} />

      <View style={s.promessa}>
        <IconeEscudo size={20} />
        <Text style={s.promessaTexto}>
          O Rastro nunca pede a senha do seu Instagram. Ele lê apenas o arquivo que o próprio
          Instagram entrega a você.
        </Text>
      </View>

      <SectionTitle>Conta</SectionTitle>
      <Button
        label={ocupado ? 'Saindo…' : 'Sair da conta'}
        variant="danger"
        onPress={sair}
        disabled={ocupado}
      />

      <Text style={s.rodape}>{API_URL.replace(/^https?:\/\//, '')}</Text>
    </ScrollView>
  );
}

/**
 * Situação do último envio.
 *
 * A mensagem de falha precisa deixar claro que nada foi perdido. Um usuário que
 * lê "não foi possível enviar" e conclui que precisa refazer o pedido do arquivo
 * no Instagram vai esperar mais 48 horas por nada.
 */
function EstadoDoEnvio({
  envio,
  onTentarDeNovo,
}: {
  envio: ReturnType<typeof useConta.getState>['envio'];
  onTentarDeNovo: () => void;
}) {
  if (envio.situacao === 'ocioso') return null;

  if (envio.situacao === 'enviando') {
    return (
      <View style={s.linhaEstado}>
        <ActivityIndicator color={colors.gained} />
        <Text style={s.estadoTexto}>Salvando sua atualização…</Text>
      </View>
    );
  }

  if (envio.situacao === 'enviado') {
    return (
      <Text style={s.estadoTexto}>
        {envio.duplicado ? 'Tudo já estava salvo.' : 'Atualização salva.'}
      </Text>
    );
  }

  return (
    <Banner
      title="Ainda não conseguimos salvar"
      body={`${envio.motivo} Seus dados estão guardados neste aparelho e vão subir assim que a conexão permitir.`}
      tone="warning"
      action={
        <View style={s.acaoBanner}>
          <Button label="Tentar de novo" onPress={onTentarDeNovo} />
        </View>
      }
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  conteudo: { padding: space.lg, paddingBottom: space.xl, gap: space.sm },

  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cabecalhoTexto: { flex: 1, gap: 2 },
  handle: {
    color: colors.ink,
    fontSize: typography.scale.title,
    fontWeight: typography.weight.bold,
  },
  sub: { color: colors.inkMuted, fontSize: typography.scale.caption },

  titulo: {
    color: colors.ink,
    fontSize: typography.scale.title,
    fontWeight: typography.weight.bold,
  },
  explicacao: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.md - 2,
    fontSize: typography.scale.body,
    marginTop: space.sm,
  },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
  },
  promessaTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 19,
  },

  linhaEstado: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  estadoTexto: { color: colors.inkMuted, fontSize: typography.scale.caption },
  acaoBanner: { marginTop: space.sm },

  rodape: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textAlign: 'center',
    marginTop: space.lg,
  },
});

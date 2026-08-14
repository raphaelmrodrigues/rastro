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
import { API_URL, VERSAO_DO_APP } from '../api/client';
import { colors, radius, space, typography } from '../lib/theme';

interface Props {
  /** Quantos arquivos já foram enviados neste aparelho. */
  snapshotCount: number;
  onImportar: () => void;
  onAbrirSobreArquivo: () => void;
}

export function PerfilScreen({ snapshotCount, onImportar, onAbrirSobreArquivo }: Props) {
  const { perfil, ocupado, erro, envio, sair, definirPerfil, enviarPendente, excluirConta } =
    useConta();
  const [handle, setHandle] = useState('');
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

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

      {/*
       * Erros desta tela precisam aparecer nela. Sem este bloco, uma exclusão de
       * conta recusada pelo servidor não deixava rastro visível: o usuário
       * tocava em "Apagar tudo", nada acontecia, e não havia como saber por quê.
       */}
      {erro ? <Banner title="Não deu certo" body={erro} tone="danger" /> : null}

      <SectionTitle>Seus dados</SectionTitle>
      <MenuRow label="Enviar um arquivo novo" onPress={onImportar} />
      <MenuRow label="Como conseguir o arquivo" onPress={onAbrirSobreArquivo} />

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
        variant="ghost"
        onPress={sair}
        disabled={ocupado}
      />

      {/*
       * Exclusão de conta dentro do app: exigência da Apple e do Google para
       * qualquer app que permita criar conta, e da LGPD por outro caminho. Sem
       * isto a revisão da App Store reprova.
       *
       * Em dois toques, com o texto do que será apagado no meio. Um botão só,
       * com "tem certeza?" genérico, é o padrão que faz gente apagar a conta sem
       * querer — e aqui não há como desfazer.
       */}
      {confirmandoExclusao ? (
        <View style={s.zonaPerigo}>
          <Text style={s.perigoTitulo}>Apagar sua conta?</Text>
          <Text style={s.perigoTexto}>
            Some tudo: seu histórico, suas listas e as atualizações guardadas neste aparelho.
            Não dá para recuperar depois, e você teria que começar do zero com um arquivo novo.
          </Text>
          <View style={s.perigoBotoes}>
            <View style={s.perigoBotao}>
              <Button label="Cancelar" variant="ghost" onPress={() => setConfirmandoExclusao(false)} />
            </View>
            <View style={s.perigoBotao}>
              <Button
                label={ocupado ? 'Apagando…' : 'Apagar tudo'}
                variant="danger"
                onPress={() => void excluirConta()}
                disabled={ocupado}
              />
            </View>
          </View>
        </View>
      ) : (
        <Button
          label="Apagar minha conta"
          variant="danger"
          onPress={() => setConfirmandoExclusao(true)}
          disabled={ocupado}
        />
      )}

      <Text style={s.rodape}>
        Rastro {VERSAO_DO_APP} · {API_URL.replace(/^https?:\/\//, '')}
      </Text>
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

  zonaPerigo: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  perigoTitulo: {
    color: colors.danger,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
  },
  perigoTexto: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  perigoBotoes: { flexDirection: 'row', gap: space.sm },
  perigoBotao: { flex: 1 },
});

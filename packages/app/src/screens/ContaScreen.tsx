/**
 * Conta do Rastro: entrar, cadastrar, escolher o perfil e sair.
 *
 * O texto desta tela carrega uma promessa que o resto do produto precisa
 * cumprir, então ele é preciso e não publicitário: criar conta é o que faz os
 * dados saírem do aparelho. Quem não quiser continua com tudo local, e a tela
 * diz isso antes de pedir e-mail — não depois, em letra miúda.
 *
 * Nenhum campo aqui pede senha do Instagram, e nunca vai pedir. É a regra 1 do
 * CLAUDE.md, e é o que separa este app dos que queimam a conta de quem usa.
 */

import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Banner, Button } from '../components/ui';
import { useConta } from '../lib/conta';
import { API_URL } from '../api/client';
import { colors, radius, space, typography } from '../lib/theme';

interface Props {
  onBack: () => void;
}

const SENHA_MINIMA = 10;

export function ContaScreen({ onBack }: Props) {
  const {
    conectado,
    perfil,
    ocupado,
    erro,
    envio,
    cadastrar,
    entrar,
    sair,
    definirPerfil,
    enviarPendente,
    limparErro,
  } = useConta();

  const [modo, setModo] = useState<'entrar' | 'cadastrar'>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [handle, setHandle] = useState('');

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const senhaValida = senha.length >= SENHA_MINIMA;
  const podeEnviar = emailValido && senhaValida && !ocupado;

  const submeter = async () => {
    limparErro();
    const ok = modo === 'entrar' ? await entrar(email, senha) : await cadastrar(email, senha);
    if (ok) setSenha('');
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      <View style={s.cabecalho}>
        <Button label="Voltar" variant="ghost" onPress={onBack} />
        <Text style={s.titulo}>{conectado ? 'Sua conta' : 'Sincronizar entre aparelhos'}</Text>
      </View>

      {conectado === null ? (
        <View style={s.centro}>
          <ActivityIndicator color={colors.gained} />
        </View>
      ) : conectado ? (
        <ContaConectada
          perfil={perfil}
          handle={handle}
          setHandle={setHandle}
          ocupado={ocupado}
          envio={envio}
          onDefinirPerfil={() => definirPerfil(handle)}
          onSair={sair}
          onTentarDeNovo={enviarPendente}
        />
      ) : (
        <>
          <Text style={s.explicacao}>
            O app funciona inteiro sem conta — é assim que ele está agora, com tudo guardado
            só neste aparelho. A conta serve para duas coisas: ter o mesmo histórico em mais
            de um aparelho e receber aviso quando alguém sair.
          </Text>
          <Text style={s.explicacao}>
            Criando conta, a lista de quem te segue passa a ficar também no servidor. É o seu
            servidor, e você pode apagar tudo a qualquer momento — mas é uma escolha, e ela é
            sua.
          </Text>

          <Banner
            title="Esta senha é do Rastro"
            body={
              'Nunca pedimos a senha do Instagram, nem aqui nem em lugar nenhum. Se algum app ' +
              'do gênero pedir, ele vai usar sua conta para varrer seguidores — e é a sua ' +
              'conta que é bloqueada, não a dele.'
            }
          />

          <View style={s.abas}>
            <Button
              label="Entrar"
              variant={modo === 'entrar' ? 'primary' : 'ghost'}
              onPress={() => {
                setModo('entrar');
                limparErro();
              }}
            />
            <Button
              label="Criar conta"
              variant={modo === 'cadastrar' ? 'primary' : 'ghost'}
              onPress={() => {
                setModo('cadastrar');
                limparErro();
              }}
            />
          </View>

          <View style={s.campos}>
            <Text style={s.rotulo}>E-mail</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="voce@exemplo.com"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />

            <Text style={s.rotulo}>Senha do Rastro</Text>
            <TextInput
              style={s.input}
              value={senha}
              onChangeText={setSenha}
              placeholder={`Pelo menos ${SENHA_MINIMA} caracteres`}
              placeholderTextColor={colors.inkFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              // `newPassword` faz o gerenciador de senhas oferecer uma forte no
              // cadastro, em vez de o usuário repetir a de sempre.
              textContentType={modo === 'cadastrar' ? 'newPassword' : 'password'}
            />
            {senha.length > 0 && !senhaValida ? (
              <Text style={s.dica}>Faltam {SENHA_MINIMA - senha.length} caracteres.</Text>
            ) : null}
          </View>

          {erro ? <Banner title="Não deu certo" body={erro} tone="danger" /> : null}

          <Button
            label={ocupado ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
            onPress={submeter}
            disabled={!podeEnviar}
          />

          <Text style={s.servidor}>Servidor: {API_URL.replace(/^https?:\/\//, '')}</Text>
        </>
      )}
    </ScrollView>
  );
}

function ContaConectada({
  perfil,
  handle,
  setHandle,
  ocupado,
  envio,
  onDefinirPerfil,
  onSair,
  onTentarDeNovo,
}: {
  perfil: { id: string; handle: string } | null;
  handle: string;
  setHandle: (v: string) => void;
  ocupado: boolean;
  envio: ReturnType<typeof useConta.getState>['envio'];
  onDefinirPerfil: () => void;
  onSair: () => void;
  onTentarDeNovo: () => void;
}) {
  if (!perfil) {
    return (
      <>
        <Text style={s.explicacao}>
          Falta dizer de qual conta são estes imports. O @ serve só de rótulo — o app não
          se conecta ao Instagram e não confere nada com ele.
        </Text>
        <View style={s.campos}>
          <Text style={s.rotulo}>Seu @ no Instagram</Text>
          <TextInput
            style={s.input}
            value={handle}
            onChangeText={setHandle}
            placeholder="@seu.usuario"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Button
          label={ocupado ? 'Salvando…' : 'Salvar'}
          onPress={onDefinirPerfil}
          disabled={handle.trim().length === 0 || ocupado}
        />
      </>
    );
  }

  return (
    <>
      <View style={s.cartao}>
        <Text style={s.cartaoRotulo}>PERFIL SINCRONIZADO</Text>
        <Text style={s.cartaoValor}>@{perfil.handle}</Text>
      </View>

      <Text style={s.explicacao}>
        A partir de agora, cada import é enviado para o servidor depois de ser salvo aqui.
        O arquivo do Instagram nunca sai do aparelho — o que viaja é a lista já processada.
      </Text>

      <EstadoDoEnvio envio={envio} onTentarDeNovo={onTentarDeNovo} />

      <Button label={ocupado ? 'Saindo…' : 'Sair da conta'} variant="danger" onPress={onSair} disabled={ocupado} />
      <Text style={s.dica}>
        Sair apaga a chave de acesso deste aparelho. Os imports continuam guardados aqui e no
        servidor.
      </Text>
    </>
  );
}

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
        <Text style={s.estadoTexto}>Enviando o último import…</Text>
      </View>
    );
  }

  if (envio.situacao === 'enviado') {
    return (
      <Text style={s.estadoTexto}>
        {envio.duplicado
          ? 'Este import já estava no servidor — nada foi duplicado.'
          : 'Último import sincronizado.'}
      </Text>
    );
  }

  return (
    <Banner
      title="O import está salvo, mas ainda não subiu"
      body={`${envio.motivo} Ele continua neste aparelho e será enviado quando der.`}
      tone="warning"
      action={
        <View style={s.acaoBanner}>
          <Button label="Tentar de novo agora" onPress={onTentarDeNovo} />
        </View>
      }
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  conteudo: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  cabecalho: { gap: space.xs },
  titulo: { color: colors.ink, fontSize: typography.scale.title },
  centro: { paddingVertical: space.xl, alignItems: 'center' },
  explicacao: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  abas: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  campos: { gap: space.xs },
  rotulo: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: space.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    fontSize: typography.scale.body,
  },
  dica: { color: colors.inkFaint, fontSize: typography.scale.micro, lineHeight: 16 },
  servidor: { color: colors.inkFaint, fontSize: typography.scale.micro, textAlign: 'center' },
  cartao: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  cartaoRotulo: {
    color: colors.inkMuted,
    fontSize: typography.scale.micro,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cartaoValor: { color: colors.ink, fontSize: typography.scale.section },
  linhaEstado: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  estadoTexto: { color: colors.inkMuted, fontSize: typography.scale.caption },
  acaoBanner: { marginTop: space.sm },
});

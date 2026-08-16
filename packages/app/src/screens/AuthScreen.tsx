/**
 * Criar conta ou entrar.
 *
 * ## Não é mais porta de entrada (16/08/2026)
 *
 * Entre 14 e 16/08/2026 esta tela bloqueava o app inteiro. A reversão tem um
 * motivo medível: **nenhuma função do app depende de conta**. Parsing, diff,
 * estatísticas e listas rodam sobre arquivos no próprio aparelho. A conta serve
 * para guardar histórico, trocar de celular sem perder nada e, no futuro, o
 * plano pago.
 *
 * Cobrar cadastro antes de a pessoa ver qualquer valor era a primeira parede de
 * um funil que já tem uma espera de até 48h do Instagram no meio. Agora ela é
 * alcançada por convite, depois do primeiro import, e pelo Perfil.
 *
 * ## O texto
 *
 * O usuário chega vindo de apps que pedem a senha do Instagram. Ele vai olhar
 * este formulário e presumir que é a mesma coisa. Desfazer essa suposição, sem
 * letra miúda, é o trabalho mais importante do copy do produto inteiro — e é por
 * isso que a promessa aparece como um bloco com ícone, acima dos campos, e não
 * como aviso embaixo do botão.
 *
 * O que o texto deliberadamente NÃO faz: explicar arquitetura. A versão anterior
 * falava em "histórico entre aparelhos", "modo local", "o que viaja é a lista já
 * processada". Isso é vocabulário de quem construiu o app, não de quem vai
 * usá-lo.
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Banner, Button } from '../components/ui';
import { Logotipo } from '../components/Marca';
import { IconeEscudo } from '../components/icons';
import { useConta } from '../lib/conta';
import { colors, radius, space, typography } from '../lib/theme';

const SENHA_MINIMA = 10;

interface Props {
  /** Chamado quando a conta fica pronta, para a tela fechar. */
  aoConcluir?: () => void;
  /** Abre direto em "Criar conta" — o convite pós-import leva para lá. */
  modoInicial?: 'entrar' | 'cadastrar';
  /**
   * Motivo pelo qual a tela foi aberta, mostrado no topo.
   *
   * Quem chega aqui vindo do convite já sabe o que quer; quem chega pelo Perfil
   * pode não saber. Uma linha de contexto evita a tela parecer uma exigência
   * súbita depois de o app ter funcionado sem ela.
   */
  motivo?: string;
}

export function AuthScreen({ aoConcluir, modoInicial = 'entrar', motivo }: Props) {
  const { ocupado, erro, cadastrar, entrar, limparErro } = useConta();

  const [modo, setModo] = useState<'entrar' | 'cadastrar'>(modoInicial);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const senhaValida = senha.length >= SENHA_MINIMA;
  const podeEnviar = emailValido && senhaValida && !ocupado;

  const submeter = async () => {
    limparErro();
    const ok = modo === 'entrar' ? await entrar(email, senha) : await cadastrar(email, senha);
    if (!ok) return;
    setSenha('');
    /*
     * Fecha a tela e devolve a pessoa ao que ela estava fazendo.
     *
     * O que já foi importado sobe sozinho: `enviarPendente` roda ao entrar e
     * encontra os snapshots deste aparelho. É o que torna honesta a promessa do
     * convite — criar conta depois de importar não perde nada.
     */
    aoConcluir?.();
  };

  const trocarModo = (novo: 'entrar' | 'cadastrar') => {
    setModo(novo);
    limparErro();
  };

  /*
   * KeyboardAvoidingView só no iPhone, onde ele resolve um problema real: sem
   * ele o teclado cobre o campo de senha e o botão.
   *
   * Nas outras plataformas ele entra como `View` simples. No navegador não há
   * teclado que empurre nada, e o componente combinado com o `flexGrow: 1` +
   * `justifyContent: 'center'` deste ScrollView entrava num laço de medição que
   * travava a aba inteira — sem erro no console, o que torna a causa
   * especialmente difícil de achar depois.
   */
  const Moldura = Platform.OS === 'ios' ? KeyboardAvoidingView : View;

  return (
    <Moldura style={s.raiz} behavior="padding">
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <View style={s.marca}>
          <Logotipo size="grande" />
          <Text style={s.assinatura}>
            {motivo ?? 'Quem entrou e quem saiu da sua lista de seguidores.'}
          </Text>
        </View>

        <View style={s.promessa}>
          <IconeEscudo />
          <Text style={s.promessaTexto}>
            <Text style={s.promessaForte}>Nunca pedimos a senha do seu Instagram.</Text> A senha
            abaixo é só do Rastro. É por isso que sua conta do Instagram não corre risco de
            bloqueio aqui.
          </Text>
        </View>

        <View style={s.abas}>
          <AbaBotao
            rotulo="Entrar"
            ativa={modo === 'entrar'}
            onPress={() => trocarModo('entrar')}
          />
          <AbaBotao
            rotulo="Criar conta"
            ativa={modo === 'cadastrar'}
            onPress={() => trocarModo('cadastrar')}
          />
        </View>

        <View style={s.campos}>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Seu e-mail"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <TextInput
            style={s.input}
            value={senha}
            onChangeText={setSenha}
            placeholder={modo === 'cadastrar' ? `Crie uma senha (${SENHA_MINIMA}+ caracteres)` : 'Sua senha do Rastro'}
            placeholderTextColor={colors.inkFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // `newPassword` faz o gerenciador de senhas oferecer uma forte no
            // cadastro, em vez de o usuário repetir a de sempre.
            textContentType={modo === 'cadastrar' ? 'newPassword' : 'password'}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (podeEnviar) void submeter();
            }}
          />

          {modo === 'cadastrar' && senha.length > 0 && !senhaValida ? (
            <Text style={s.dica}>Faltam {SENHA_MINIMA - senha.length} caracteres.</Text>
          ) : null}
        </View>

        {erro ? <Banner title="Não deu certo" body={erro} tone="danger" /> : null}

        <View style={s.acao}>
          <Button
            label={ocupado ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Criar minha conta'}
            onPress={submeter}
            disabled={!podeEnviar}
          />
        </View>

        {/*
         * Este texto prometia "aviso quando alguém deixar de te seguir".
         *
         * O app não faz isso e não pode fazer: descobrir uma saída no momento em
         * que acontece exige ler a lista de seguidores continuamente, e a lista
         * só existe dentro do arquivo que o usuário pede de tempos em tempos. A
         * promessa aparecia na primeira tela que a pessoa lê, antes de qualquer
         * outra coisa — e cobrava uma dívida que a única forma de pagar seria
         * usar a API privada com a sessão dela (regra 2 do CLAUDE.md).
         */}
        <Text style={s.rodape}>
          {modo === 'entrar'
            ? 'Ainda não tem conta? Toque em "Criar conta" acima.'
            : 'Sua conta guarda seu histórico, e é o que permite comparar cada arquivo novo com os anteriores.'}
        </Text>
      </ScrollView>
    </Moldura>
  );
}

/** Aba de formulário. Sublinhado em vez de botão cheio: é seletor, não ação. */
function AbaBotao({
  rotulo,
  ativa,
  onPress,
}: {
  rotulo: string;
  ativa: boolean;
  onPress: () => void;
}) {
  return (
    <Text
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: ativa }}
      style={[s.aba, ativa && s.abaAtiva]}
    >
      {rotulo}
    </Text>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.base },
  conteudo: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.lg,
    paddingBottom: space.xl,
    gap: space.md,
  },
  marca: { alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  assinatura: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    alignItems: 'flex-start',
  },
  promessaTexto: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
  },
  promessaForte: { color: colors.ink, fontWeight: typography.weight.semibold },

  abas: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  aba: {
    color: colors.inkFaint,
    fontSize: typography.scale.body,
    fontWeight: typography.weight.semibold,
    paddingVertical: space.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  abaAtiva: { color: colors.ink, borderBottomColor: colors.gained },

  campos: { gap: space.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.md - 2,
    fontSize: typography.scale.body,
  },
  dica: { color: colors.inkFaint, fontSize: typography.scale.micro },

  acao: { marginTop: space.xs },
  rodape: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textAlign: 'center',
    lineHeight: 17,
  },
});

/**
 * Captura o erro que derrubaria o app inteiro.
 *
 * Sem isto, uma exceção em qualquer tela deixa a pessoa olhando uma tela branca
 * (web) ou vendo o app fechar (nativo) — e ninguém fica sabendo. Com isto, ela
 * vê uma explicação, tem um caminho de saída, e o servidor recebe o relato.
 *
 * Precisa ser classe: `componentDidCatch` não tem equivalente em hook, e é o
 * único jeito de o React entregar o erro de renderização em vez de desmontar a
 * árvore em silêncio.
 *
 * ## O que ele não pega
 *
 * Erro dentro de `Promise` sem `catch` e erro em handler de evento não passam
 * por aqui — o React só reporta o que acontece durante a renderização. Os pontos
 * assíncronos que importam (import do zip, chamadas de API) relatam por conta
 * própria, chamando `relatarErro` direto.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { Logotipo } from './Marca';
import { relatarErro } from '../lib/telemetria';
import { colors, space, typography } from '../lib/theme';

interface Props {
  children: ReactNode;
  /** Chamado ao tocar em "Voltar ao início" — devolve o app a um estado seguro. */
  aoReiniciar?: () => void;
}

interface State {
  erro: Error | null;
}

export class LimiteDeErro extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    /*
     * `componentStack` aponta a árvore de componentes onde quebrou. É o dado que
     * transforma "TypeError: undefined" em algo consertável — e não contém dado
     * do usuário, só nome de componente.
     */
    const tela = info.componentStack?.trim().split('\n')[0]?.trim().slice(0, 60);
    relatarErro(erro, tela || 'render');
  }

  private reiniciar = () => {
    this.setState({ erro: null });
    this.props.aoReiniciar?.();
  };

  render() {
    if (!this.state.erro) return this.props.children;

    return (
      <ScrollView style={s.tela} contentContainerStyle={s.conteudo}>
        <Logotipo size="medio" />
        <Text style={s.titulo}>Alguma coisa quebrou aqui</Text>
        {/*
         * Duas informações são deliberadas: que os dados estão salvos, e que o
         * problema já foi comunicado. Sem a primeira, a pessoa acha que perdeu o
         * import e vai pedir outro arquivo ao Instagram — mais 48h de espera por
         * nada. Sem a segunda, ela sente que precisa escrever para alguém.
         */}
        <Text style={s.texto}>
          Foi um erro nosso, não no seu arquivo. Seus dados continuam salvos neste aparelho.
        </Text>
        <Text style={s.texto}>
          O problema já foi comunicado automaticamente, sem nenhum dado das suas listas.
        </Text>

        <View style={s.acao}>
          <Button label="Voltar ao início" onPress={this.reiniciar} />
        </View>

        {/*
         * A mensagem técnica fica visível, pequena, no rodapé: quando o usuário
         * manda um print, ela é a única coisa que localiza o problema.
         */}
        <Text style={s.detalhe} selectable>
          {this.state.erro.name}: {this.state.erro.message}
        </Text>
      </ScrollView>
    );
  }
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.base },
  conteudo: { padding: space.lg, gap: space.md, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  titulo: {
    color: colors.ink,
    fontSize: typography.scale.title,
    fontWeight: typography.weight.bold,
    textAlign: 'center',
  },
  texto: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 340,
  },
  acao: { alignSelf: 'stretch', maxWidth: 340, marginTop: space.sm },
  detalhe: {
    color: colors.inkFaint,
    fontSize: typography.scale.micro,
    textAlign: 'center',
    marginTop: space.lg,
  },
});

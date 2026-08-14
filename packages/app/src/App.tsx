/**
 * Raiz do app.
 *
 * ## Conta obrigatória
 *
 * Nada abre sem sessão. Enquanto `conectado` é `null` a sessão ainda está sendo
 * restaurada e a tela mostra a marca; `false` leva à tela de entrada; só `true`
 * dá acesso ao resto. Isso é decisão de produto do dono, tomada em 14/08/2026 —
 * antes disso o app funcionava inteiro offline e a conta era opcional.
 *
 * Consequência que precisa continuar verdadeira: a senha pedida na entrada é a
 * do **Rastro**, nunca a do Instagram, e a tela diz isso antes dos campos. Um
 * formulário de login num app de seguidores é exatamente o que o usuário viu nos
 * apps que queimaram a conta dele.
 *
 * ## Navegação
 *
 * Estado, sem biblioteca de rotas: cinco abas e uma pilha de um nível. Trocar
 * por expo-router quando houver deep link — antes disso a dependência custa mais
 * do que resolve.
 *
 * O "chrome" (cabeçalho e barra de abas) mora aqui e não dentro das telas: assim
 * a barra de abas fica fora da área que rola e não some quando a lista de
 * seguidores é longa.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { escolherArquivoDoExport } from './lib/arquivo';
import { ArquivoNaoEhZip } from './lib/zip';
import { ImportGuideScreen } from './screens/ImportGuideScreen';
import { DashboardScreen, type ListaId } from './screens/DashboardScreen';
import { PessoasScreen } from './screens/PessoasScreen';
import { PeopleListScreen, TITULOS } from './screens/PeopleListScreen';
import { StatsScreen } from './screens/StatsScreen';
import { ModesScreen } from './screens/ModesScreen';
import { PerfilScreen } from './screens/PerfilScreen';
import { AuthScreen } from './screens/AuthScreen';
import { Header, TabBar, type Aba } from './components/Chrome';
import { Logotipo } from './components/Marca';
import { useStore } from './lib/store';
import { useConta } from './lib/conta';
import { colors, space, typography } from './lib/theme';

/** Tela empilhada sobre a aba atual. `null` = a própria aba. */
type Empilhada = { nome: 'lista'; lista: ListaId } | { nome: 'stats' } | { nome: 'modos' } | null;

/**
 * Aviso ao usuário. O Alert do react-native-web é um no-op silencioso, e um erro
 * de import que não aparece é pior que um erro feio.
 */
function avisar(titulo: string, mensagem: string): void {
  if (Platform.OS === 'web') globalThis.alert(`${titulo}\n\n${mensagem}`);
  else Alert.alert(titulo, mensagem);
}

/**
 * Moldura de todas as telas.
 *
 * A largura máxima existe para o navegador. Num monitor, sem ela, uma linha de
 * pessoa fica com o @ na borda esquerda e o ícone de link a mil pixels de
 * distância — e a barra de abas vira uma faixa com cinco ícones perdidos. Em
 * celular a tela é sempre mais estreita que o limite, então nada muda lá.
 */
function Raiz({ children }: { children: ReactNode }) {
  return (
    <View style={s.fundo}>
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        {children}
      </SafeAreaView>
    </View>
  );
}

export default function App() {
  const [aba, setAba] = useState<Aba>('inicio');
  const [empilhada, setEmpilhada] = useState<Empilhada>(null);
  // Cobre o intervalo entre escolher o arquivo e a leitura começar. Num arquivo
  // completo isso é dezenas de segundos — sem indicador, parece que o botão não
  // funcionou e o usuário toca de novo.
  const [lendo, setLendo] = useState(false);

  const { loading, importing, progress, snapshot, reports, snapshotCount, error, boot, importZip } =
    useStore();
  const { conectado, perfil, iniciar } = useConta();

  useEffect(() => {
    void boot();
    void iniciar();
  }, [boot, iniciar]);

  const escolherArquivo = async () => {
    const fonte = await escolherArquivoDoExport();
    if (!fonte) return;

    setLendo(true);
    try {
      const { ok, message } = await importZip(fonte);
      if (!ok) {
        avisar('Não deu para ler', message ?? 'Tente novamente.');
        return;
      }
      setEmpilhada(null);
      setAba('inicio');
    } catch (erro) {
      // "Não é um zip" tem causa e solução conhecidas; vale dizer qual é em vez
      // de cair na mensagem genérica, que já culpou um arquivo perfeito uma vez.
      avisar(
        erro instanceof ArquivoNaoEhZip ? 'Arquivo não reconhecido' : 'Não deu para ler o arquivo',
        erro instanceof ArquivoNaoEhZip
          ? erro.message
          : 'Tente novamente. Se continuar, peça o arquivo ao Instagram de novo.',
      );
    } finally {
      setLendo(false);
    }
  };

  // Sessão ainda sendo restaurada, ou dados locais ainda carregando.
  if (conectado === null || loading) {
    return (
      <Raiz>
        <View style={s.centro}>
          <Logotipo size="grande" />
          <ActivityIndicator color={colors.gained} />
        </View>
      </Raiz>
    );
  }

  if (!conectado) {
    return (
      <Raiz>
        <AuthScreen />
      </Raiz>
    );
  }

  const semDados = !snapshot || !reports;
  const importando = importing || lendo;

  // Sem nenhum arquivo ainda, o app tem uma coisa só a oferecer. Mostrar abas
  // vazias seria dar cinco caminhos que não levam a lugar nenhum.
  if (semDados) {
    return (
      <Raiz>
        <Header acao={<AtalhoPerfil onPress={() => setAba('perfil')} />} />
        {aba === 'perfil' ? (
          <PerfilScreen
            snapshotCount={snapshotCount}
            onImportar={() => setAba('importar')}
            onAbrirModos={() => setEmpilhada({ nome: 'modos' })}
          />
        ) : empilhada?.nome === 'modos' ? (
          <ModesScreen />
        ) : (
          <ImportGuideScreen
            primeiraVez
            onPickFile={escolherArquivo}
            onOpenModes={() => setEmpilhada({ nome: 'modos' })}
            importing={importando}
            progress={progress}
            error={error}
          />
        )}
      </Raiz>
    );
  }

  const tituloEmpilhada =
    empilhada?.nome === 'lista'
      ? TITULOS[empilhada.lista].title
      : empilhada?.nome === 'stats'
        ? 'Evolução'
        : empilhada?.nome === 'modos'
          ? 'Outras formas'
          : undefined;

  return (
    <Raiz>
      {empilhada ? (
        <Header titulo={tituloEmpilhada} onVoltar={() => setEmpilhada(null)} />
      ) : (
        <Header acao={<AtalhoPerfil onPress={() => setAba('perfil')} />} />
      )}

      <View style={s.corpo}>
        {empilhada?.nome === 'lista' ? (
          <PeopleListScreen lista={empilhada.lista} insights={reports.insights} diff={reports.diff} />
        ) : empilhada?.nome === 'stats' ? (
          <StatsScreen reports={reports} snapshotCount={snapshotCount} />
        ) : empilhada?.nome === 'modos' ? (
          <ModesScreen />
        ) : aba === 'inicio' ? (
          <DashboardScreen
            snapshot={snapshot}
            reports={reports}
            handle={perfil?.handle ?? null}
            onOpenList={(lista) => setEmpilhada({ nome: 'lista', lista })}
            onOpenStats={() => setEmpilhada({ nome: 'stats' })}
            onImportAgain={() => setAba('importar')}
          />
        ) : aba === 'pessoas' ? (
          <PessoasScreen
            reports={reports}
            onOpenList={(lista) => setEmpilhada({ nome: 'lista', lista })}
          />
        ) : aba === 'importar' ? (
          <ImportGuideScreen
            primeiraVez={false}
            onPickFile={escolherArquivo}
            onOpenModes={() => setEmpilhada({ nome: 'modos' })}
            importing={importando}
            progress={progress}
            error={error}
          />
        ) : aba === 'evolucao' ? (
          <StatsScreen reports={reports} snapshotCount={snapshotCount} />
        ) : (
          <PerfilScreen
            snapshotCount={snapshotCount}
            onImportar={() => setAba('importar')}
            onAbrirModos={() => setEmpilhada({ nome: 'modos' })}
          />
        )}
      </View>

      <TabBar
        ativa={aba}
        aoTrocar={(nova) => {
          // Trocar de aba fecha a tela empilhada: sem isto, voltar para "Início"
          // ainda mostraria a lista aberta antes e o toque pareceria ignorado.
          setEmpilhada(null);
          setAba(nova);
        }}
      />
    </Raiz>
  );
}

/** Atalho para o perfil no canto do cabeçalho, como em qualquer app de rede. */
function AtalhoPerfil({ onPress }: { onPress: () => void }) {
  const perfil = useConta((c) => c.perfil);
  return (
    <Text onPress={onPress} style={s.atalhoPerfil} accessibilityRole="button">
      {perfil ? `@${perfil.handle}` : 'Perfil'}
    </Text>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: colors.base, alignItems: 'center' },
  root: { flex: 1, width: '100%', maxWidth: 560, backgroundColor: colors.base },
  corpo: { flex: 1 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  atalhoPerfil: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
});

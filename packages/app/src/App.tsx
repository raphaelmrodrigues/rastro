/**
 * Raiz do app.
 *
 * Navegacao por estado, sem biblioteca de rotas: sao cinco telas e uma pilha de
 * um nivel so. Trocar por expo-router quando houver deep link ou aba — antes
 * disso, a dependencia custa mais do que resolve.
 *
 * O app funciona inteiro offline: o zip e lido no aparelho e os snapshots ficam
 * no armazenamento local. Sincronizar com servidor e opt-in — sem conta, nenhuma
 * chamada de rede acontece, e o cliente HTTP nem chega a ser carregado.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { escolherArquivoDoExport } from './lib/arquivo';
import { ArquivoNaoEhZip } from './lib/zip';
import { ImportGuideScreen } from './screens/ImportGuideScreen';
import { DashboardScreen, type ListaId } from './screens/DashboardScreen';
import { PeopleListScreen } from './screens/PeopleListScreen';
import { StatsScreen } from './screens/StatsScreen';
import { ModesScreen } from './screens/ModesScreen';
import { ContaScreen } from './screens/ContaScreen';
import { useStore } from './lib/store';
import { useConta } from './lib/conta';
import { colors, space, typography } from './lib/theme';

type Tela =
  | { nome: 'import' }
  | { nome: 'dashboard' }
  | { nome: 'lista'; lista: ListaId }
  | { nome: 'stats' }
  | { nome: 'modos' }
  | { nome: 'conta' };

/**
 * Aviso ao usuario. O Alert do react-native-web e um no-op silencioso, e um erro
 * de import que nao aparece e pior que um erro feio.
 */
function avisar(titulo: string, mensagem: string): void {
  if (Platform.OS === 'web') globalThis.alert(`${titulo}\n\n${mensagem}`);
  else Alert.alert(titulo, mensagem);
}

export default function App() {
  const [tela, setTela] = useState<Tela>({ nome: 'dashboard' });
  // Cobre o intervalo entre escolher o arquivo e o import comecar. Num export
  // completo isso e dezenas de segundos so de copiar e ler o zip — sem indicador,
  // parece que o botao nao funcionou e o usuario toca de novo.
  const [lendo, setLendo] = useState(false);
  const { loading, importing, progress, snapshot, reports, snapshotCount, error, boot, importZip } =
    useStore();

  const iniciarConta = useConta((c) => c.iniciar);

  useEffect(() => {
    void boot();
    // Tenta restaurar a sessao sem travar a abertura: quem nao tem conta segue
    // direto para o modo local, que e o padrao.
    void iniciarConta();
  }, [boot, iniciarConta]);

  const escolherArquivo = async () => {
    const fonte = await escolherArquivoDoExport();
    if (!fonte) return;

    setLendo(true);
    try {
      const { ok, message } = await importZip(fonte);

      if (!ok) {
        avisar('Não deu para importar', message ?? 'Tente novamente.');
        return;
      }
      setTela({ nome: 'dashboard' });
    } catch (erro) {
      // "Não é um zip" tem causa e solução conhecidas; vale dizer qual é em vez
      // de cair na mensagem genérica, que já culpou um arquivo perfeito uma vez.
      avisar(
        erro instanceof ArquivoNaoEhZip ? 'Arquivo não reconhecido' : 'Não deu para ler o arquivo',
        erro instanceof ArquivoNaoEhZip
          ? erro.message
          : 'Tente novamente. Se persistir, refaça o pedido do export.',
      );
    } finally {
      setLendo(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.centro}>
          <ActivityIndicator color={colors.gained} />
          <Text style={styles.carregando}>Carregando seus imports…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const semDados = !snapshot || !reports;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {tela.nome === 'conta' ? (
        <ContaScreen onBack={() => setTela({ nome: semDados ? 'import' : 'dashboard' })} />
      ) : tela.nome === 'modos' ? (
        <ModesScreen onBack={() => setTela({ nome: semDados ? 'import' : 'dashboard' })} />
      ) : semDados || tela.nome === 'import' ? (
        <ImportGuideScreen
          onPickFile={escolherArquivo}
          onOpenModes={() => setTela({ nome: 'modos' })}
          onOpenConta={() => setTela({ nome: 'conta' })}
          importing={importing || lendo}
          progress={progress}
          error={error}
        />
      ) : tela.nome === 'lista' ? (
        <PeopleListScreen
          lista={tela.lista}
          insights={reports.insights}
          diff={reports.diff}
          onBack={() => setTela({ nome: 'dashboard' })}
        />
      ) : tela.nome === 'stats' ? (
        <StatsScreen
          reports={reports}
          snapshotCount={snapshotCount}
          onBack={() => setTela({ nome: 'dashboard' })}
        />
      ) : (
        <DashboardScreen
          snapshot={snapshot}
          reports={reports}
          snapshotCount={snapshotCount}
          onOpenList={(lista) => setTela({ nome: 'lista', lista })}
          onOpenStats={() => setTela({ nome: 'stats' })}
          onImportAgain={() => setTela({ nome: 'import' })}
          onOpenModes={() => setTela({ nome: 'modos' })}
          onOpenConta={() => setTela({ nome: 'conta' })}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  carregando: { color: colors.inkMuted, fontSize: typography.scale.caption },
});

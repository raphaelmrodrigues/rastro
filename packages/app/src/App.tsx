/**
 * Raiz do app.
 *
 * Navegacao por estado, sem biblioteca de rotas: sao cinco telas e uma pilha de
 * um nivel so. Trocar por expo-router quando houver deep link ou aba — antes
 * disso, a dependencia custa mais do que resolve.
 *
 * O app funciona inteiro offline. Nao ha chamada de rede em lugar nenhum deste
 * pacote: o zip e lido no aparelho e os snapshots ficam no armazenamento local.
 * Sincronizar com servidor e opt-in e ainda nao esta ligado aqui.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { ImportGuideScreen } from './screens/ImportGuideScreen';
import { DashboardScreen, type ListaId } from './screens/DashboardScreen';
import { PeopleListScreen } from './screens/PeopleListScreen';
import { StatsScreen } from './screens/StatsScreen';
import { ModesScreen } from './screens/ModesScreen';
import { useStore } from './lib/store';
import { colors, space, typography } from './lib/theme';

type Tela =
  | { nome: 'import' }
  | { nome: 'dashboard' }
  | { nome: 'lista'; lista: ListaId }
  | { nome: 'stats' }
  | { nome: 'modos' };

/**
 * Converte o arquivo escolhido em ArrayBuffer.
 *
 * No navegador o picker devolve uma blob: URL, que o fetch le direto. No aparelho
 * o URI e file:// ou content://, que o fetch nao abre de forma confiavel no
 * Android — por isso o caminho nativo passa pelo expo-file-system, em base64.
 */
async function lerArquivo(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    return (await fetch(uri)).arrayBuffer();
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

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
  const { loading, importing, snapshot, reports, snapshotCount, error, boot, importZip } = useStore();

  useEffect(() => {
    void boot();
  }, [boot]);

  const escolherArquivo = async () => {
    const resultado = await DocumentPicker.getDocumentAsync({
      // O Instagram entrega .zip; alguns aparelhos reportam o mime generico.
      type: ['application/zip', 'application/octet-stream', '*/*'],
      copyToCacheDirectory: true,
    });

    if (resultado.canceled || !resultado.assets?.[0]) return;

    try {
      const data = await lerArquivo(resultado.assets[0].uri);
      const { ok, message } = await importZip(data);

      if (!ok) {
        avisar('Não deu para importar', message ?? 'Tente novamente.');
        return;
      }
      setTela({ nome: 'dashboard' });
    } catch {
      avisar(
        'Não deu para ler o arquivo',
        'Confira se é o .zip que o Instagram enviou, sem descompactar.',
      );
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

      {tela.nome === 'modos' ? (
        <ModesScreen onBack={() => setTela({ nome: semDados ? 'import' : 'dashboard' })} />
      ) : semDados || tela.nome === 'import' ? (
        <ImportGuideScreen
          onPickFile={escolherArquivo}
          onOpenModes={() => setTela({ nome: 'modos' })}
          importing={importing}
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

/**
 * Persistencia local dos snapshots.
 *
 * Modo privado: os dados moram no diretorio do app, no aparelho, e nao sao
 * enviados a lugar nenhum. Um snapshot por arquivo, mais um indice leve — assim a
 * tela inicial abre sem carregar milhares de @s na memoria.
 *
 * Retencao: guardamos os N snapshots mais recentes. O historico completo e feature
 * do modo com servidor; aqui o objetivo e o aparelho nao virar um arquivo morto de
 * dados sensiveis.
 */

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { Snapshot } from '@rastro/core';

/**
 * A API de arquivos mudou no SDK 54: `documentDirectory` + funções soltas viraram
 * as classes `Directory` e `File`. A antiga ainda existe em
 * `expo-file-system/legacy`, mas importar de lá seria adiar a migração para uma
 * versão em que ela já não exista — e este arquivo tem seis chamadas, não
 * sessenta.
 *
 * Diferença que importa ao ler o código: `exists`, `create`, `write` e `delete`
 * são síncronos agora; só a leitura de conteúdo (`text()`) é assíncrona.
 *
 * Tudo aqui é função, e não constante de módulo, por causa do navegador: no web o
 * expo-file-system é um esboço que lança em `Paths.document`. Um
 * `const ROOT = new Directory(...)` no topo do arquivo roda na importação, antes
 * de qualquer `if (isWeb)` — e derruba o app inteiro numa tela branca, mesmo no
 * caminho que nunca tocaria em disco.
 */
const raiz = () => new Directory(Paths.document, 'rastro');
const arquivoDoIndice = (root: Directory) => new File(root, 'index.json');

/** Quantos snapshots completos ficam no aparelho. */
const MAX_SNAPSHOTS = 12;

/**
 * No navegador o expo-file-system nao existe (nao ha sistema de arquivos), entao
 * o mesmo contrato e atendido por localStorage.
 *
 * O alvo do produto e mobile; o web serve para desenvolver e testar sem precisar
 * passar o zip para o celular. Por isso a limitacao de tamanho do localStorage
 * (~5 MB, o que da uns poucos milhares de seguidores por snapshot) e aceitavel
 * aqui e nao vale a complexidade de IndexedDB.
 */
const isWeb = Platform.OS === 'web';
const webKey = (name: string) => `rastro:${name}`;

const webStore = {
  read(name: string): string | null {
    return globalThis.localStorage?.getItem(webKey(name)) ?? null;
  },
  write(name: string, content: string): void {
    globalThis.localStorage?.setItem(webKey(name), content);
  },
  remove(name: string): void {
    globalThis.localStorage?.removeItem(webKey(name));
  },
  clear(): void {
    const storage = globalThis.localStorage;
    if (!storage) return;
    for (const key of Object.keys(storage)) {
      if (key.startsWith('rastro:')) storage.removeItem(key);
    }
  },
};

export interface SnapshotIndexEntry {
  id: string;
  importedAt: number;
  followerCount: number;
  followingCount: number;
  format?: string;
  hasWarnings: boolean;
}

/** Garante o diretorio e devolve ele; so pode ser chamada fora do web. */
function ensureRoot(): Directory {
  const root = raiz();
  if (!root.exists) root.create({ intermediates: true });
  return root;
}

export async function readIndex(): Promise<SnapshotIndexEntry[]> {
  try {
    let raw: string | null;

    if (isWeb) {
      raw = webStore.read('index');
    } else {
      const arquivo = arquivoDoIndice(ensureRoot());
      raw = arquivo.exists ? await arquivo.text() : null;
    }

    if (!raw) return [];
    const parsed = JSON.parse(raw) as SnapshotIndexEntry[];
    return parsed.sort((a, b) => b.importedAt - a.importedAt);
  } catch {
    // Indice corrompido nao pode impedir o app de abrir; o pior caso e recomecar.
    return [];
  }
}

export async function loadSnapshot(id: string): Promise<Snapshot | null> {
  try {
    if (isWeb) {
      const raw = webStore.read(id);
      return raw ? (JSON.parse(raw) as Snapshot) : null;
    }
    const arquivo = new File(raiz(), `${id}.json`);
    return arquivo.exists ? (JSON.parse(await arquivo.text()) as Snapshot) : null;
  } catch {
    return null;
  }
}

/** Grava o snapshot e atualiza o indice, descartando os mais antigos. */
export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const serialized = JSON.stringify(snapshot);

  // Uma raiz so para a funcao inteira: no web ela nem e construida.
  const root = isWeb ? null : ensureRoot();

  if (root === null) {
    webStore.write(snapshot.id, serialized);
  } else {
    const arquivo = new File(root, `${snapshot.id}.json`);
    // `create` so quando falta: gravar sobre um arquivo existente lança.
    if (!arquivo.exists) arquivo.create();
    arquivo.write(serialized);
  }

  const entry: SnapshotIndexEntry = {
    id: snapshot.id,
    importedAt: snapshot.importedAt,
    followerCount: snapshot.relationships.followers.length,
    followingCount: snapshot.relationships.following.length,
    ...(snapshot.format ? { format: snapshot.format } : {}),
    hasWarnings: snapshot.warnings.length > 0,
  };

  const index = [entry, ...(await readIndex()).filter((e) => e.id !== snapshot.id)].sort(
    (a, b) => b.importedAt - a.importedAt,
  );

  const kept = index.slice(0, MAX_SNAPSHOTS);
  for (const dropped of index.slice(MAX_SNAPSHOTS)) {
    if (root === null) {
      webStore.remove(dropped.id);
    } else {
      const antigo = new File(root, `${dropped.id}.json`);
      // `exists` antes de apagar: a API nova lança se o arquivo não estiver lá,
      // e a antiga tinha `idempotent: true` para exatamente este caso.
      if (antigo.exists) antigo.delete();
    }
  }

  const serializedIndex = JSON.stringify(kept);
  if (root === null) {
    webStore.write('index', serializedIndex);
  } else {
    const indice = arquivoDoIndice(root);
    if (!indice.exists) indice.create();
    indice.write(serializedIndex);
  }
}

/**
 * Apaga tudo. Precisa existir e precisa estar acessivel na interface: o app guarda
 * a rede social inteira de uma pessoa, e ela tem que conseguir tirar isso do
 * aparelho sem desinstalar nada.
 */
export async function eraseEverything(): Promise<void> {
  if (isWeb) {
    webStore.clear();
    return;
  }
  const root = raiz();
  if (root.exists) root.delete();
}

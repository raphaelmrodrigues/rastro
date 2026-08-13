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
import * as FileSystem from 'expo-file-system';
import type { Snapshot } from '@rastro/core';

const ROOT = `${FileSystem.documentDirectory}rastro/`;
const INDEX_FILE = `${ROOT}index.json`;

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

async function ensureRoot(): Promise<void> {
  const info = await FileSystem.getInfoAsync(ROOT);
  if (!info.exists) await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
}

export async function readIndex(): Promise<SnapshotIndexEntry[]> {
  try {
    let raw: string | null;

    if (isWeb) {
      raw = webStore.read('index');
    } else {
      await ensureRoot();
      const info = await FileSystem.getInfoAsync(INDEX_FILE);
      raw = info.exists ? await FileSystem.readAsStringAsync(INDEX_FILE) : null;
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
    const raw = isWeb
      ? webStore.read(id)
      : await FileSystem.readAsStringAsync(`${ROOT}${id}.json`);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

/** Grava o snapshot e atualiza o indice, descartando os mais antigos. */
export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const serialized = JSON.stringify(snapshot);

  if (isWeb) {
    webStore.write(snapshot.id, serialized);
  } else {
    await ensureRoot();
    await FileSystem.writeAsStringAsync(`${ROOT}${snapshot.id}.json`, serialized);
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
    if (isWeb) webStore.remove(dropped.id);
    else await FileSystem.deleteAsync(`${ROOT}${dropped.id}.json`, { idempotent: true });
  }

  const serializedIndex = JSON.stringify(kept);
  if (isWeb) webStore.write('index', serializedIndex);
  else await FileSystem.writeAsStringAsync(INDEX_FILE, serializedIndex);
}

/**
 * Apaga tudo. Precisa existir e precisa estar acessivel na interface: o app guarda
 * a rede social inteira de uma pessoa, e ela tem que conseguir tirar isso do
 * aparelho sem desinstalar nada.
 */
export async function eraseEverything(): Promise<void> {
  if (isWeb) webStore.clear();
  else await FileSystem.deleteAsync(ROOT, { idempotent: true });
}

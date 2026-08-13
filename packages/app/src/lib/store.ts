/**
 * Estado do app.
 *
 * Guarda os dois snapshots mais recentes carregados e os relatorios derivados.
 * Tudo o que aparece na tela e funcao dos snapshots — nada de estado paralelo
 * "lista atual de seguidores" que possa divergir do arquivo importado.
 */

import { create } from 'zustand';
import {
  computeCohorts,
  computeInsights,
  diffSnapshots,
  followersByPeriod,
  isSnapshotUsable,
  stalePendingRequests,
  type Relationship,
  type Snapshot,
  type SnapshotDiff,
  type SnapshotInsights,
  type Cohort,
} from '@rastro/core';
// Sem extensao nos imports relativos: o Metro (React Native) nao resolve o
// sufixo .js que o core usa por causa do NodeNext.
import { loadSnapshot, readIndex, saveSnapshot, eraseEverything } from './storage';
import { snapshotFromZip } from './importExport';

export interface Reports {
  insights: SnapshotInsights;
  diff: SnapshotDiff | null;
  cohorts: Cohort[];
  byPeriod: Array<{ period: string; count: number }>;
  stalePending: Relationship[];
}

interface State {
  loading: boolean;
  importing: boolean;
  snapshot: Snapshot | null;
  previous: Snapshot | null;
  reports: Reports | null;
  snapshotCount: number;
  error: string | null;

  boot: () => Promise<void>;
  importZip: (data: ArrayBuffer) => Promise<{ ok: boolean; message?: string }>;
  eraseAll: () => Promise<void>;
}

function buildReports(snapshot: Snapshot, previous: Snapshot | null): Reports {
  return {
    insights: computeInsights(snapshot),
    diff: previous ? diffSnapshots(previous, snapshot) : null,
    cohorts: previous ? computeCohorts(previous, snapshot) : [],
    byPeriod: followersByPeriod(snapshot),
    stalePending: stalePendingRequests(snapshot),
  };
}

/** Identificador simples do snapshot; nao precisa ser criptografico. */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useStore = create<State>((set, get) => ({
  loading: true,
  importing: false,
  snapshot: null,
  previous: null,
  reports: null,
  snapshotCount: 0,
  error: null,

  async boot() {
    set({ loading: true });
    const index = await readIndex();

    if (index.length === 0) {
      set({ loading: false, snapshot: null, previous: null, reports: null, snapshotCount: 0 });
      return;
    }

    const snapshot = await loadSnapshot(index[0].id);
    const previous = index.length > 1 ? await loadSnapshot(index[1].id) : null;

    set({
      loading: false,
      snapshot,
      previous,
      snapshotCount: index.length,
      reports: snapshot ? buildReports(snapshot, previous) : null,
    });
  },

  async importZip(data) {
    set({ importing: true, error: null });
    try {
      const { snapshot, filesFound } = await snapshotFromZip(data, newId());

      if (filesFound === 0) {
        set({ importing: false });
        return {
          ok: false,
          message:
            'Não encontramos as listas de seguidores neste arquivo. Ao pedir o export, ' +
            'inclua "Seguidores e seguindo".',
        };
      }

      // Snapshot vazio, se salvo, faz a proxima comparacao acusar a base inteira
      // como perdida. Recusar o import e menos grave que corromper o historico.
      if (!isSnapshotUsable(snapshot)) {
        set({ importing: false });
        return {
          ok: false,
          message: 'O arquivo foi lido, mas não havia nenhum seguidor na lista.',
        };
      }

      const anterior = get().snapshot;
      await saveSnapshot(snapshot);

      set({
        importing: false,
        snapshot,
        previous: anterior,
        snapshotCount: get().snapshotCount + 1,
        reports: buildReports(snapshot, anterior),
      });

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao ler o arquivo.';
      set({ importing: false, error: message });
      return { ok: false, message };
    }
  },

  async eraseAll() {
    await eraseEverything();
    set({ snapshot: null, previous: null, reports: null, snapshotCount: 0 });
  },
}));

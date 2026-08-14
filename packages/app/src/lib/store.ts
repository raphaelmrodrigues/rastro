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
import { useConta } from './conta';
import type { FonteArquivo } from './zip';

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
  /** Fração já lida do zip (0..1). O export completo leva dezenas de segundos. */
  progress: number;
  snapshot: Snapshot | null;
  previous: Snapshot | null;
  reports: Reports | null;
  snapshotCount: number;
  error: string | null;

  boot: () => Promise<void>;
  importZip: (fonte: FonteArquivo) => Promise<{ ok: boolean; message?: string }>;
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
  progress: 0,
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

  async importZip(fonte) {
    set({ importing: true, progress: 0, error: null });
    try {
      const { snapshot, filesFound } = await snapshotFromZip(fonte, newId(), (fracao) =>
        set({ progress: fracao }),
      );

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

      /*
       * Envio ao servidor, se houver conta. Depois de gravar e sem `await`:
       * o import já está completo e válido neste aparelho, e prender a tela
       * esperando a rede transformaria a parte confiável do produto na parte
       * frágil. Falha de envio vira estado 'pendente' na tela de conta, nunca
       * um import perdido.
       *
       * `sincronizar` sai cedo e em silêncio quando não há conta — que é o modo
       * padrão. Nenhum byte é enviado sem o usuário ter criado conta.
       */
      void useConta.getState().sincronizar(snapshot);

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

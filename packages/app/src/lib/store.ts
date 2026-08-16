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
  type ActivityData,
} from '@rastro/core';
// Sem extensao nos imports relativos: o Metro (React Native) nao resolve o
// sufixo .js que o core usa por causa do NodeNext.
import {
  loadSnapshot,
  readActivity,
  readIndex,
  saveActivity,
  saveSnapshot,
  eraseEverything,
} from './storage';
import { snapshotFromZip } from './importExport';
import { relatarErro, relatarImport } from './telemetria';
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
  /**
   * Resumo do export completo, quando o usuário já mandou um.
   *
   * `null` significa "ainda só o export rápido" — e é o que faz a aba Atividade
   * oferecer o export completo em vez de mostrar telas vazias.
   */
  atividade: ActivityData | null;
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
  atividade: null,
  error: null,

  async boot() {
    set({ loading: true });
    const index = await readIndex();
    const atividade = await readActivity();

    if (index.length === 0) {
      set({
        loading: false,
        snapshot: null,
        previous: null,
        reports: null,
        snapshotCount: 0,
        atividade,
      });
      return;
    }

    const snapshot = await loadSnapshot(index[0].id);
    const previous = index.length > 1 ? await loadSnapshot(index[1].id) : null;

    set({
      loading: false,
      snapshot,
      previous,
      snapshotCount: index.length,
      atividade,
      reports: snapshot ? buildReports(snapshot, previous) : null,
    });
  },

  async importZip(fonte) {
    set({ importing: true, progress: 0, error: null });
    try {
      const { snapshot, filesFound, atividade } = await snapshotFromZip(fonte, newId(), (fracao) =>
        set({ progress: fracao }),
      );

      /*
       * Relata antes de qualquer recusa abaixo, e de propósito.
       *
       * Os dois casos que mais interessam — arquivo sem lista nenhuma e snapshot
       * vazio — são exatamente os que fazem o import ser rejeitado. Relatar só
       * no caminho de sucesso deixaria de fora o dia em que o Instagram mudar o
       * formato, que é o dia inteiro do porquê disto existir.
       */
      relatarImport(snapshot, filesFound);

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

      /*
       * A atividade só é substituída quando o arquivo novo traz atividade.
       *
       * Sem esse cuidado, quem mandou o export completo e depois mandou um
       * export rápido — o caminho normal, porque o rápido é o que o app pede —
       * perderia as conversas e os anunciantes sem entender por quê. O resumo
       * antigo continua válido: ele descreve um retrato de quando foi feito, e a
       * tela mostra a data.
       */
      if (atividade) await saveActivity(atividade);

      set({
        importing: false,
        snapshot,
        previous: anterior,
        snapshotCount: get().snapshotCount + 1,
        reports: buildReports(snapshot, anterior),
        ...(atividade ? { atividade } : {}),
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
      // Exceção no import não é falha de parsing (que vira warning): é bug nosso
      // ou arquivo em formato que o descompactador não conhece. Vale um relato.
      relatarErro(error, 'importZip');
      const message = error instanceof Error ? error.message : 'Falha ao ler o arquivo.';
      set({ importing: false, error: message });
      return { ok: false, message };
    }
  },

  async eraseAll() {
    await eraseEverything();
    set({ snapshot: null, previous: null, reports: null, snapshotCount: 0, atividade: null });
  },
}));

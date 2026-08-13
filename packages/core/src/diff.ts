/**
 * Comparação entre dois snapshots.
 *
 * Esta é a lógica que o usuário confia. Se ela errar, o produto perde a razão de existir.
 * Mudanças aqui exigem teste.
 */

import type {
  DiffReliability,
  FollowEvent,
  Relationship,
  Snapshot,
  SnapshotDiff,
} from './types.js';

/**
 * Tolerância para casar uma saída com uma entrada como sendo a mesma pessoa
 * que trocou de @. Se os dois têm o mesmo "since" (momento em que passaram a te
 * seguir), é quase certo que são a mesma conta renomeada — o Instagram preserva
 * essa data ao renomear.
 */
const RENAME_EXACT_TOLERANCE_MS = 1000;
/** Mesma ideia, folga maior: mesmo minuto. Confiança menor. */
const RENAME_LOOSE_TOLERANCE_MS = 60_000;

function byUsername(list: Relationship[]): Map<string, Relationship> {
  return new Map(list.map((r) => [r.username, r]));
}

/**
 * Tenta explicar pares (saiu X, entrou Y) como uma única conta que trocou de @.
 *
 * Motivo: o export não traz o ID numérico da conta, só o @. Sem esta etapa, toda
 * renomeação vira um falso "deixou de seguir" — erro que a concorrência comete em
 * silêncio e que o usuário não tem como perceber.
 *
 * ## As duas condições, e por que a segunda não é opcional
 *
 * 1. Os dois lados têm praticamente o mesmo `since`. O Instagram preserva a data
 *    em que a pessoa passou a seguir quando ela troca de @, então o par sobrevive
 *    à renomeação.
 *
 * 2. **O `since` do lado que "entrou" é anterior ao import passado.** Uma conta
 *    que aparece agora na lista dizendo que segue você desde antes do último
 *    import não entrou agora — ela já estava lá com outro nome.
 *
 * A condição 1 sozinha produz falso positivo justamente nas contas que mais usam
 * o app: quando um post rende bem, dezenas de pessoas passam a seguir no mesmo
 * minuto. Se uma delas sai e outra entra com `since` vizinho, a heurística de
 * tempo puro anuncia uma troca de @ que nunca houve — e o usuário perde de vista
 * alguém que realmente saiu. A condição 2 corta esse caso, porque um seguidor
 * genuinamente novo tem `since` dentro da janela entre os dois imports.
 */
function detectRenames(
  lost: Relationship[],
  gained: Relationship[],
  windowStart: number,
): Array<{ from: string; to: string; confidence: 'high' | 'medium' }> {
  const renames: Array<{ from: string; to: string; confidence: 'high' | 'medium' }> = [];
  // Só quem alega seguir desde antes do último import pode ser um @ renomeado.
  const availableGains = gained.filter((g) => g.since < windowStart);

  for (const out of lost) {
    let bestIndex = -1;
    let bestConfidence: 'high' | 'medium' | null = null;

    for (let i = 0; i < availableGains.length; i++) {
      const delta = Math.abs(availableGains[i].since - out.since);
      if (delta <= RENAME_EXACT_TOLERANCE_MS) {
        bestIndex = i;
        bestConfidence = 'high';
        break;
      }
      if (delta <= RENAME_LOOSE_TOLERANCE_MS && bestConfidence === null) {
        bestIndex = i;
        bestConfidence = 'medium';
      }
    }

    if (bestIndex >= 0 && bestConfidence) {
      renames.push({
        from: out.username,
        to: availableGains[bestIndex].username,
        confidence: bestConfidence,
      });
      availableGains.splice(bestIndex, 1);
    }
  }

  return renames;
}

/**
 * Fração da base que, se sumir de uma vez, é mais provável ser defeito do export
 * do que unfollow de verdade.
 *
 * 30% da base indo embora entre dois imports não acontece numa conta real sem um
 * evento extraordinário. Acontece, sim, quando falta um arquivo `followers_2.html`
 * ou quando o export foi pedido com período limitado. Nesses casos o certo é
 * duvidar em voz alta, não imprimir a lista.
 */
const MASS_LOSS_RATIO = 0.3;
/** Abaixo disto a proporção não diz nada: perder 3 de 5 seguidores é normal. */
const MASS_LOSS_MIN_BASE = 20;

/**
 * Decide se este par de snapshots é comparável.
 *
 * As três suspeitas, em ordem de gravidade:
 *  1. os exports declaram coberturas de tempo diferentes;
 *  2. sumiu uma fatia grande demais da base de uma só vez;
 *  3. o snapshot novo é drasticamente menor que o anterior.
 */
function assessReliability(
  previous: Snapshot,
  current: Snapshot,
  lostCount: number,
): DiffReliability {
  const reasons: string[] = [];
  const baseCount = previous.relationships.followers.length;

  const previousWindow = previous.dataWindow;
  const currentWindow = current.dataWindow;
  if (Boolean(previousWindow) !== Boolean(currentWindow)) {
    reasons.push(
      'Um dos exports cobre a conta inteira e o outro só um período. ' +
        'As listas não são comparáveis: peça os dois com "Todo o período".',
    );
  } else if (previousWindow && currentWindow && previousWindow.from !== currentWindow.from) {
    reasons.push(
      'Os dois exports começam em datas diferentes, então parte da diferença é ' +
        'recorte do arquivo, não gente que saiu.',
    );
  }

  if (baseCount >= MASS_LOSS_MIN_BASE && lostCount / baseCount >= MASS_LOSS_RATIO) {
    const percent = Math.round((lostCount / baseCount) * 100);
    reasons.push(
      `${percent}% da sua base sumiu de uma vez (${lostCount} de ${baseCount}). ` +
        'Isso costuma ser arquivo incompleto — um export pedido com período ' +
        'limitado, ou um arquivo de seguidores que não veio junto.',
    );
  }

  return { level: reasons.length > 0 ? 'suspect' : 'ok', reasons };
}

export interface DiffOptions {
  /**
   * Quando true, pares de rename com confiança 'high' saem de gained/lost.
   * Os de confiança 'medium' permanecem, mas marcados com suspectedRename,
   * para o usuário decidir. Padrão: true.
   */
  collapseHighConfidenceRenames?: boolean;
}

export function diffSnapshots(
  previous: Snapshot,
  current: Snapshot,
  options: DiffOptions = {},
): SnapshotDiff {
  const { collapseHighConfidenceRenames = true } = options;

  const before = byUsername(previous.relationships.followers);
  const after = byUsername(current.relationships.followers);

  const lostRaw = [...before.values()].filter((r) => !after.has(r.username));
  const gainedRaw = [...after.values()].filter((r) => !before.has(r.username));

  const windowStart = previous.importedAt;
  const windowEnd = current.importedAt;

  const renames = detectRenames(lostRaw, gainedRaw, windowStart);
  const highFrom = new Set(renames.filter((r) => r.confidence === 'high').map((r) => r.from));
  const highTo = new Set(renames.filter((r) => r.confidence === 'high').map((r) => r.to));
  const mediumByFrom = new Map(
    renames.filter((r) => r.confidence === 'medium').map((r) => [r.from, r]),
  );

  const gained: FollowEvent[] = gainedRaw
    .filter((r) => !(collapseHighConfidenceRenames && highTo.has(r.username)))
    .map((r) => ({
      username: r.username,
      href: r.href,
      type: 'followed' as const,
      // Data exata: o próprio export diz quando esta pessoa passou a seguir.
      precision: 'exact' as const,
      at: r.since,
      windowStart: r.since,
      windowEnd: r.since,
    }));

  const lost: FollowEvent[] = lostRaw
    .filter((r) => !(collapseHighConfidenceRenames && highFrom.has(r.username)))
    .map((r) => {
      const suspect = mediumByFrom.get(r.username);
      return {
        username: r.username,
        href: r.href,
        type: 'unfollowed' as const,
        // Nunca sabemos o momento exato de um unfollow. Só a janela entre imports.
        precision: 'window' as const,
        at: windowEnd,
        windowStart,
        windowEnd,
        ...(suspect
          ? { suspectedRename: { counterpart: suspect.to, confidence: 'medium' as const } }
          : {}),
      };
    });

  return {
    previousSnapshotId: previous.id,
    currentSnapshotId: current.id,
    windowStart,
    windowEnd,
    gained,
    lost,
    renames,
    netChange: gained.length - lost.length,
    reliability: assessReliability(previous, current, lost.length),
  };
}

/**
 * Diff acumulado sobre uma série de snapshots em ordem cronológica.
 * Usado para montar a linha do tempo completa.
 */
export function diffTimeline(snapshots: Snapshot[], options?: DiffOptions): SnapshotDiff[] {
  const ordered = [...snapshots].sort((a, b) => a.importedAt - b.importedAt);
  const diffs: SnapshotDiff[] = [];
  for (let i = 1; i < ordered.length; i++) {
    diffs.push(diffSnapshots(ordered[i - 1], ordered[i], options));
  }
  return diffs;
}

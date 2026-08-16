/**
 * Parser do export de dados do Instagram.
 *
 * Recebe um mapa { nomeDoArquivo -> conteúdo } e devolve um Snapshot normalizado.
 * O conteúdo pode ser JSON já parseado ou a string HTML crua: o Instagram entrega
 * o export nos dois formatos e o usuário escolhe na hora do pedido. Quem lê o zip
 * é a camada de fora (app ou api) — este pacote não toca em I/O.
 *
 * Princípio: nunca lançar por causa de um arquivo estranho. Colete um warning e siga.
 * O formato do export muda sem aviso; um import parcial é melhor que um import falho.
 */

import { looksLikeHtml, parseHtmlList, usernameFromHref, type HtmlEntry } from './htmlExport.js';
import {
  DISPLAY_NAME_LABELS,
  normalizeLabel,
  repairMojibake,
  URL_LABELS,
  USERNAME_LABELS,
} from './text.js';
import type {
  ExportFormat,
  ParseWarning,
  Relationship,
  RelationshipKind,
  Snapshot,
} from './types.js';

/**
 * Forma bruta de uma entrada do export em JSON.
 *
 * São três formas diferentes dentro do MESMO export — confirmado em arquivo real
 * de agosto/2026:
 *
 * 1. followers_1.json ....... string_list_data[0].value tem o @
 * 2. following.json ......... string_list_data[0] NÃO tem value; o @ está em title
 * 3. blocked_profiles.json .. sem string_list_data; label_values traz
 *    pending_follow_requests   [{label:"Nome de usuário", value:"fulano"}], com o
 *    recently_unfollowed       rótulo localizado e ainda por cima com mojibake
 *
 * Tratar só a forma 1 (o que fazíamos) descarta as outras duas em silêncio: no
 * export real isso era 1.355 de 2.716 registros, e "seguindo: 0" na tela.
 */
interface RawEntry {
  title?: string;
  /** Só nas listas em label_values: quando a relação começou. */
  timestamp?: number;
  string_list_data?: Array<{
    href?: string;
    value?: string;
    timestamp?: number;
  }>;
  label_values?: Array<{ label?: string; value?: string }>;
}

/**
 * Qual arquivo alimenta qual categoria.
 * A busca é por *sufixo* do caminho, porque a pasta já mudou de lugar entre versões,
 * e a extensão é livre porque o mesmo dado vem em .json ou .html.
 */
const FILE_MAP: Array<{ kind: RelationshipKind; matches: (name: string) => boolean }> = [
  // followers_1, followers_2, ... todos agregam na mesma lista.
  { kind: 'followers', matches: (n) => /followers_\d+\.(json|html)$/.test(n) },
  { kind: 'following', matches: (n) => /(^|\/)following\.(json|html)$/.test(n) },
  { kind: 'pendingRequestsSent', matches: (n) => /pending_follow_requests\.(json|html)$/.test(n) },
  { kind: 'recentlyUnfollowed', matches: (n) => /recently_unfollowed_profiles\.(json|html)$/.test(n) },
  { kind: 'blocked', matches: (n) => /blocked_profiles\.(json|html)$/.test(n) },
  { kind: 'closeFriends', matches: (n) => /close_friends\.(json|html)$/.test(n) },
  { kind: 'restricted', matches: (n) => /restricted_profiles\.(json|html)$/.test(n) },
];

/** Arquivos do export que interessam ao Rastro, em qualquer um dos dois formatos. */
export const RELEVANT_EXPORT_FILE =
  /(followers_\d+|following|pending_follow_requests|recently_unfollowed_profiles|blocked_profiles|close_friends|restricted_profiles)\.(json|html)$/;

const EMPTY_RELATIONSHIPS = (): Record<RelationshipKind, Relationship[]> => ({
  followers: [],
  following: [],
  pendingRequestsSent: [],
  recentlyUnfollowed: [],
  blocked: [],
  closeFriends: [],
  restricted: [],
});

/**
 * O export em JSON usa duas formas: array na raiz, ou objeto com uma única chave que
 * aponta para o array. Normalizamos aqui em vez de decorar o nome de cada chave,
 * porque as chaves mudam e a estrutura não.
 */
function extractEntries(
  raw: unknown,
  file: string,
  warnings: ParseWarning[],
): RawEntry[] {
  if (Array.isArray(raw)) return raw as RawEntry[];

  if (raw && typeof raw === 'object') {
    // Lista de um item só vem como o objeto cru, sem array em volta
    // (restricted_profiles.json com um único perfil). Precisa ser testado antes
    // da contagem de arrays: senão o media/label_values internos parecem "duas
    // listas" e a entrada é lida como se fosse três pessoas.
    if (isLabelValuesRecord(raw)) return [raw as RawEntry];

    const arrays = Object.values(raw as Record<string, unknown>).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as RawEntry[];
    if (arrays.length > 1) {
      warnings.push({
        code: 'UNKNOWN_FILE_SHAPE',
        file,
        detail: `Objeto com ${arrays.length} arrays; usando o maior. Verifique o formato.`,
      });
      return arrays.sort((a, b) => b.length - a.length)[0] as RawEntry[];
    }
  }

  warnings.push({
    code: 'UNKNOWN_FILE_SHAPE',
    file,
    detail: 'Não foi possível localizar a lista de contas neste arquivo.',
  });
  return [];
}

function isLabelValuesRecord(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as RawEntry).label_values) &&
    ('fbid' in raw || 'timestamp' in raw)
  );
}

/** Lê um par rótulo/valor da forma 3, já sem mojibake e sem acento no rótulo. */
function fromLabels(entry: RawEntry, labels: Set<string>): string | undefined {
  for (const par of entry.label_values ?? []) {
    if (par.label === undefined || !par.value) continue;
    if (labels.has(normalizeLabel(par.label))) return repairMojibake(par.value).trim();
  }
  return undefined;
}

/**
 * Uma entrada bruta -> Relationship, cobrindo as três formas.
 *
 * A ordem das tentativas é por confiabilidade decrescente. O href é o último
 * recurso para o @ porque o deep link (/_u/fulano) já apareceu apontando para
 * um perfil diferente do da linha em exports antigos.
 */
function toRelationship(
  entry: RawEntry,
  file: string,
  fallbackTimestamp: number,
  warnings: ParseWarning[],
): Relationship | null {
  const data = entry.string_list_data?.[0];
  const href = data?.href || fromLabels(entry, URL_LABELS) || undefined;

  const username = (
    data?.value?.trim() ||
    entry.title?.trim() ||
    fromLabels(entry, USERNAME_LABELS) ||
    (href ? usernameFromHref(href) : null) ||
    ''
  )
    .replace(/^@/, '')
    .toLowerCase();

  if (!username) return null;

  // title carrega o @ na forma 2 e o nome de exibição em nenhuma; só é nome
  // quando difere do @ que já achamos.
  const displayNameBruto = fromLabels(entry, DISPLAY_NAME_LABELS) ?? entry.title?.trim();
  const displayName =
    displayNameBruto && displayNameBruto.toLowerCase() !== username
      ? repairMojibake(displayNameBruto)
      : undefined;

  const timestamp = data?.timestamp ?? entry.timestamp;
  if (timestamp == null) {
    warnings.push({
      code: 'MISSING_TIMESTAMP',
      file,
      detail: `Entrada "${username}" sem timestamp; usando a data do import.`,
    });
  }

  return {
    username,
    ...(href ? { href } : {}),
    ...(displayName ? { displayName } : {}),
    // O Instagram usa epoch em SEGUNDOS. Multiplicar antes de virar Date.
    since: timestamp != null ? timestamp * 1000 : fallbackTimestamp,
  };
}

function htmlToRelationship(
  entry: HtmlEntry,
  file: string,
  fallbackTimestamp: number,
  warnings: ParseWarning[],
): Relationship {
  if (entry.since === undefined) {
    warnings.push({
      code: 'MISSING_TIMESTAMP',
      file,
      detail: `Entrada "${entry.username}" sem data legível; usando a data do import.`,
    });
  }

  return {
    username: entry.username,
    ...(entry.href ? { href: entry.href } : {}),
    ...(entry.displayName ? { displayName: entry.displayName } : {}),
    since: entry.since ?? fallbackTimestamp,
  };
}

/**
 * A data desta entrada veio do export, ou é o carimbo do import?
 *
 * As duas funções acima caem em `fallbackTimestamp` — que é sempre o
 * `importedAt` do snapshot — quando o export não traz data. Isso mantém o tipo
 * `Relationship` simples, mas cria uma armadilha para quem consome: `since`
 * sempre existe, e um valor falso é indistinguível de um verdadeiro.
 *
 * Algumas listas do export nunca trazem data (bloqueados e restritos, em vários
 * exports). Mostrar "bloqueado em 15/08/2026" quando 15/08 é só o dia em que a
 * pessoa mexeu no app é inventar um fato — e é o tipo de erro que o usuário
 * descobre e que derruba a confiança no resto do produto.
 *
 * Use isto antes de exibir qualquer data vinda de `Relationship`.
 */
export function hasKnownDate(relationship: Relationship, snapshot: Snapshot): boolean {
  return relationship.since !== snapshot.importedAt;
}

export interface ParseInput {
  /**
   * Caminho relativo dentro do zip -> conteúdo.
   * JSON já parseado (objeto/array) ou o HTML cru (string).
   */
  files: Record<string, unknown>;
  snapshotId: string;
  importedAt: number;
  exportedAt?: number;
  /**
   * Fuso a assumir para datas do export em HTML quando o cabeçalho não permitir
   * derivá-lo. Em minutos (-180 = Brasília). Ver htmlExport.ts.
   */
  fallbackTimezoneOffsetMinutes?: number;
}

/**
 * Monta um Snapshot a partir dos arquivos do export.
 *
 * Cuidado crítico: contas grandes têm followers_1, followers_2, ...
 * Se só o primeiro for lido, todo o resto da base vira "deixou de seguir" no próximo
 * diff. Por isso a agregação por categoria é acumulativa, nunca substitutiva.
 */
export function parseExport(input: ParseInput): Snapshot {
  const { files, snapshotId, importedAt, fallbackTimezoneOffsetMinutes } = input;
  const warnings: ParseWarning[] = [];
  const relationships = EMPTY_RELATIONSHIPS();
  const seenPerKind: Record<string, Set<string>> = {};

  let sawJson = false;
  let sawHtml = false;
  /** O HTML declara quando o export foi gerado; o JSON não diz. */
  let detectedExportedAt: number | undefined;
  let dataWindow: { from: number; to: number } | undefined;

  for (const [file, raw] of Object.entries(files)) {
    const normalized = file.replace(/\\/g, '/');
    const target = FILE_MAP.find((m) => m.matches(normalized));
    if (!target) continue;

    const seen = (seenPerKind[target.kind] ??= new Set<string>());
    const parsed: Relationship[] = [];

    if (looksLikeHtml(raw)) {
      sawHtml = true;
      const result = parseHtmlList(raw, normalized, warnings, {
        ...(fallbackTimezoneOffsetMinutes !== undefined
          ? { fallbackTimezoneOffsetMinutes }
          : {}),
      });
      if (result.generatedAt !== undefined) {
        // Vários arquivos declaram a mesma geração; ficamos com a mais recente.
        detectedExportedAt = Math.max(detectedExportedAt ?? 0, result.generatedAt);
      }
      if (result.dataWindow) dataWindow ??= result.dataWindow;
      for (const entry of result.entries) {
        parsed.push(htmlToRelationship(entry, normalized, importedAt, warnings));
      }
    } else {
      sawJson = true;
      const entries = extractEntries(raw, normalized, warnings);
      let ignoradas = 0;

      for (const entry of entries) {
        const rel = toRelationship(entry, normalized, importedAt, warnings);
        if (rel) parsed.push(rel);
        else ignoradas++;
      }

      // Entrada sem @ legível costuma significar formato novo, e formato novo
      // some com a lista inteira. Antes isto era descartado calado: um export
      // com 1.157 "seguindo" virava zero na tela, sem um aviso sequer.
      if (ignoradas > 0) {
        warnings.push({
          code: 'ENTRIES_SKIPPED',
          file: normalized,
          detail:
            `${ignoradas} de ${entries.length} entradas deste arquivo não tinham ` +
            'um @ legível e foram ignoradas. O formato do export pode ter mudado.',
        });
      }
    }

    for (const rel of parsed) {
      if (seen.has(rel.username)) {
        warnings.push({
          code: 'DUPLICATE_USERNAME',
          file: normalized,
          detail: `"${rel.username}" aparece mais de uma vez em ${target.kind}.`,
        });
        continue;
      }
      seen.add(rel.username);
      relationships[target.kind].push(rel);
    }
  }

  if (relationships.followers.length === 0) {
    warnings.push({
      code: 'MISSING_FILE',
      detail:
        'Nenhum seguidor encontrado. O export provavelmente não incluiu ' +
        '"Seguidores e seguindo", ou o formato mudou.',
    });
  }

  const format: ExportFormat | undefined =
    sawHtml && sawJson ? 'mixed' : sawHtml ? 'html' : sawJson ? 'json' : undefined;

  if (format === 'html' || format === 'mixed') {
    warnings.push({
      code: 'HTML_EXPORT',
      detail:
        'Export lido em HTML. Funciona, mas as datas têm precisão de minuto e ' +
        'dependem do fuso declarado no arquivo. Em JSON a data é exata.',
    });
  }

  if (dataWindow) {
    const months = Math.round((dataWindow.to - dataWindow.from) / (30 * 24 * 3600 * 1000));
    warnings.push({
      code: 'PARTIAL_EXPORT',
      detail:
        `Este export cobre apenas ${months} meses (de ` +
        `${new Date(dataWindow.from).toLocaleDateString('pt-BR')} a ` +
        `${new Date(dataWindow.to).toLocaleDateString('pt-BR')}), e não a conta inteira. ` +
        'Quem começou a seguir antes dessa data provavelmente não está na lista. ' +
        'Ao pedir o próximo export, escolha "Todo o período".',
    });
  }

  return {
    id: snapshotId,
    importedAt,
    ...(input.exportedAt ?? detectedExportedAt
      ? { exportedAt: input.exportedAt ?? detectedExportedAt }
      : {}),
    ...(format ? { format } : {}),
    ...(dataWindow ? { dataWindow } : {}),
    relationships,
    warnings,
  };
}

/**
 * Um import sem seguidores não deve ser salvo: se virar snapshot, o diff seguinte
 * reporta a base inteira como perdida e destrói a confiança do usuário.
 */
export function isSnapshotUsable(snapshot: Snapshot): boolean {
  return snapshot.relationships.followers.length > 0;
}
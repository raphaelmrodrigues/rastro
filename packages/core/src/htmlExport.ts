/**
 * Leitura das listas de conexões quando o export vem em HTML.
 *
 * Por que isto existe: a documentação manda pedir o export em JSON, e o JSON é de
 * fato melhor (epoch exato, estrutura estável). Mas o usuário real não segue a
 * instrução — ele pede o export pelo caminho que o app do Instagram oferece na
 * frente dele, e volta com HTML. Recusar o arquivo é perder o usuário depois de
 * ele ter esperado até 48h pelo download. Então lemos os dois.
 *
 * Pureza: só strings entram e objetos saem. Nada de DOM, nada de I/O — este módulo
 * roda igual no celular e no servidor, e por isso não usa DOMParser nem cheerio.
 *
 * ## As três formas que o mesmo export usa para dizer a mesma coisa
 *
 * 1. Lista com link (followers_1.html):
 *      <a href="https://www.instagram.com/fulano">fulano</a>
 *      <div>ago 10, 2026 4:38 da manhã</div>
 *
 * 2. Lista com título (following.html) — o @ aparece duas vezes, e o link vem
 *    no formato de deep link:
 *      <h2>fulano</h2>
 *      <a href="https://www.instagram.com/_u/fulano">...</a>
 *      <div>ago 11, 2026 1:07 da manhã</div>
 *
 * 3. Tabela rotulada (pending_follow_requests.html, recently_unfollowed_profiles.html,
 *    blocked_profiles.html, ...) — sem link nenhum, e o nome de exibição vem antes:
 *      <td>Nome</td><td>Gabrielle Chaime</td>
 *      <td>Nome de usuário</td><td>gabriellechaime</td>
 *      <div class="_3-94 _a6-o">ago 07, 2026 7:31 da tarde/noite</div>
 *
 * Em vez de escrever três parsers acoplados à classe CSS da vez — que o Instagram
 * troca a cada release, e que já são ofuscadas —, varremos o documento como um fluxo
 * de tokens ("achei um @", "achei uma data") e casamos cada @ com a data seguinte.
 * Layout novo com a mesma semântica continua funcionando.
 */

import { DISPLAY_NAME_LABELS, normalizeLabel, USERNAME_LABELS } from './text.js';
import type { ParseWarning } from './types.js';

/** Uma entrada já normalizada, no mesmo formato que o caminho JSON produz. */
export interface HtmlEntry {
  username: string;
  href?: string;
  displayName?: string;
  /** ms UTC. Ausente quando a linha não tinha data legível. */
  since?: number;
}

export interface HtmlParseResult {
  entries: HtmlEntry[];
  /**
   * Offset em minutos que foi aplicado às datas (ex.: -420 para UTC-7).
   * `null` quando não foi possível derivar — aí as datas foram lidas como UTC.
   */
  timezoneOffsetMinutes: number | null;
  /** Momento em que o Instagram gerou o export, em ms UTC. */
  generatedAt?: number;
  /** Intervalo que o export declara cobrir. Ver detectDataWindow. */
  dataWindow?: DataWindow;
}

/** Intervalo de tempo que o export cobre, declarado pelo próprio arquivo. */
export interface DataWindow {
  from: number;
  to: number;
}

// --- Idiomas -----------------------------------------------------------------
// O export sai no idioma da conta. Cobrimos português, inglês e espanhol, que é
// o que o público do app usa. Idioma desconhecido não quebra o import: a lista de
// @s continua saindo, só as datas viram warning.

/** Meses abreviados como aparecem nas linhas de data. Índice = mês (0-11). */
const SHORT_MONTHS: Record<string, number> = {
  // pt-BR
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
  // en-US (sobrepõe as iguais sem conflito de valor)
  feb: 1, apr: 3, may: 4, aug: 7, sep: 8, sept: 8, oct: 9, dec: 11,
  // es
  ene: 0, dic: 11,
};

/** Meses por extenso, usados só no cabeçalho ("11 de agosto de 2026 às 22:03"). */
const LONG_MONTHS: Record<string, number> = {
  janeiro: 0, fevereiro: 1, março: 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  enero: 0, febrero: 1, marzo: 2, mayo: 4, junio: 5, julio: 6, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

/**
 * Marcadores de período do dia. O HTML usa relógio de 12 horas, e o português do
 * Instagram escreve "da tarde/noite" — uma string só para os dois períodos.
 */
// Sem \b em volta das alternativas em português: "manhã" termina em caractere
// acentuado, que não é word character, e o \b nunca casaria depois dele.
const PM_MARKERS = /(da tarde|da noite|tarde\/noite|\bp\.?\s?m\.?)/i;
const AM_MARKERS = /(da manh[ãa]|da madrugada|\ba\.?\s?m\.?)/i;

// --- Utilitários de texto ----------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
    return whole;
  });
}

/**
 * Extrai o @ de uma URL de perfil.
 * O export usa dois formatos: instagram.com/fulano e instagram.com/_u/fulano
 * (deep link que abre o app). O segmento "_u" é rota, não pessoa.
 */
export function usernameFromHref(href: string): string | null {
  const match = /instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/i.exec(href);
  if (!match) return null;
  const candidate = match[1];
  // Rotas do próprio site que não são perfis.
  if (/^(p|reel|reels|stories|explore|accounts|direct)$/i.test(candidate)) return null;
  return candidate.toLowerCase();
}

// --- Datas -------------------------------------------------------------------

function toUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  offsetMinutes: number,
): number {
  // O texto está no fuso do export; subtrair o offset devolve o instante em UTC.
  return Date.UTC(year, month, day, hour, minute) - offsetMinutes * 60_000;
}

/**
 * Lê as datas das linhas de dados: "ago 10, 2026 4:38 da manhã".
 *
 * Devolve ms UTC, ou null se o texto não for uma data reconhecível — o chamador
 * decide se isso vira warning ou se simplesmente não era uma data (o varredor
 * usa esta função como teste para saber se um <div> é ou não uma data).
 */
export function parseEntryDate(raw: string, offsetMinutes = 0): number | null {
  const text = decodeEntities(raw).trim();
  const match = /^([\p{L}]{3,5})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/u.exec(text);
  if (!match) return null;

  const month = SHORT_MONTHS[normalizeLabel(match[1])];
  if (month === undefined) return null;

  const day = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31) return null;

  let hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);

  // Relógio de 12h: "12:30 da manhã" é 00:30, "12:30 da tarde" continua 12:30.
  if (PM_MARKERS.test(text) && hour < 12) hour += 12;
  else if (AM_MARKERS.test(text) && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) return null;
  return toUtc(year, month, day, hour, minute, offsetMinutes);
}

/**
 * Lê o formato longo do cabeçalho: "11 de agosto de 2026 às 22:03" (24h).
 * Usado só para descobrir o fuso; não alimenta nenhuma relação.
 */
function parseHeaderDate(raw: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const text = decodeEntities(raw).trim();

  // pt/es: "11 de agosto de 2026 às 22:03"
  let m = /(\d{1,2})\s+de\s+([\p{L}]+)\s+de\s+(\d{4})[^\d]+(\d{1,2}):(\d{2})/u.exec(text);
  if (m) {
    const mo = LONG_MONTHS[normalizeLabel(m[2])];
    if (mo === undefined) return null;
    return { y: Number(m[3]), mo, d: Number(m[1]), h: Number(m[4]), mi: Number(m[5]) };
  }

  // en: "August 11, 2026 at 10:03 PM"
  m = /([\p{L}]+)\s+(\d{1,2}),\s*(\d{4})[^\d]+(\d{1,2}):(\d{2})/u.exec(text);
  if (m) {
    const mo = LONG_MONTHS[normalizeLabel(m[1])];
    if (mo === undefined) return null;
    let h = Number(m[4]);
    if (PM_MARKERS.test(text) && h < 12) h += 12;
    else if (AM_MARKERS.test(text) && h === 12) h = 0;
    return { y: Number(m[3]), mo, d: Number(m[2]), h, mi: Number(m[5]) };
  }

  return null;
}

/**
 * Descobre em que fuso as datas do arquivo estão escritas.
 *
 * O truque: o cabeçalho traz o mesmo instante duas vezes, uma legível por máquina
 * e outra por humano —
 *
 *   <time datetime="2026-08-12T05:03Z">Terça-feira, 11 de agosto de 2026 às 22:03 UTC</time>
 *
 * A diferença entre as duas é o offset do arquivo. No export de teste dá -420min
 * (UTC-7), e repare que o texto se diz "UTC" e não está em UTC: o rótulo mente.
 *
 * Isso importa muito. Sem derivar o offset, todo horário do import sai 7 horas
 * deslocado, e um seguidor que entrou às 21h de segunda aparece como terça.
 *
 * Devolve null quando o cabeçalho não tem o par — aí o chamador assume UTC e avisa.
 */
export function detectTimezoneOffset(html: string): number | null {
  for (const match of html.matchAll(/<time[^>]*datetime="([^"]+)"[^>]*>([^<]*)<\/time>/gi)) {
    const isoMs = Date.parse(match[1]);
    if (Number.isNaN(isoMs)) continue;

    const local = parseHeaderDate(match[2]);
    if (!local) continue;

    const localAsUtc = Date.UTC(local.y, local.mo, local.d, local.h, local.mi);
    // Arredondar para 15 minutos absorve o segundo que o ISO tem e o texto não.
    const offset = Math.round((localAsUtc - isoMs) / 60_000 / 15) * 15;

    // Fusos reais vão de -12h a +14h. Fora disso, o par não era o que pensávamos.
    if (offset < -720 || offset > 840) continue;
    return offset;
  }
  return null;
}

/** Todos os instantes declarados no cabeçalho, na ordem em que aparecem. */
function headerTimes(html: string): number[] {
  const header = html.slice(0, html.search(/<main\b/i) === -1 ? html.length : html.search(/<main\b/i));
  const times: number[] = [];
  for (const match of header.matchAll(/<time[^>]*datetime="([^"]+)"/gi)) {
    const ms = Date.parse(match[1]);
    if (!Number.isNaN(ms)) times.push(ms);
  }
  return times;
}

/** Momento em que o Instagram gerou o export: o primeiro <time> do cabeçalho. */
function detectGeneratedAt(html: string): number | undefined {
  return headerTimes(html)[0];
}

/**
 * Descobre o intervalo que o export cobre.
 *
 * O cabeçalho declara, quando o usuário limitou o período no pedido:
 *
 *   Gerado por fulano em <time>...</time>
 *   Contém os dados de <time>11/08/2025</time> a <time>11/08/2026</time> que você solicitou
 *
 * Isto é a informação mais perigosa do arquivo inteiro, e por isso é extraída aqui
 * em vez de ignorada: **um export com período limitado não traz a base completa de
 * seguidores, só quem entrou dentro da janela.** Comparar um export de 12 meses com
 * um export de "todo o período" faz o diff acusar centenas de unfollows que nunca
 * aconteceram — ou, na ordem inversa, centenas de seguidores novos falsos.
 *
 * O pedido correto é "Todo o período"; o app avisa quando não foi isso que veio.
 */
export function detectDataWindow(html: string): DataWindow | undefined {
  const times = headerTimes(html);
  // [0] é a geração do arquivo. A janela, quando existe, são os dois seguintes.
  if (times.length < 3) return undefined;
  const [, from, to] = times;
  if (from >= to) return undefined;
  return { from, to };
}

// --- Varredura ---------------------------------------------------------------

/**
 * Tokens que interessam, na ordem em que aparecem no documento.
 * Deliberadamente não olhamos classe CSS: as do export são ofuscadas ("_a6-p")
 * e mudam sem aviso. Estrutura semântica sobrevive melhor.
 */
const TOKEN_PATTERN = new RegExp(
  [
    // <h2>fulano</h2>
    '<h2[^>]*>([^<]*)</h2>',
    // <a href="...">
    '<a[^>]*href="([^"]*)"[^>]*>',
    // <td>rótulo</td><td>valor</td>
    '<td[^>]*>([^<]*)</td>\\s*<td[^>]*>([^<]*)</td>',
    // <div>texto</div> — candidato a data
    '<div[^>]*>([^<]*)</div>',
  ].join('|'),
  'gi',
);

/** Recorta o miolo de dados, para o cabeçalho não virar entrada. */
function extractMain(html: string): string {
  const start = html.search(/<main\b/i);
  if (start === -1) {
    const bodyStart = html.search(/<body\b/i);
    return bodyStart === -1 ? html : html.slice(bodyStart);
  }
  const end = html.lastIndexOf('</main>');
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

export interface HtmlParseOptions {
  /**
   * Offset a usar quando não der para derivar do cabeçalho. Em minutos
   * (ex.: -180 para o horário de Brasília). Padrão 0 = tratar como UTC.
   */
  fallbackTimezoneOffsetMinutes?: number;
}

/**
 * Extrai as entradas de um arquivo HTML de lista de conexões.
 *
 * Nunca lança. Arquivo irreconhecível devolve lista vazia e um warning — o import
 * inteiro não pode morrer porque uma das sete listas mudou de forma.
 */
export function parseHtmlList(
  html: string,
  file: string,
  warnings: ParseWarning[],
  options: HtmlParseOptions = {},
): HtmlParseResult {
  const offset = detectTimezoneOffset(html);
  if (offset === null) {
    warnings.push({
      code: 'AMBIGUOUS_TIMEZONE',
      file,
      detail:
        'Não foi possível descobrir o fuso deste arquivo pelo cabeçalho. ' +
        'As datas podem estar deslocadas em algumas horas.',
    });
  }
  const appliedOffset = offset ?? options.fallbackTimezoneOffsetMinutes ?? 0;

  const entries: HtmlEntry[] = [];
  let unparseableDates = 0;

  /**
   * Estado da varredura num objeto, e não em variáveis soltas: `pending` é
   * reatribuído dentro das closures abaixo, e o TypeScript estreitaria a variável
   * para o tipo da última atribuição vista no fluxo linear.
   *
   * `displayName` fica separado porque nas tabelas ele vem ANTES do @
   * (linha "Nome", depois linha "Nome de usuário").
   */
  const state: { pending: HtmlEntry | null; displayName?: string } = { pending: null };

  const flush = () => {
    if (state.pending) entries.push(state.pending);
    state.pending = null;
  };

  /**
   * Um mesmo bloco pode citar o @ duas vezes (o <h2> e o href de following.html).
   * Repetição imediata é a mesma pessoa, não uma nova entrada.
   */
  const startEntry = (username: string, href?: string) => {
    const current = state.pending;
    if (current && current.username === username) {
      if (href && !current.href) current.href = href;
      if (state.displayName && !current.displayName) current.displayName = state.displayName;
      state.displayName = undefined;
      return;
    }
    // Trocou de pessoa sem ter achado data: a entrada anterior fica sem `since`.
    flush();
    state.pending = {
      username,
      ...(href ? { href } : {}),
      ...(state.displayName ? { displayName: state.displayName } : {}),
    };
    state.displayName = undefined;
  };

  for (const token of extractMain(html).matchAll(TOKEN_PATTERN)) {
    const [, heading, href, tableLabel, tableValue, divText] = token;

    if (heading !== undefined) {
      const username = decodeEntities(heading).trim().toLowerCase();
      if (/^[a-z0-9._]+$/.test(username)) startEntry(username);
      continue;
    }

    if (href !== undefined) {
      const username = usernameFromHref(decodeEntities(href));
      if (username) startEntry(username, `https://www.instagram.com/${username}`);
      continue;
    }

    if (tableLabel !== undefined && tableValue !== undefined) {
      const label = normalizeLabel(decodeEntities(tableLabel));
      const value = decodeEntities(tableValue).trim();
      if (USERNAME_LABELS.has(label) && value) startEntry(value.toLowerCase());
      else if (DISPLAY_NAME_LABELS.has(label) && value) state.displayName = value;
      continue;
    }

    if (divText !== undefined) {
      const text = divText.trim();
      const entry = state.pending;
      if (!text || !entry) continue;

      const at = parseEntryDate(text, appliedOffset);
      if (at !== null) {
        entry.since = at;
        flush();
        state.displayName = undefined;
      } else if (/^[\p{L}]{3,5}\.?\s+\d{1,2},/u.test(decodeEntities(text))) {
        // Parece data (mês, dia) mas não foi lida: idioma novo ou formato novo.
        unparseableDates += 1;
      }
    }
  }
  flush();

  if (unparseableDates > 0) {
    warnings.push({
      code: 'UNPARSEABLE_DATE',
      file,
      detail:
        `${unparseableDates} data(s) em formato desconhecido; as contas entraram ` +
        'na lista sem data de início.',
    });
  }

  const dataWindow = detectDataWindow(html);
  const generatedAt = detectGeneratedAt(html);

  return {
    entries,
    timezoneOffsetMinutes: offset,
    ...(generatedAt !== undefined ? { generatedAt } : {}),
    ...(dataWindow ? { dataWindow } : {}),
  };
}

/** Heurística barata para decidir se um conteúdo é HTML do export. */
export function looksLikeHtml(content: unknown): content is string {
  return typeof content === 'string' && /^\s*(<!doctype html|<html)/i.test(content);
}
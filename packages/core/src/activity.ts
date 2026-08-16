/**
 * O resto do export: conversas, comentários, anunciantes e buscas.
 *
 * ## Por que isto é separado do Snapshot
 *
 * `Snapshot` é o que sobe para o servidor. O que sai daqui **nunca sobe**: são
 * derivados de conversas privadas e do histórico publicitário da pessoa, e a
 * regra 5 do CLAUDE.md manda minimizar retenção. Um vazamento do nosso banco
 * hoje expõe uma lista de @s; se este módulo alimentasse o Snapshot, passaria a
 * expor com quem cada usuário conversa. Não vale nenhuma funcionalidade.
 *
 * Por isso `ActivityData` tem tipo próprio, arquivo próprio e caminho de
 * persistência próprio, só no aparelho.
 *
 * ## O que este módulo não guarda, de propósito
 *
 * Nenhum texto de mensagem. Nem trecho, nem prévia, nem contagem de palavras. O
 * que interessa a "você não respondeu" é *quem* e *quando*, e é só isso que
 * atravessa. O conteúdo é lido, reduzido e descartado no mesmo instante.
 *
 * ## Limites da fonte, herdados e não contornáveis
 *
 * O export é a *sua* atividade de saída. Ele não traz quem curtiu, comentou ou
 * viu o que você publicou — esses são dados de terceiros e a Meta não os inclui.
 * Então "quem mais interage com você" não existe aqui, e não adianta procurar
 * mais fundo: a resposta possível é o espelho, "com quem *você* mais interage".
 */

import { repairMojibake } from './text.js';
import type { ParseWarning } from './types.js';

/* -------------------------------------------------------------------------- */
/* Conversas                                                                   */

/**
 * Uma conversa reduzida ao que a tela precisa.
 *
 * `with` é **nome de exibição**, não @: o export de mensagens só traz o nome, e
 * o nome não é identidade (muda, e duas pessoas repetem). Ver `username`.
 */
export interface ConversationSummary {
  /** Nome de exibição do outro lado, ou o título do grupo. */
  with: string;
  /**
   * @ do outro lado, quando foi possível confirmar.
   *
   * O export não traz o @ dentro do arquivo da conversa; o que existe é o nome
   * da pasta (`fulano_17841…`), que é o @ **sem os pontos**. Como `ana.souza` e
   * `anasouza` viram a mesma coisa, adivinhar levaria o usuário ao perfil de um
   * estranho. Só é preenchido quando bate exatamente com um @ que já conhecemos
   * das listas de seguidores.
   */
  username?: string;
  /** Quantas pessoas na conversa. Acima de 2 é grupo. */
  participantCount: number;
  lastMessageAt: number;
  /** A última mensagem não é sua: a bola está com você. */
  awaitingYou: boolean;
  messageCount: number;
}

/** Uma conversa lida, antes de sabermos qual participante é o dono da conta. */
export interface ConversationDraft {
  folder: string;
  title: string;
  participants: string[];
  lastMessageAt: number;
  lastSender: string;
  messageCount: number;
}

interface RawConversation {
  participants?: Array<{ name?: unknown }>;
  messages?: Array<{ sender_name?: unknown; timestamp_ms?: unknown }>;
  title?: unknown;
}

const texto = (v: unknown): string => (typeof v === 'string' ? repairMojibake(v) : '');

/**
 * Reduz o JSON de uma conversa ao mínimo, para o texto poder ser descartado.
 *
 * Chamada uma vez por arquivo, durante a leitura do zip. Devolve `null` quando o
 * arquivo não tem o que interessa — nunca lança: um formato novo em uma conversa
 * não pode derrubar as outras 1.581.
 */
export function readConversation(json: unknown, folder: string): ConversationDraft | null {
  const raw = json as RawConversation;
  const mensagens = Array.isArray(raw?.messages) ? raw.messages : [];
  if (mensagens.length === 0) return null;

  /*
   * O export vem da mais nova para a mais antiga (conferido: 1.307 conversas em
   * ordem decrescente, nenhuma crescente, nenhuma misturada). Ainda assim a
   * última é buscada por comparação, e não por `messages[0]`: se a ordem mudar
   * numa versão futura do export, "quem falou por último" inverteria em silêncio
   * e o app passaria a acusar de não-respondidas justamente as respondidas.
   */
  let ultima = mensagens[0];
  for (const m of mensagens) {
    const t = typeof m?.timestamp_ms === 'number' ? m.timestamp_ms : 0;
    const atual = typeof ultima?.timestamp_ms === 'number' ? ultima.timestamp_ms : 0;
    if (t > atual) ultima = m;
  }

  const participants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((p) => texto(p?.name))
    .filter(Boolean);

  return {
    folder,
    title: texto(raw.title),
    participants,
    lastMessageAt: typeof ultima?.timestamp_ms === 'number' ? ultima.timestamp_ms : 0,
    lastSender: texto(ultima?.sender_name),
    messageCount: mensagens.length,
  };
}

/**
 * Descobre o nome do dono da conta entre os participantes.
 *
 * O export não diz qual dos participantes é você. Mas você está em **todas** as
 * conversas e ninguém mais está — no export real, o dono aparece em 1.582 de
 * 1.582 e o segundo colocado em 201. A margem é grande o bastante para isto ser
 * confiável sem depender de outro arquivo do export.
 *
 * Devolve `null` com menos de duas conversas, onde a contagem não distingue nada.
 */
export function detectSelfName(drafts: ConversationDraft[]): string | null {
  if (drafts.length < 2) return null;

  const vezes = new Map<string, number>();
  for (const d of drafts) {
    // `Set` porque um participante repetido no mesmo arquivo não é uma segunda conversa.
    for (const nome of new Set(d.participants)) vezes.set(nome, (vezes.get(nome) ?? 0) + 1);
  }

  let melhor: string | null = null;
  let maior = 0;
  for (const [nome, n] of vezes) {
    if (n > maior) {
      maior = n;
      melhor = nome;
    }
  }

  // Aparecer em menos da metade das conversas não é o dono da conta; é alguém
  // com quem se fala muito. Preferimos não responder a responder errado.
  return maior * 2 > drafts.length ? melhor : null;
}

/** Extrai o @ do nome da pasta, quando ele bate com um @ que já conhecemos. */
function usernameDaPasta(folder: string, conhecidos: ReadonlySet<string>): string | undefined {
  const semId = folder.replace(/_\d+$/, '').toLowerCase();
  if (!semId || /^\d+$/.test(semId)) return undefined;
  return conhecidos.has(semId) ? semId : undefined;
}

/**
 * Monta os resumos finais.
 *
 * @param knownUsernames @ das listas de seguidores/seguindo, para conseguir
 *   ligar algumas conversas a um perfil que dá para abrir.
 */
export function summarizeConversations(
  drafts: ConversationDraft[],
  knownUsernames: ReadonlySet<string> = new Set(),
): { self: string | null; conversations: ConversationSummary[] } {
  const self = detectSelfName(drafts);

  const conversations = drafts.map((d): ConversationSummary => {
    const outros = d.participants.filter((p) => p !== self);
    const nome = d.title || outros[0] || d.participants[0] || 'Conversa';
    const username = usernameDaPasta(d.folder, knownUsernames);

    return {
      with: nome,
      ...(username ? { username } : {}),
      participantCount: d.participants.length,
      lastMessageAt: d.lastMessageAt,
      /*
       * Sem saber quem é você, `awaitingYou` seria chute — e o chute aqui produz
       * uma lista de "você não respondeu" cheia de conversas que você respondeu.
       * Melhor a lista vir vazia e a tela explicar do que vir errada.
       */
      awaitingYou: self !== null && d.lastSender !== '' && d.lastSender !== self,
      messageCount: d.messageCount,
    };
  });

  conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return { self, conversations };
}

/* -------------------------------------------------------------------------- */
/* Comentários                                                                 */

/** Com quem você interage comentando. */
export interface InteractionCount {
  username: string;
  count: number;
  lastAt: number;
}

interface RawComment {
  string_map_data?: Record<string, { value?: unknown; timestamp?: unknown }>;
}

/**
 * De quem são os posts que você comenta, do mais comentado para o menos.
 *
 * Cobertura parcial e conhecida: no export real, só 43 dos 112 comentários
 * trazem `Media Owner`. Os demais são de posts cujo dono a Meta não incluiu. A
 * tela precisa dizer isso, senão o número vira "eu comento pouco" quando na
 * verdade é "o arquivo não conta tudo".
 */
export function parseComments(arquivos: unknown[]): InteractionCount[] {
  const por = new Map<string, { count: number; lastAt: number }>();

  for (const conteudo of arquivos) {
    // Dois formatos: array na raiz (post_comments_N) e objeto com uma chave só
    // (reels_comments). Mesmo padrão já visto no parser das relações.
    const lista = Array.isArray(conteudo)
      ? conteudo
      : conteudo && typeof conteudo === 'object'
        ? Object.values(conteudo).find(Array.isArray)
        : undefined;
    if (!Array.isArray(lista)) continue;

    for (const item of lista as RawComment[]) {
      const mapa = item?.string_map_data;
      if (!mapa) continue;

      const dono = Object.entries(mapa).find(([k]) => /media owner|dono/i.test(k))?.[1];
      const username = typeof dono?.value === 'string' ? dono.value.trim().toLowerCase() : '';
      if (!username) continue;

      const tempo = Object.entries(mapa).find(([k]) => /^time$|hora/i.test(k))?.[1];
      // Epoch em segundos, como no resto do export.
      const at = typeof tempo?.timestamp === 'number' ? tempo.timestamp * 1000 : 0;

      const atual = por.get(username) ?? { count: 0, lastAt: 0 };
      por.set(username, { count: atual.count + 1, lastAt: Math.max(atual.lastAt, at) });
    }
  }

  return [...por.entries()]
    .map(([username, v]) => ({ username, ...v }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/* -------------------------------------------------------------------------- */
/* Anunciantes                                                                 */

/** Como o anunciante chegou até você. O rótulo vem traduzido do próprio export. */
export interface AdvertiserGroup {
  /** Rótulo curto, nosso, em português. */
  label: string;
  /** Explicação do que essa categoria significa na prática. */
  meaning: string;
  advertisers: string[];
}

/**
 * Empresas que têm seus dados, agrupadas por como os conseguiram.
 *
 * O export traz o rótulo da Meta em texto corrido e com mojibake ("Anunciantes
 * que carregaram uma lista de pÃºblico..."). Reescrevemos para algo que caiba na
 * tela e que a pessoa entenda — o rótulo original explica pouco e assusta muito.
 */
export function parseAdvertisers(json: unknown): AdvertiserGroup[] {
  const raiz = json as { label_values?: Array<{ label?: unknown; vec?: Array<{ value?: unknown }> }> };
  const grupos = Array.isArray(raiz?.label_values) ? raiz.label_values : [];

  return grupos
    .map((g): AdvertiserGroup => {
      const rotulo = repairMojibake(typeof g.label === 'string' ? g.label : '');
      const advertisers = (Array.isArray(g.vec) ? g.vec : [])
        .map((v) => repairMojibake(typeof v?.value === 'string' ? v.value : ''))
        .filter(Boolean);

      return { ...classificar(rotulo), advertisers };
    })
    .filter((g) => g.advertisers.length > 0)
    .sort((a, b) => b.advertisers.length - a.advertisers.length);
}

function classificar(rotuloOriginal: string): { label: string; meaning: string } {
  const r = rotuloOriginal.toLowerCase();

  if (r.includes('loja') && r.includes('visitou')) {
    return {
      label: 'Você visitou a loja',
      meaning: 'Empresas cujo site ou loja você acessou, e que por isso podem te achar aqui.',
    };
  }
  if (r.includes('intera')) {
    return {
      label: 'Rastrearam sua navegação',
      meaning:
        'Empresas que te reconheceram por algo que você fez no site, no app ou na loja delas — ' +
        'sem você ter dado seu contato.',
    };
  }
  if (r.includes('lista')) {
    return {
      label: 'Subiram uma lista com seus dados',
      meaning:
        'Empresas que enviaram para a Meta uma lista de contatos com seus dados dentro, para ' +
        'poder te anunciar.',
    };
  }
  return { label: rotuloOriginal || 'Outros anunciantes', meaning: '' };
}

/* -------------------------------------------------------------------------- */
/* Buscas de perfil                                                            */

export interface ProfileSearch {
  username: string;
  at: number;
}

/** Perfis que você procurou na busca do Instagram, do mais recente ao mais antigo. */
export function parseProfileSearches(json: unknown): ProfileSearch[] {
  const raiz = json as Record<string, unknown>;
  const lista = raiz && typeof raiz === 'object' ? Object.values(raiz).find(Array.isArray) : undefined;
  if (!Array.isArray(lista)) return [];

  const saida: ProfileSearch[] = [];
  for (const item of lista as Array<{ title?: unknown; string_list_data?: Array<{ timestamp?: unknown }> }>) {
    const username = typeof item?.title === 'string' ? item.title.trim().toLowerCase() : '';
    if (!username) continue;
    const ts = item.string_list_data?.[0]?.timestamp;
    saida.push({ username, at: typeof ts === 'number' ? ts * 1000 : 0 });
  }

  return saida.sort((a, b) => b.at - a.at);
}

/* -------------------------------------------------------------------------- */

/** Tudo que sai do export completo. Fica só no aparelho. */
export interface ActivityData {
  /** Quando este resumo foi montado. */
  builtAt: number;
  /** Nome do dono da conta, se foi possível deduzir. */
  self: string | null;
  conversations: ConversationSummary[];
  commentedOn: InteractionCount[];
  advertisers: AdvertiserGroup[];
  profileSearches: ProfileSearch[];
  warnings: ParseWarning[];
}

/**
 * Nomes dos arquivos que este módulo consome.
 *
 * Deliberadamente restrito. O export completo traz também histórico de login com
 * IP, mensagens em mídia e o que a Meta infere sobre a pessoa; nada disso é lido
 * porque nada disso vira funcionalidade, e ler dado sensível "porque estava lá"
 * é como um app vira notícia ruim.
 */
export function isActivityFile(nome: string): boolean {
  return (
    /messages\/inbox\/[^/]+\/message_\d+\.json$/.test(nome) ||
    /comments\/(post_comments_\d+|reels_comments)\.json$/.test(nome) ||
    /advertisers_using_your_activity_or_information\.json$/.test(nome) ||
    /recent_searches\/profile_searches\.json$/.test(nome)
  );
}

/** A pasta da conversa, para tentar recuperar o @. */
export function conversationFolder(caminho: string): string {
  return caminho.match(/messages\/inbox\/([^/]+)\//)?.[1] ?? '';
}

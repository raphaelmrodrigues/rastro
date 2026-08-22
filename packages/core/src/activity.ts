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
 * ## O que este módulo guarda de conversa, e o limite (20/08/2026)
 *
 * Até aqui nenhum texto de mensagem atravessava: só *quem* e *quando*. O dono
 * pediu a mudança depois de usar a tela — uma lista de nomes e datas não diz do
 * que era a conversa, e "você não respondeu" sem assunto não ajuda a decidir
 * responder.
 *
 * Então passam **as duas últimas mensagens de cada conversa**, truncadas em
 * {@link TAMANHO_DA_PREVIA} caracteres. E só isso:
 *
 * - Só texto. Foto, áudio, vídeo e compartilhamento viram um rótulo (`kind`),
 *   nunca o arquivo nem o link.
 * - Nada do histórico anterior às duas últimas.
 * - Nenhum nome de quem reagiu: da reação sobram o emoji e um booleano dizendo
 *   se foi você.
 *
 * O limite que **não** se move: isto vive em `ActivityData`, que nunca sai do
 * aparelho (`storage.ts`, `atividade.json`) e não tem caminho de subida para o
 * servidor. Se algum dia alguém quiser mandar `ActivityData` para a API, é aqui
 * que a conversa começa de novo — porque a partir dessa mudança o que sobe deixa
 * de ser uma lista de @s e passa a ser pedaço de DM.
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

/** Quanto de cada mensagem sobrevive na prévia. O resto é descartado na leitura. */
export const TAMANHO_DA_PREVIA = 140;

/** Quantas mensagens do fim da conversa ficam guardadas. */
const QUANTAS_PREVIAS = 2;

/**
 * O que veio no lugar do texto.
 *
 * Guardar o rótulo e não o conteúdo é proposital: "mandou uma foto" basta para
 * lembrar da conversa, e o caminho do arquivo dentro do zip não acrescenta nada
 * que a tela use.
 */
export type MessageKind = 'photo' | 'video' | 'audio' | 'share' | 'call';

/** Uma mensagem reduzida ao que a tela mostra. */
export interface MessagePreview {
  /** Quem mandou foi o dono da conta. */
  fromYou: boolean;
  at: number;
  /** Texto truncado. Vazio quando a mensagem não tinha texto. */
  text: string;
  /** O que veio junto ou no lugar do texto. */
  kind?: MessageKind;
  /** Emoji da reação que esta mensagem recebeu, se recebeu. */
  reaction?: string;
  /** A reação foi sua. É o que distingue "não respondi" de "respondi com ❤️". */
  reactedByYou?: boolean;
}

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
  /**
   * A bola está com você: a última mensagem não é sua e você nem reagiu a ela.
   *
   * A reação entra na conta desde 20/08/2026. Responder com ❤️ em vez de digitar
   * é resposta — e antes disso a conversa continuava sendo cobrada como não
   * respondida, o que fazia a lista acusar justamente quem tinha sido
   * respondido do jeito mais comum no Instagram.
   */
  awaitingYou: boolean;
  /**
   * Você nunca mandou nada nesta conversa.
   *
   * É o mais perto que o export chega de "não abri". Não existe status de
   * leitura em lugar nenhum do arquivo — nem no JSON, nem no HTML, nem em
   * campo escondido: as chaves de mensagem foram varridas em 21/08/2026 e a
   * lista inteira está em docs/EXPORT-INSTAGRAM.md. O Instagram sabe (é o
   * "visto"), e não exporta.
   *
   * No export do dono são 28 conversas assim, contra 647 de `awaitingYou`. A
   * diferença importa: 647 é uma lista que ninguém encara, 28 é uma tarefa.
   */
  neverReplied: boolean;
  /**
   * Veio de `messages/message_requests/`, a caixa separada de quem não te segue.
   *
   * São as que o Instagram esconde atrás de "Solicitações", e por isso as que
   * de fato costumam nunca ter sido abertas.
   */
  isRequest: boolean;
  messageCount: number;
  /** As últimas mensagens, da mais nova para a mais antiga. Ver o topo do arquivo. */
  lastMessages: MessagePreview[];
}

/** Uma mensagem lida, antes de sabermos qual participante é o dono da conta. */
export interface MessageDraft {
  sender: string;
  at: number;
  text: string;
  kind?: MessageKind;
  /** Nomes de quem reagiu. Some no resumo: dali só sai o booleano `reactedByYou`. */
  reactors: string[];
  reaction?: string;
}

/** Uma conversa lida, antes de sabermos qual participante é o dono da conta. */
export interface ConversationDraft {
  folder: string;
  title: string;
  participants: string[];
  lastMessageAt: number;
  lastSender: string;
  messageCount: number;
  lastMessages: MessageDraft[];
  /**
   * Quem falou alguma vez nesta conversa, sem repetição.
   *
   * Guardado no rascunho porque quem é "você" só se descobre depois, olhando
   * todas as conversas juntas — e voltar às 54 mil mensagens para responder
   * isso custaria uma segunda passagem pelo zip. São um a três nomes por
   * conversa; o texto das mensagens continua morrendo aqui.
   */
  senders: string[];
  /** Veio de `message_requests/`. Ver ConversationSummary.isRequest. */
  isRequest: boolean;
}

interface RawReaction {
  reaction?: unknown;
  actor?: unknown;
}

interface RawMessage {
  sender_name?: unknown;
  timestamp_ms?: unknown;
  content?: unknown;
  reactions?: unknown;
  photos?: unknown;
  videos?: unknown;
  audio_files?: unknown;
  share?: unknown;
  call_duration?: unknown;
}

interface RawConversation {
  participants?: Array<{ name?: unknown }>;
  messages?: RawMessage[];
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
export function readConversation(
  json: unknown,
  folder: string,
  options: { isRequest?: boolean } = {},
): ConversationDraft | null {
  const raw = json as RawConversation;
  const mensagens = Array.isArray(raw?.messages) ? raw.messages : [];
  if (mensagens.length === 0) return null;

  /*
   * O export vem da mais nova para a mais antiga (conferido: 1.307 conversas em
   * ordem decrescente, nenhuma crescente, nenhuma misturada). Ainda assim as
   * últimas são buscadas por comparação, e não por `messages[0]`: se a ordem
   * mudar numa versão futura do export, "quem falou por último" inverteria em
   * silêncio e o app passaria a acusar de não-respondidas justamente as
   * respondidas.
   *
   * Num passe só, sem ordenar: são 54.100 mensagens no export real, e ordenar
   * 1.583 arrays para ficar com dois elementos de cada é trabalho jogado fora.
   */
  const maisNovas: RawMessage[] = [];
  const quandoDelas: number[] = [];
  const senders = new Set<string>();
  for (const m of mensagens) {
    const remetente = texto(m?.sender_name);
    if (remetente) senders.add(remetente);
    const t = quando(m);
    let i = 0;
    while (i < maisNovas.length && quandoDelas[i]! >= t) i++;
    if (i >= QUANTAS_PREVIAS) continue;
    maisNovas.splice(i, 0, m);
    quandoDelas.splice(i, 0, t);
    if (maisNovas.length > QUANTAS_PREVIAS) {
      maisNovas.pop();
      quandoDelas.pop();
    }
  }

  const participants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((p) => texto(p?.name))
    .filter(Boolean);

  const lastMessages = maisNovas.map((m, i) => rascunhoDaMensagem(m, quandoDelas[i]!));

  return {
    folder,
    title: texto(raw.title),
    participants,
    lastMessageAt: lastMessages[0]?.at ?? 0,
    lastSender: lastMessages[0]?.sender ?? '',
    messageCount: mensagens.length,
    lastMessages,
    senders: [...senders],
    isRequest: options.isRequest ?? false,
  };
}

const quando = (m: RawMessage): number =>
  typeof m?.timestamp_ms === 'number' ? m.timestamp_ms : 0;

const temItem = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/**
 * O que veio no lugar do texto, quando veio.
 *
 * Ordem de precedência escolhida pelo que o usuário lembraria: a foto é o que
 * marca a conversa, a chamada é o resto. `share` é post ou reel encaminhado — o
 * link não atravessa, só o rótulo.
 */
function tipoDaMensagem(m: RawMessage): MessageKind | undefined {
  if (temItem(m.photos)) return 'photo';
  if (temItem(m.videos)) return 'video';
  if (temItem(m.audio_files)) return 'audio';
  if (m.share !== undefined && m.share !== null) return 'share';
  if (typeof m.call_duration === 'number') return 'call';
  return undefined;
}

/** Corta a mensagem no tamanho da prévia, sem deixar reticências penduradas. */
function recortar(t: string): string {
  const limpo = t.replace(/\s+/g, ' ').trim();
  return limpo.length <= TAMANHO_DA_PREVIA ? limpo : `${limpo.slice(0, TAMANHO_DA_PREVIA - 1)}…`;
}

function rascunhoDaMensagem(m: RawMessage, at: number): MessageDraft {
  const reacoes: RawReaction[] = Array.isArray(m.reactions) ? (m.reactions as RawReaction[]) : [];
  const tipo = tipoDaMensagem(m);
  // O emoji vem com o mojibake clássico do export (UTF-8 lido como Latin-1);
  // sem o reparo, "❤️" chega na tela como "â¤ï¸".
  const emoji = texto(reacoes[0]?.reaction);

  return {
    sender: texto(m.sender_name),
    at,
    text: recortar(texto(m.content)),
    ...(tipo ? { kind: tipo } : {}),
    reactors: reacoes.map((r) => texto(r?.actor)).filter(Boolean),
    ...(emoji ? { reaction: emoji } : {}),
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

/**
 * Extrai o @ do nome da pasta, nas poucas vezes em que dá.
 *
 * ## O que o nome da pasta é de verdade (medido em 20/08/2026)
 *
 * Este comentário dizia que a pasta era "o @ sem os pontos". **Está errado**, e
 * a medição contra o export real do dono é direta: em **1.480 de 1.573**
 * conversas a pasta é o *título* da conversa achatado — sem acento, sem espaço,
 * minúsculo. O @ não aparece em lugar nenhum do arquivo de mensagens.
 *
 * A consequência é dura e não tem contorno neste export: **não dá para ligar
 * conversa a perfil**. Só 49 pastas coincidem com um @ conhecido, e coincidem
 * porque aquelas pessoas usam o @ como nome de exibição. Ligar pelo nome também
 * não é possível: as listas de seguidores do export JSON vêm **sem nome de
 * exibição** — 0 de 1.361 contas têm o campo preenchido. Não há chave comum
 * entre os dois lados.
 *
 * Por isso a comparação continua literal. Uma tentativa de normalizar mais (por
 * exemplo, ignorar pontos) foi escrita e desfeita no mesmo dia: ela ganhava 9
 * links e cada um deles seria um palpite baseado em nome de exibição, que é
 * exatamente o jeito de mandar o usuário ao perfil de um estranho.
 *
 * Quem não ganha `username` não fica sem saída: a tela oferece buscar o nome no
 * Instagram, que é o que a pessoa faria de qualquer forma.
 */
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

    const lastMessages = d.lastMessages.map((m): MessagePreview => {
      const reagiuVoce = self !== null && m.reactors.includes(self);
      return {
        fromYou: self !== null && m.sender === self,
        at: m.at,
        text: m.text,
        ...(m.kind ? { kind: m.kind } : {}),
        // O nome de quem reagiu fica no rascunho e morre aqui: para a tela basta
        // o emoji, e guardar a lista seria guardar mais gente do que a conversa
        // precisa.
        ...(m.reaction ? { reaction: m.reaction } : {}),
        ...(reagiuVoce ? { reactedByYou: true } : {}),
      };
    });

    const ultima = lastMessages[0];

    return {
      with: nome,
      ...(username ? { username } : {}),
      participantCount: d.participants.length,
      lastMessageAt: d.lastMessageAt,
      /*
       * Sem saber quem é você, `awaitingYou` seria chute — e o chute aqui produz
       * uma lista de "você não respondeu" cheia de conversas que você respondeu.
       * Melhor a lista vir vazia e a tela explicar do que vir errada.
       *
       * Reagir conta como responder: ver `awaitingYou` na interface.
       */
      awaitingYou:
        self !== null &&
        d.lastSender !== '' &&
        d.lastSender !== self &&
        !(ultima?.reactedByYou ?? false),
      /*
       * "Nunca respondi" é o recorte que o usuário pediu quando perguntou por
       * "não visualizei". Não é a mesma coisa, e a tela não pode fingir que é:
       * o export não guarda leitura. Mas responde à intenção — conversa em que
       * a outra pessoa falou e você nunca disse nada de volta.
       *
       * Depende de `self` pelo mesmo motivo que `awaitingYou`: sem saber quem é
       * você, todo mundo "nunca respondeu".
       */
      neverReplied: self !== null && d.senders.length > 0 && !d.senders.includes(self),
      isRequest: d.isRequest,
      messageCount: d.messageCount,
      lastMessages,
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
 * Um arquivo de conversa, nas duas caixas que o export separa.
 *
 * O nome do arquivo não é exigido ser `message_N.json`: quando o nome da pasta
 * fica muito longo o Instagram trunca o caminho inteiro e o arquivo chega como
 * `messa.json` — acontece uma vez no export real, e o padrão antigo descartava
 * essa conversa em silêncio. Dentro da pasta de uma conversa só existem os JSON
 * dela e a mídia, então aceitar qualquer `.json` ali é seguro.
 */
const CONVERSA = /messages\/(inbox|message_requests)\/[^/]+\/[^/]*\.json$/;

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
    CONVERSA.test(nome) ||
    /comments\/(post_comments_\d+|reels_comments)\.json$/.test(nome) ||
    /advertisers_using_your_activity_or_information\.json$/.test(nome) ||
    /recent_searches\/profile_searches\.json$/.test(nome)
  );
}

/** A pasta da conversa, para tentar recuperar o @. */
export function conversationFolder(caminho: string): string {
  return caminho.match(/messages\/(?:inbox|message_requests)\/([^/]+)\//)?.[1] ?? '';
}

/**
 * A conversa veio da caixa de solicitações.
 *
 * São 41 arquivos no export do dono contra 4.018 do inbox — e é lá que mora a
 * mensagem que ninguém abriu, porque o Instagram não a mostra na lista normal.
 */
export function isMessageRequest(caminho: string): boolean {
  return /messages\/message_requests\//.test(caminho);
}

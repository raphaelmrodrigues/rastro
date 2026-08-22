/**
 * Testes do que sai do export completo.
 *
 * As formas aqui vieram do export real de agosto/2026 (1.582 conversas), com os
 * nomes trocados. Os casos que mais importam são os que produzem resposta
 * *errada* em vez de resposta vazia: identificar o dono da conta ao contrário
 * inverte a lista inteira de "você não respondeu".
 */

import { describe, expect, it } from 'vitest';
import {
  conversationFolder,
  detectSelfName,
  isActivityFile,
  parseAdvertisers,
  parseComments,
  parseProfileSearches,
  readConversation,
  summarizeConversations,
  TAMANHO_DA_PREVIA,
  isMessageRequest,
  type ConversationDraft,
} from '../activity.js';

const EU = 'Raphael';

const conversa = (outro: string, mensagens: Array<[string, number]>, titulo?: string) => ({
  participants: [{ name: outro }, { name: EU }],
  messages: mensagens.map(([sender_name, timestamp_ms]) => ({ sender_name, timestamp_ms })),
  title: titulo ?? outro,
  thread_path: 'inbox/x',
});

describe('readConversation', () => {
  it('reduz a conversa ao último remetente e à data', () => {
    const d = readConversation(
      conversa('Ana', [
        ['Ana', 3_000],
        [EU, 2_000],
        ['Ana', 1_000],
      ]),
      'ana_123',
    );

    expect(d).toMatchObject({ lastSender: 'Ana', lastMessageAt: 3_000, messageCount: 3 });
  });

  it('acha a última pela data, não pela posição', () => {
    // O export vem do mais novo para o mais antigo. Se isso mudar, confiar na
    // posição 0 inverteria "quem falou por último" sem nenhum erro visível.
    const d = readConversation(
      conversa('Ana', [
        [EU, 1_000],
        ['Ana', 9_000],
      ]),
      'ana_123',
    );

    expect(d?.lastSender).toBe('Ana');
    expect(d?.lastMessageAt).toBe(9_000);
  });

  it('conserta mojibake no nome (403 conversas do export real vinham assim)', () => {
    const d = readConversation(conversa('CecÃ­lia', [['CecÃ­lia', 1]]), 'c_1');
    expect(d?.participants).toContain('Cecília');
  });

  it('devolve null para conversa sem mensagem, sem lançar', () => {
    expect(readConversation({ participants: [{ name: 'Ana' }], messages: [] }, 'a_1')).toBeNull();
    expect(readConversation({}, 'a_1')).toBeNull();
    expect(readConversation(null, 'a_1')).toBeNull();
  });
});

/**
 * A prévia das mensagens.
 *
 * O que estes testes protegem não é a formatação: é o limite. Duas mensagens,
 * truncadas, sem mídia e sem o nome de quem reagiu. Se um dia alguém precisar de
 * "só mais um pouquinho de conversa", é aqui que a conta aparece.
 */
describe('readConversation — prévia', () => {
  const conversaRica = (mensagens: unknown[]) => ({
    participants: [{ name: 'Ana' }, { name: EU }],
    messages: mensagens,
    title: 'Ana',
    thread_path: 'inbox/x',
  });

  it('guarda as duas últimas, da mais nova para a mais antiga', () => {
    const d = readConversation(
      conversaRica([
        { sender_name: 'Ana', timestamp_ms: 1_000, content: 'a mais velha' },
        { sender_name: EU, timestamp_ms: 3_000, content: 'a mais nova' },
        { sender_name: 'Ana', timestamp_ms: 2_000, content: 'a do meio' },
      ]),
      'ana_1',
    );

    expect(d?.lastMessages.map((m) => m.text)).toEqual(['a mais nova', 'a do meio']);
  });

  it('nunca guarda mais que duas, mesmo numa conversa longa', () => {
    const muitas = Array.from({ length: 500 }, (_, i) => ({
      sender_name: 'Ana',
      timestamp_ms: i,
      content: `mensagem ${i}`,
    }));

    const d = readConversation(conversaRica(muitas), 'ana_1');
    expect(d?.lastMessages).toHaveLength(2);
    expect(d?.messageCount).toBe(500);
  });

  it('trunca o texto no tamanho da prévia', () => {
    const d = readConversation(
      conversaRica([{ sender_name: 'Ana', timestamp_ms: 1, content: 'x'.repeat(500) }]),
      'ana_1',
    );

    expect(d?.lastMessages[0].text).toHaveLength(TAMANHO_DA_PREVIA);
    expect(d?.lastMessages[0].text.endsWith('…')).toBe(true);
  });

  it('troca mídia por rótulo, sem guardar caminho nem link', () => {
    const d = readConversation(
      conversaRica([
        { sender_name: 'Ana', timestamp_ms: 2, photos: [{ uri: 'messages/inbox/x/foto.jpg' }] },
        { sender_name: 'Ana', timestamp_ms: 1, share: { link: 'https://instagram.com/p/abc' } },
      ]),
      'ana_1',
    );

    expect(d?.lastMessages[0]).toMatchObject({ kind: 'photo', text: '' });
    expect(d?.lastMessages[1]).toMatchObject({ kind: 'share', text: '' });
    expect(JSON.stringify(d?.lastMessages)).not.toContain('foto.jpg');
    expect(JSON.stringify(d?.lastMessages)).not.toContain('instagram.com');
  });

  it('conserta o mojibake do emoji da reação', () => {
    // Como o export traz "❤️": os bytes UTF-8 (E2 9D A4 EF B8 8F) um a um.
    const cru = '\u00e2\u009d\u00a4\u00ef\u00b8\u008f';
    const d = readConversation(
      conversaRica([
        {
          sender_name: EU,
          timestamp_ms: 1,
          content: 'oi',
          reactions: [{ reaction: cru, actor: 'Ana' }],
        },
      ]),
      'ana_1',
    );

    expect(d?.lastMessages[0].reaction).toBe('❤️');
  });
});

describe('detectSelfName', () => {
  const rascunho = (participants: string[]): ConversationDraft => ({
    folder: 'f',
    title: '',
    participants,
    lastMessageAt: 0,
    lastSender: '',
    messageCount: 1,
    lastMessages: [],
  });

  it('escolhe quem aparece em todas as conversas', () => {
    const drafts = [
      rascunho(['Ana', EU]),
      rascunho(['Bruno', EU]),
      rascunho(['Carla', EU]),
      rascunho(['Diego', EU]),
    ];

    expect(detectSelfName(drafts)).toBe(EU);
  });

  it('não confunde o dono com quem só fala muito', () => {
    const drafts = [
      rascunho(['Ana', EU]),
      rascunho(['Ana', EU]),
      rascunho(['Bruno', EU]),
      rascunho(['Carla', EU]),
      rascunho(['Diego', EU]),
    ];

    expect(detectSelfName(drafts)).toBe(EU);
  });

  it('prefere não responder quando ninguém aparece na maioria', () => {
    // Sem um participante em mais da metade, deduzir seria chute — e o chute
    // aqui produz uma lista de "não respondidas" invertida.
    const drafts = [rascunho(['Ana', 'Bruno']), rascunho(['Carla', 'Diego'])];
    expect(detectSelfName(drafts)).toBeNull();
  });

  it('devolve null com menos de duas conversas', () => {
    expect(detectSelfName([rascunho(['Ana', EU])])).toBeNull();
    expect(detectSelfName([])).toBeNull();
  });
});

describe('summarizeConversations', () => {
  const drafts = [
    readConversation(conversa('Ana', [['Ana', 5_000]]), 'ana_111')!,
    readConversation(conversa('Bruno', [[EU, 4_000]]), 'bruno_222')!,
    // Pasta sem o ponto, que é como o Instagram nomeia a de "@carla.dias".
    readConversation(conversa('Carla', [['Carla', 6_000]]), 'carladias_333')!,
  ];

  it('marca como pendente só o que a outra pessoa falou por último', () => {
    const { conversations } = summarizeConversations(drafts);
    const porNome = Object.fromEntries(conversations.map((c) => [c.with, c.awaitingYou]));

    expect(porNome['Ana']).toBe(true);
    expect(porNome['Bruno']).toBe(false);
  });

  it('ordena da conversa mais recente para a mais antiga', () => {
    const { conversations } = summarizeConversations(drafts);
    expect(conversations.map((c) => c.with)).toEqual(['Carla', 'Ana', 'Bruno']);
  });

  it('liga ao @ só quando ele bate exatamente com um conhecido', () => {
    const { conversations } = summarizeConversations(drafts, new Set(['ana', 'carla.dias']));
    const porNome = Object.fromEntries(conversations.map((c) => [c.with, c.username]));

    expect(porNome['Ana']).toBe('ana');
    // Ninguém conhece o @ do Bruno: sem chute.
    expect(porNome['Bruno']).toBeUndefined();
  });

  it('não tenta adivinhar o @ a partir do nome da pasta', () => {
    /*
     * Medido no export real em 20/08/2026: a pasta é o **título achatado** da
     * conversa, não o @ — 1.480 de 1.573. Então "carladias_333" é o nome de
     * exibição "Carla Dias", e casá-lo com o @ "carla.dias" seria um palpite
     * sobre outra pessoa. A conversa fica sem link, e a tela oferece busca.
     */
    const { conversations } = summarizeConversations(drafts, new Set(['carla.dias']));
    const porNome = Object.fromEntries(conversations.map((c) => [c.with, c.username]));

    expect(porNome['Carla']).toBeUndefined();
  });

  it('reagir conta como responder', () => {
    // O caso real: a pessoa manda algo, você responde com ❤️ e não digita nada.
    // Antes de 20/08/2026 a conversa continuava sendo cobrada como não respondida.
    const comReacaoMinha = readConversation(
      {
        participants: [{ name: 'Ana' }, { name: EU }],
        title: 'Ana',
        messages: [
          {
            sender_name: 'Ana',
            timestamp_ms: 5_000,
            content: 'olha isso',
            reactions: [{ reaction: '❤️', actor: EU }],
          },
        ],
      },
      'ana_111',
    )!;

    const { conversations } = summarizeConversations([comReacaoMinha, ...drafts.slice(1)]);
    const porNome = Object.fromEntries(conversations.map((c) => [c.with, c.awaitingYou]));

    expect(porNome['Ana']).toBe(false);
  });

  it('reação da outra pessoa não me tira a vez de responder', () => {
    const elaReagiu = readConversation(
      {
        participants: [{ name: 'Ana' }, { name: EU }],
        title: 'Ana',
        messages: [
          {
            sender_name: 'Ana',
            timestamp_ms: 5_000,
            content: 'e aí?',
            reactions: [{ reaction: '❤️', actor: 'Ana' }],
          },
        ],
      },
      'ana_111',
    )!;

    const { conversations } = summarizeConversations([elaReagiu, ...drafts.slice(1)]);
    const porNome = Object.fromEntries(conversations.map((c) => [c.with, c.awaitingYou]));

    expect(porNome['Ana']).toBe(true);
  });

  it('não deixa o nome de quem reagiu chegar ao resumo', () => {
    // `reactors` existe no rascunho para decidir `awaitingYou` e morre ali. O que
    // é guardado no aparelho é o resumo, e nele sobra só o emoji.
    const comReacao = readConversation(
      {
        participants: [{ name: 'Ana' }, { name: EU }],
        title: 'Ana',
        messages: [
          {
            sender_name: 'Ana',
            timestamp_ms: 5_000,
            content: 'oi',
            reactions: [{ reaction: '❤️', actor: EU }],
          },
        ],
      },
      'ana_111',
    )!;

    const { conversations } = summarizeConversations([comReacao, ...drafts.slice(1)]);
    // Por nome, e não por posição: a lista sai ordenada pela conversa mais recente.
    const ana = conversations.find((c) => c.with === 'Ana')!;
    const serializado = JSON.stringify(ana.lastMessages);

    expect(serializado).not.toContain('reactors');
    expect(ana.lastMessages[0]).toMatchObject({
      reaction: '❤️',
      reactedByYou: true,
    });
  });

  it('marca quais mensagens são suas', () => {
    const { conversations } = summarizeConversations(drafts);
    const bruno = conversations.find((c) => c.with === 'Bruno')!;

    expect(bruno.lastMessages[0].fromYou).toBe(true);
  });

  it('não marca nada como pendente quando não sabe quem é o dono', () => {
    const soUma = [readConversation(conversa('Ana', [['Ana', 1]]), 'ana_1')!];
    const { self, conversations } = summarizeConversations(soUma);

    expect(self).toBeNull();
    expect(conversations[0].awaitingYou) .toBe(false);
  });
});

describe('parseComments', () => {
  const comentario = (dono: string | undefined, ts: number) => ({
    string_map_data: {
      Comment: { value: 'oi' },
      Time: { timestamp: ts },
      ...(dono ? { 'Media Owner': { value: dono } } : {}),
    },
  });

  it('conta por dono do post, do mais comentado ao menos', () => {
    const r = parseComments([
      [comentario('ana', 10), comentario('bruno', 20), comentario('ana', 30)],
    ]);

    expect(r).toEqual([
      { username: 'ana', count: 2, lastAt: 30_000 },
      { username: 'bruno', count: 1, lastAt: 20_000 },
    ]);
  });

  it('ignora comentário sem dono, que é a maioria no export real', () => {
    // 43 de 112 traziam Media Owner. Contar os sem dono como um "anônimo"
    // colocaria um vencedor falso no topo da lista.
    expect(parseComments([[comentario(undefined, 10), comentario('ana', 20)]])).toEqual([
      { username: 'ana', count: 1, lastAt: 20_000 },
    ]);
  });

  it('lê também o formato de objeto com uma chave só (reels_comments)', () => {
    const r = parseComments([{ comments_reels_comments: [comentario('ana', 10)] }]);
    expect(r).toHaveLength(1);
  });

  it('não quebra com lixo', () => {
    expect(parseComments([null, undefined, 42, {}, []])).toEqual([]);
  });
});

describe('parseAdvertisers', () => {
  it('agrupa e traduz o rótulo da Meta, consertando mojibake', () => {
    const r = parseAdvertisers({
      label_values: [
        {
          label: 'Anunciantes que carregaram uma lista de pÃºblico contendo entradas',
          vec: [{ value: 'Loja A' }, { value: 'Loja B' }],
        },
        { label: 'Anunciantes dos quais vocÃª visitou a loja', vec: [{ value: 'Loja C' }] },
      ],
    });

    expect(r[0]).toMatchObject({ label: 'Subiram uma lista com seus dados' });
    expect(r[0].advertisers).toEqual(['Loja A', 'Loja B']);
    expect(r[1].label).toBe('Você visitou a loja');
  });

  it('descarta categoria vazia', () => {
    // O export real tinha uma das três com zero itens.
    const r = parseAdvertisers({ label_values: [{ label: 'x', vec: [] }] });
    expect(r).toEqual([]);
  });

  it('não quebra com lixo', () => {
    expect(parseAdvertisers(null)).toEqual([]);
    expect(parseAdvertisers({})).toEqual([]);
  });
});

describe('parseProfileSearches', () => {
  it('lê o @ e a data, do mais recente ao mais antigo', () => {
    const r = parseProfileSearches({
      searches_user: [
        { title: 'ana', string_list_data: [{ timestamp: 10 }] },
        { title: 'BRUNO', string_list_data: [{ timestamp: 20 }] },
      ],
    });

    expect(r).toEqual([
      { username: 'bruno', at: 20_000 },
      { username: 'ana', at: 10_000 },
    ]);
  });

  it('não quebra com lixo', () => {
    expect(parseProfileSearches(null)).toEqual([]);
    expect(parseProfileSearches({ searches_user: [{}] })).toEqual([]);
  });
});

describe('isActivityFile', () => {
  it('aceita os arquivos que viram funcionalidade', () => {
    for (const nome of [
      'your_instagram_activity/messages/inbox/ana_123/message_1.json',
      'your_instagram_activity/comments/post_comments_1.json',
      'your_instagram_activity/comments/reels_comments.json',
      'ads_information/instagram_ads_and_businesses/advertisers_using_your_activity_or_information.json',
      'logged_information/recent_searches/profile_searches.json',
    ]) {
      expect(isActivityFile(nome), nome).toBe(true);
    }
  });

  it('recusa o que é sensível e não vira funcionalidade', () => {
    // Este teste é a trava: se alguém ampliar o filtro sem pensar, o app passa a
    // ler histórico de login com IP e o que a Meta infere sobre a pessoa.
    for (const nome of [
      'security_and_login_information/login_activity.json',
      'personal_information/personal_information.json',
      'ads_information/ads_and_topics/ads_viewed.json',
      'logged_information/recent_searches/word_or_phrase_searches.json',
      'your_instagram_activity/messages/inbox/ana_123/photos/foto.jpg',
      'media/posts/foto.jpg',
    ]) {
      expect(isActivityFile(nome), nome).toBe(false);
    }
  });
});

describe('conversationFolder', () => {
  it('extrai a pasta da conversa', () => {
    expect(conversationFolder('your_instagram_activity/messages/inbox/ana_123/message_1.json')).toBe(
      'ana_123',
    );
    expect(conversationFolder('outro/caminho.json')).toBe('');
  });
});

/*
 * As duas listas que substituíram o pedido impossível de "não visualizei".
 * Ver docs/EXPORT-INSTAGRAM.md: não existe status de leitura no export.
 */
describe('neverReplied e isRequest', () => {
  const soEla = {
    participants: [{ name: 'Ana' }, { name: EU }],
    messages: [
      { sender_name: 'Ana', timestamp_ms: 2 },
      { sender_name: 'Ana', timestamp_ms: 1 },
    ],
    title: 'Ana',
  };

  /*
   * `detectSelfName` precisa de um lote: quem é você se descobre por repetição
   * entre conversas, e com uma só ele devolve `null` — de propósito. Estas
   * conversas de apoio existem para o teste medir `neverReplied`, e não a
   * detecção do dono da conta, que tem testes próprios acima.
   */
  const comLote = (alvo: ConversationDraft) =>
    // Por `with`, e não por índice: `summarizeConversations` ordena por data, e
    // as conversas de apoio são mais recentes que o alvo.
    summarizeConversations([
      alvo,
      readConversation(conversa('Bruno', [[EU, 9]]), 'bruno_1')!,
      readConversation(conversa('Carla', [[EU, 8]]), 'carla_1')!,
    ]).conversations.find((c) => c.with === 'Ana')!;

  it('marca como nunca respondida a conversa em que você nunca falou', () => {
    expect(comLote(readConversation(soEla, 'ana_1')!).neverReplied).toBe(true);
  });

  it('não marca conversa em que você falou, mesmo sem ter falado por último', () => {
    const resumo = comLote(
      readConversation(conversa('Ana', [['Ana', 3], [EU, 2], ['Ana', 1]]), 'ana_1')!,
    );
    // A bola está com você, mas você já respondeu alguma vez.
    expect(resumo.awaitingYou).toBe(true);
    expect(resumo.neverReplied).toBe(false);
  });

  it('coleta remetentes de TODAS as mensagens, não só das duas guardadas', () => {
    // A prévia guarda duas; se `senders` viesse dela, uma conversa antiga em que
    // você falou no começo apareceria como nunca respondida.
    const longa = {
      participants: [{ name: 'Ana' }, { name: EU }],
      messages: [
        { sender_name: 'Ana', timestamp_ms: 5 },
        { sender_name: 'Ana', timestamp_ms: 4 },
        { sender_name: 'Ana', timestamp_ms: 3 },
        { sender_name: EU, timestamp_ms: 2 },
      ],
      title: 'Ana',
    };
    const d = readConversation(longa, 'ana_1');
    expect(d?.senders).toContain(EU);
    expect(comLote(d!).neverReplied).toBe(false);
  });

  it('sem saber quem é você, ninguém é acusado de nunca ter respondido', () => {
    const d = readConversation(soEla, 'ana_1');
    // Uma conversa só: `detectSelfName` não tem como decidir quem se repete.
    const { self, conversations } = summarizeConversations([d!]);
    if (self === null) expect(conversations[0]?.neverReplied).toBe(false);
  });

  it('propaga a marca de solicitação até o resumo', () => {
    const d = readConversation(soEla, 'ana_1', { isRequest: true });
    expect(d?.isRequest).toBe(true);
    expect(summarizeConversations([d!]).conversations[0]?.isRequest).toBe(true);
  });

  it('a conversa comum não é solicitação', () => {
    expect(readConversation(soEla, 'ana_1')?.isRequest).toBe(false);
  });
});

describe('as duas caixas de mensagem', () => {
  const REQ = 'your_instagram_activity/messages/message_requests/ana_123/message_1.json';
  const INBOX = 'your_instagram_activity/messages/inbox/ana_123/message_1.json';
  // Nome de pasta longo faz o Instagram truncar o caminho inteiro. Acontece uma
  // vez no export real, e o padrão antigo descartava essa conversa em silêncio.
  const TRUNCADO =
    'your_instagram_activity/messages/inbox/umnomedepastaabsurdamentelongoquefoicortado_839/messa.json';

  it('lê solicitações, que antes eram invisíveis para o app', () => {
    expect(isActivityFile(REQ)).toBe(true);
    expect(conversationFolder(REQ)).toBe('ana_123');
    expect(isMessageRequest(REQ)).toBe(true);
    expect(isMessageRequest(INBOX)).toBe(false);
  });

  it('lê a conversa cujo nome de arquivo o Instagram truncou', () => {
    expect(isActivityFile(TRUNCADO)).toBe(true);
    expect(conversationFolder(TRUNCADO)).toBe('umnomedepastaabsurdamentelongoquefoicortado_839');
  });

  it('continua recusando a mídia que mora dentro da pasta da conversa', () => {
    expect(isActivityFile('your_instagram_activity/messages/inbox/ana_123/photos/foto.jpg')).toBe(
      false,
    );
    expect(
      isActivityFile('your_instagram_activity/messages/message_requests/ana_123/audio/a.mp4'),
    ).toBe(false);
  });
});

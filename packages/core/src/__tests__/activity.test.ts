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

describe('detectSelfName', () => {
  const rascunho = (participants: string[]): ConversationDraft => ({
    folder: 'f',
    title: '',
    participants,
    lastMessageAt: 0,
    lastSender: '',
    messageCount: 1,
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
    readConversation(conversa('Carla', [['Carla', 6_000]]), 'carla.dias_333')!,
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
    // A pasta é "carla.dias_333" mas o Instagram tira o ponto do nome da pasta,
    // então "carla.dias" não bate; adivinhar levaria a um perfil de outra pessoa.
    expect(porNome['Bruno']).toBeUndefined();
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

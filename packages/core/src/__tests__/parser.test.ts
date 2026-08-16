/**
 * Testes do parser do export em JSON.
 *
 * As três formas testadas aqui foram tiradas de um export real de agosto/2026,
 * com os @ trocados. Antes destes testes o parser lia só a primeira: das 2.717
 * relações do arquivo, 1.355 eram descartadas em silêncio e o app mostrava
 * "seguindo: 0" com cara de dado correto.
 */

import { describe, expect, it } from 'vitest';
import { hasKnownDate, parseExport } from '../parser.js';
import { repairMojibake } from '../text.js';

const IMPORTADO_EM = Date.UTC(2026, 7, 13);
const base = (files: Record<string, unknown>) =>
  parseExport({ files, snapshotId: 's1', importedAt: IMPORTADO_EM });

// Forma 1: followers_N.json — o @ vem em string_list_data[].value.
const FORMA_LINK = [
  {
    title: '',
    media_list_data: [],
    string_list_data: [
      { href: 'https://www.instagram.com/fulano', value: 'fulano', timestamp: 1786573610 },
    ],
  },
];

// Forma 2: following.json — sem value; o @ está em title e o link é deep link.
const FORMA_TITULO = {
  relationships_following: [
    {
      title: 'ciclano',
      string_list_data: [{ href: 'https://www.instagram.com/_u/ciclano', timestamp: 1786576120 }],
    },
  ],
};

// Forma 3: blocked/pending/recently_unfollowed — rótulo localizado, com mojibake.
const FORMA_ROTULOS = [
  {
    timestamp: 1740655193,
    media: [],
    label_values: [
      { label: 'URL', value: '' },
      { label: 'Nome', value: 'CecÃ­lia VitÃ³ria' },
      { label: 'Nome de usuÃ¡rio', value: 'beltrana' },
    ],
    fbid: '17841403278150691',
  },
];

describe('parseExport — forma com link (followers)', () => {
  it('lê o @, o link e a data exata', () => {
    const snap = base({ 'connections/followers_and_following/followers_1.json': FORMA_LINK });

    expect(snap.relationships.followers).toEqual([
      {
        username: 'fulano',
        href: 'https://www.instagram.com/fulano',
        since: 1786573610 * 1000,
      },
    ]);
    expect(snap.warnings).toEqual([]);
  });

  it('agrega followers_1 e followers_2 em vez de substituir', () => {
    const segundo = [
      {
        title: '',
        string_list_data: [{ href: 'https://www.instagram.com/outro', value: 'outro', timestamp: 1 }],
      },
    ];
    const snap = base({
      'connections/followers_and_following/followers_1.json': FORMA_LINK,
      'connections/followers_and_following/followers_2.json': segundo,
    });

    expect(snap.relationships.followers.map((r) => r.username)).toEqual(['fulano', 'outro']);
  });
});

describe('parseExport — forma com título (following)', () => {
  it('usa title como @ quando string_list_data não traz value', () => {
    const snap = base({ 'connections/followers_and_following/following.json': FORMA_TITULO });

    expect(snap.relationships.following).toHaveLength(1);
    expect(snap.relationships.following[0]).toMatchObject({
      username: 'ciclano',
      since: 1786576120 * 1000,
    });
  });

  it('não confunde o title com nome de exibição quando ele é o próprio @', () => {
    const snap = base({ 'connections/followers_and_following/following.json': FORMA_TITULO });

    expect(snap.relationships.following[0].displayName).toBeUndefined();
  });
});

describe('parseExport — forma com rótulos (blocked, pending, unfollowed)', () => {
  it('acha o @ pelo rótulo localizado mesmo com mojibake', () => {
    const snap = base({
      'connections/followers_and_following/blocked_profiles.json': FORMA_ROTULOS,
    });

    expect(snap.relationships.blocked).toHaveLength(1);
    expect(snap.relationships.blocked[0].username).toBe('beltrana');
  });

  it('conserta o nome de exibição e usa o timestamp da própria entrada', () => {
    const snap = base({
      'connections/followers_and_following/blocked_profiles.json': FORMA_ROTULOS,
    });

    expect(snap.relationships.blocked[0].displayName).toBe('Cecília Vitória');
    expect(snap.relationships.blocked[0].since).toBe(1740655193 * 1000);
  });

  it('lê a lista de um item só, que vem como objeto sem array em volta', () => {
    const snap = base({
      'connections/followers_and_following/restricted_profiles.json': FORMA_ROTULOS[0],
    });

    expect(snap.relationships.restricted.map((r) => r.username)).toEqual(['beltrana']);
    // Não pode virar UNKNOWN_FILE_SHAPE: media e label_values não são "duas listas".
    expect(snap.warnings.filter((w) => w.code === 'UNKNOWN_FILE_SHAPE')).toEqual([]);
  });
});

describe('parseExport — nunca perder registro em silêncio', () => {
  it('avisa quando entradas são descartadas por não ter @ legível', () => {
    const snap = base({
      'connections/followers_and_following/followers_1.json': [
        ...FORMA_LINK,
        { title: '', string_list_data: [{ timestamp: 123 }] },
        { title: '', string_list_data: [{ timestamp: 456 }] },
      ],
    });

    const aviso = snap.warnings.find((w) => w.code === 'ENTRIES_SKIPPED');
    expect(aviso?.detail).toContain('2 de 3');
    expect(snap.relationships.followers).toHaveLength(1);
  });

  it('avisa quando não há seguidor nenhum', () => {
    const snap = base({ 'connections/followers_and_following/following.json': FORMA_TITULO });

    expect(snap.warnings.some((w) => w.code === 'MISSING_FILE')).toBe(true);
  });

  it('usa a data do import quando falta timestamp, e diz que fez isso', () => {
    const snap = base({
      'connections/followers_and_following/followers_1.json': [
        { title: '', string_list_data: [{ value: 'semdata' }] },
      ],
    });

    expect(snap.relationships.followers[0].since).toBe(IMPORTADO_EM);
    expect(snap.warnings.some((w) => w.code === 'MISSING_TIMESTAMP')).toBe(true);
  });
});

describe('parseExport — normalização de identidade', () => {
  it('trata o @ como minúsculo e sem arroba', () => {
    const snap = base({
      'connections/followers_and_following/followers_1.json': [
        { title: '', string_list_data: [{ value: '@FuLaNo', timestamp: 1 }] },
      ],
    });

    expect(snap.relationships.followers[0].username).toBe('fulano');
  });

  it('cai para o @ da URL quando não há value, title nem rótulo', () => {
    const snap = base({
      'connections/followers_and_following/followers_1.json': [
        { string_list_data: [{ href: 'https://www.instagram.com/_u/soalink', timestamp: 1 }] },
      ],
    });

    expect(snap.relationships.followers[0].username).toBe('soalink');
  });

  it('ignora repetição do mesmo @ na mesma lista', () => {
    const snap = base({
      'connections/followers_and_following/followers_1.json': [...FORMA_LINK, ...FORMA_LINK],
    });

    expect(snap.relationships.followers).toHaveLength(1);
    expect(snap.warnings.some((w) => w.code === 'DUPLICATE_USERNAME')).toBe(true);
  });
});

describe('repairMojibake', () => {
  it('conserta UTF-8 lido como Latin-1', () => {
    expect(repairMojibake('Nome de usuÃ¡rio')).toBe('Nome de usuário');
    expect(repairMojibake('Raflesia ð¸')).toBe('Raflesia 🌸');
  });

  it('não mexe em texto que já está correto', () => {
    for (const texto of ['Nome de usuário', 'fulano', 'Raflesia 🌸', '', 'Ação']) {
      expect(repairMojibake(texto)).toBe(texto);
    }
  });

  it('devolve o original quando a releitura não daria UTF-8 válido', () => {
    // "Ã" solto, sem byte de continuação válido depois: não é mojibake.
    expect(repairMojibake('Ã')).toBe('Ã');
    expect(repairMojibake('100% Ã 20°')).toBe('100% Ã 20°');
  });
});

/**
 * `since` sempre existe, mesmo quando o export não trouxe data — nesse caso ele
 * vale o `importedAt`. Sem estes testes, a UI não teria como distinguir uma data
 * real de um carimbo do import, e mostraria "bloqueado em <dia do import>" com
 * toda a cara de fato verificado.
 */
describe('hasKnownDate', () => {
  it('reconhece data que veio do export', () => {
    const snap = base({
      'blocked_profiles.json': {
        relationships_blocked_users: [
          {
            title: 'fulano',
            // epoch em SEGUNDOS, como o Instagram entrega
            timestamp: Math.floor(Date.UTC(2025, 2, 10) / 1000),
            string_list_data: [{ value: 'fulano', timestamp: Math.floor(Date.UTC(2025, 2, 10) / 1000) }],
          },
        ],
      },
    });

    const [entrada] = snap.relationships.blocked;
    expect(entrada.since).toBe(Date.UTC(2025, 2, 10));
    expect(hasKnownDate(entrada, snap)).toBe(true);
  });

  it('reconhece o carimbo do import como data desconhecida', () => {
    const snap = base({
      'restricted_profiles.json': {
        relationships_restricted_users: [
          { title: 'beltrano', string_list_data: [{ value: 'beltrano' }] },
        ],
      },
    });

    const [entrada] = snap.relationships.restricted;
    expect(entrada.since).toBe(IMPORTADO_EM);
    expect(hasKnownDate(entrada, snap)).toBe(false);
    expect(snap.warnings.some((w) => w.code === 'MISSING_TIMESTAMP')).toBe(true);
  });
});

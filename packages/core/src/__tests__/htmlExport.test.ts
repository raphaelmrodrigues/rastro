import { describe, expect, it } from 'vitest';
import {
  detectDataWindow,
  detectTimezoneOffset,
  parseEntryDate,
  parseHtmlList,
  usernameFromHref,
} from '../htmlExport.js';
import { parseExport } from '../parser.js';
import type { ParseWarning } from '../types.js';

/**
 * Fixtures reduzidas a partir de um export real (agosto/2026, conta em pt-BR).
 * O cabeçalho é reproduzido como está no arquivo original, incluindo o detalhe
 * de o texto se dizer "UTC" sem estar em UTC — é justamente disso que o parser
 * extrai o fuso.
 */
const HEADER = `<html><head><meta charset="utf-8" /></head><body>
<div class="_a705"><header class="_as-_ _a70a"><div class="_a70d"><h1>Seguidores</h1>
<aside role="contentinfo" class="_aoaa">Gerado por fulano em <time datetime="2026-08-12T05:03Z">Terça-feira, 11 de agosto de 2026 às 22:03 UTC</time>
</aside></div></header>`;

/** Mesmo cabeçalho, mas com o intervalo limitado que o pedido "12 meses" gera. */
const HEADER_COM_JANELA = `${HEADER.slice(0, HEADER.lastIndexOf('</aside>'))}<div>Contém os dados de <time datetime="2025-08-12T04:52Z">11 de agosto de 2025 às 21:52</time> a <time datetime="2026-08-12T04:52Z">11 de agosto de 2026 às 21:52</time> que você solicitou</div></aside></div></header>`;

const linkItem = (username: string, date: string) =>
  `<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder"><div class="_a6-p"><div><div>` +
  `<a target="_blank" href="https://www.instagram.com/${username}">${username}</a>` +
  `</div><div>${date}</div></div></div></div>`;

const followersHtml = (items: string) => `${HEADER}<main class="_a706" role="main">${items}</main></div></body></html>`;

describe('usernameFromHref', () => {
  it('lê o @ das duas formas de link que o export usa', () => {
    expect(usernameFromHref('https://www.instagram.com/fulano')).toBe('fulano');
    // following.html usa deep link: /_u/ é rota, não pessoa.
    expect(usernameFromHref('https://www.instagram.com/_u/fulano')).toBe('fulano');
  });

  it('ignora links que não são de perfil', () => {
    expect(usernameFromHref('https://www.instagram.com/p/ABC123')).toBeNull();
    expect(usernameFromHref('https://pin.it/xyz')).toBeNull();
  });
});

describe('parseEntryDate', () => {
  it('lê o formato de 12 horas em português', () => {
    // "da tarde/noite" é a string única que o Instagram usa para PM.
    expect(parseEntryDate('ago 10, 2026 4:38 da manhã')).toBe(Date.UTC(2026, 7, 10, 4, 38));
    expect(parseEntryDate('ago 07, 2026 8:17 da tarde/noite')).toBe(Date.UTC(2026, 7, 7, 20, 17));
  });

  it('trata meia-noite e meio-dia sem inverter os dois', () => {
    // O erro clássico de relógio de 12h: 12:30 AM é 00:30, 12:30 PM continua 12:30.
    expect(parseEntryDate('jan 05, 2026 12:30 da manhã')).toBe(Date.UTC(2026, 0, 5, 0, 30));
    expect(parseEntryDate('jan 05, 2026 12:30 da tarde/noite')).toBe(Date.UTC(2026, 0, 5, 12, 30));
  });

  it('aceita inglês e espanhol', () => {
    expect(parseEntryDate('Aug 10, 2026 4:38 pm')).toBe(Date.UTC(2026, 7, 10, 16, 38));
    expect(parseEntryDate('dic 01, 2025 9:00 da manhã')).toBe(Date.UTC(2025, 11, 1, 9, 0));
  });

  it('aplica o offset informado', () => {
    // 4:38 em UTC-7 é 11:38 UTC.
    expect(parseEntryDate('ago 10, 2026 4:38 da manhã', -420)).toBe(Date.UTC(2026, 7, 10, 11, 38));
  });

  it('devolve null para texto que não é data', () => {
    expect(parseEntryDate('Nome de usuário')).toBeNull();
    expect(parseEntryDate('')).toBeNull();
  });
});

describe('detectTimezoneOffset', () => {
  it('deriva o fuso comparando o <time> legível por máquina com o texto', () => {
    // 22:03 no texto contra 05:03Z no atributo = UTC-7.
    expect(detectTimezoneOffset(HEADER)).toBe(-420);
  });

  it('devolve null quando o cabeçalho não traz o par', () => {
    expect(detectTimezoneOffset('<html><body><main></main></body></html>')).toBeNull();
  });
});

describe('parseHtmlList', () => {
  it('lê a lista de seguidores com link e data', () => {
    const warnings: ParseWarning[] = [];
    const result = parseHtmlList(
      followersHtml(linkItem('vinicius_soares98', 'ago 10, 2026 4:38 da manhã')),
      'followers_1.html',
      warnings,
    );

    expect(result.entries).toEqual([
      {
        username: 'vinicius_soares98',
        href: 'https://www.instagram.com/vinicius_soares98',
        // 4:38 local em UTC-7 = 11:38 UTC. Sem a derivação do fuso, sairia 04:38.
        since: Date.UTC(2026, 7, 10, 11, 38),
      },
    ]);
    expect(result.timezoneOffsetMinutes).toBe(-420);
    expect(warnings).toHaveLength(0);
  });

  it('não duplica quem aparece no <h2> e no link (following.html)', () => {
    const html = followersHtml(
      `<div class="pam"><h2>taliafcoutinho</h2><div class="_a6-p"><div><div>` +
        `<a href="https://www.instagram.com/_u/taliafcoutinho">https://www.instagram.com/_u/taliafcoutinho</a>` +
        `</div><div>ago 11, 2026 1:07 da manhã</div></div></div></div>`,
    );

    const result = parseHtmlList(html, 'following.html', []);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].username).toBe('taliafcoutinho');
  });

  it('lê o layout de tabela e guarda o nome de exibição', () => {
    const html = followersHtml(
      `<div class="pam"><div class="_3-95 _a6-p"><div class="pam"><div class="_a6-p">` +
        `<table style="table-layout: fixed;">` +
        `<tr><td class="_a6_q">Nome</td><td class="_2piu _a6_r">Gabrielle Chaime</td></tr>` +
        `<tr><td class="_a6_q">Nome de usuário</td><td class="_2piu _a6_r">gabriellechaime</td></tr>` +
        `</table></div></div></div><div class="_3-94 _a6-o">ago 07, 2026 7:31 da tarde/noite</div></div>`,
    );

    const result = parseHtmlList(html, 'pending_follow_requests.html', []);

    expect(result.entries).toEqual([
      {
        username: 'gabriellechaime',
        displayName: 'Gabrielle Chaime',
        since: Date.UTC(2026, 7, 8, 2, 31), // 19:31 em UTC-7 = 02:31Z do dia seguinte
      },
    ]);
  });

  it('ignora campos extras da tabela que não são o @', () => {
    // recently_unfollowed_profiles.html traz linhas de URL de outros sites.
    const html = followersHtml(
      `<div class="pam"><table>` +
        `<tr><td>URL</td><td>https://pin.it/pon8KUQrx</td></tr>` +
        `<tr><td>Nome</td><td>Jhesily</td></tr>` +
        `<tr><td>Nome de usuário</td><td>jhes.ily</td></tr>` +
        `</table><div>ago 09, 2026 11:20 da manhã</div></div>`,
    );

    const result = parseHtmlList(html, 'recently_unfollowed_profiles.html', []);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].username).toBe('jhes.ily');
  });

  it('mantém a conta na lista mesmo sem data legível', () => {
    // Perder o @ é perder o produto; perder a data é perder um detalhe.
    const warnings: ParseWarning[] = [];
    const html = followersHtml(
      `<div class="pam"><div><a href="https://www.instagram.com/semdata">semdata</a></div>` +
        `<div>formato futuro que ainda não existe</div></div>`,
    );

    const result = parseHtmlList(html, 'followers_1.html', warnings);

    expect(result.entries).toEqual([
      { username: 'semdata', href: 'https://www.instagram.com/semdata' },
    ]);
  });

  it('avisa quando não consegue derivar o fuso em vez de fingir que é UTC', () => {
    const warnings: ParseWarning[] = [];
    parseHtmlList(
      '<html><body><main><div><a href="https://www.instagram.com/x">x</a></div>' +
        '<div>ago 10, 2026 4:38 da manhã</div></main></body></html>',
      'followers_1.html',
      warnings,
    );

    expect(warnings.map((w) => w.code)).toContain('AMBIGUOUS_TIMEZONE');
  });

  it('não confunde o cabeçalho com dados', () => {
    const result = parseHtmlList(followersHtml(''), 'followers_1.html', []);
    expect(result.entries).toHaveLength(0);
  });
});

describe('detectDataWindow', () => {
  it('lê o intervalo declarado quando o export foi pedido por período', () => {
    expect(detectDataWindow(HEADER_COM_JANELA)).toEqual({
      from: Date.parse('2025-08-12T04:52Z'),
      to: Date.parse('2026-08-12T04:52Z'),
    });
  });

  it('não inventa intervalo quando o export cobre tudo', () => {
    expect(detectDataWindow(HEADER)).toBeUndefined();
  });
});

describe('parseExport com HTML', () => {
  it('agrega followers paginados também em HTML', () => {
    const snap = parseExport({
      snapshotId: 's1',
      importedAt: Date.UTC(2026, 7, 12),
      files: {
        'connections/followers_and_following/followers_1.html': followersHtml(
          linkItem('ana', 'ago 01, 2026 10:00 da manhã'),
        ),
        'connections/followers_and_following/followers_2.html': followersHtml(
          linkItem('bruno', 'ago 02, 2026 10:00 da manhã'),
        ),
      },
    });

    expect(snap.relationships.followers.map((f) => f.username).sort()).toEqual(['ana', 'bruno']);
    expect(snap.format).toBe('html');
  });

  it('aceita export misto de JSON e HTML no mesmo zip', () => {
    const snap = parseExport({
      snapshotId: 's1',
      importedAt: Date.UTC(2026, 7, 12),
      files: {
        'connections/followers_and_following/followers_1.html': followersHtml(
          linkItem('ana', 'ago 01, 2026 10:00 da manhã'),
        ),
        'connections/followers_and_following/following.json': {
          relationships_following: [{ string_list_data: [{ value: 'bruno', timestamp: 2000 }] }],
        },
      },
    });

    expect(snap.format).toBe('mixed');
    expect(snap.relationships.followers[0].username).toBe('ana');
    expect(snap.relationships.following[0].username).toBe('bruno');
  });

  it('avisa quando o export cobre só um período', () => {
    const html = `${HEADER_COM_JANELA}<main>${linkItem('ana', 'ago 01, 2026 10:00 da manhã')}</main></body></html>`;
    const snap = parseExport({
      snapshotId: 's1',
      importedAt: Date.UTC(2026, 7, 12),
      files: { 'connections/followers_and_following/followers_1.html': html },
    });

    expect(snap.warnings.map((w) => w.code)).toContain('PARTIAL_EXPORT');
    expect(snap.dataWindow).toBeDefined();
  });
});

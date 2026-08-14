/**
 * Snapshot enviado pelo app já processado.
 *
 * ## Por que existe
 *
 * O `core` é o mesmo nos dois lados. Quando o app faz o parse no aparelho — que
 * é o que ele já faz no modo offline — não há motivo para mandar 479 MB de zip
 * pela rede móvel do usuário para o servidor repetir o mesmo trabalho. O
 * resultado do parse tem alguns MB.
 *
 * O zip continua aceito em `POST /snapshots`: é o caminho da web e de qualquer
 * cliente que não tenha o core.
 *
 * ## Por que tudo é revalidado aqui
 *
 * Isto chega pela rede, de um app que qualquer pessoa pode modificar. "Foi o
 * nosso app que gerou" não é garantia de nada. Então: schema estrito, tetos de
 * tamanho, e o `id` do snapshot atribuído pelo servidor — deixar o cliente
 * escolher o id permitiria sobrescrever o snapshot de outro perfil.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RelationshipKind, Snapshot } from '@rastro/core';

/**
 * Teto de contas por snapshot, somando todas as listas.
 *
 * A maior conta do Instagram tem ordem de 10^8 seguidores, mas o export dessas
 * contas não é o caso de uso do produto, e aceitar um payload arbitrário é
 * convite para exaustão de memória. Um perfil comum fica em milhares.
 */
const MAX_ENTRIES = 800_000;

const KINDS: RelationshipKind[] = [
  'followers',
  'following',
  'pendingRequestsSent',
  'recentlyUnfollowed',
  'blocked',
  'closeFriends',
  'restricted',
];

/*
 * `username` aceita string vazia aqui de propósito, e `since` tem um padrão.
 *
 * A regra do projeto é que erro de parsing não derruba o import inteiro: colete
 * em `warnings` e siga com o que deu para ler (CLAUDE.md §7). Se o schema
 * recusasse o payload por causa de uma entrada estragada entre 1.361, o usuário
 * perderia o import completo por causa de uma linha — exatamente o oposto do que
 * o parser faz com o mesmo problema. A entrada ruim é descartada em
 * `paraSnapshot`, que conta quantas foram e emite ENTRIES_SKIPPED.
 */
const relationship = z.object({
  // 30 é o limite do Instagram; a folga cobre @ antigos e mudanças de regra.
  username: z.string().max(64).catch(''),
  href: z.string().max(300).optional().catch(undefined),
  displayName: z.string().max(200).optional().catch(undefined),
  since: z.number().int().finite().catch(0),
});

/**
 * `code` é string livre, e não o enum do core, de propósito: o app na loja é
 * sempre mais novo ou mais velho que o servidor. Recusar um warning de código
 * desconhecido faria uma atualização do app quebrar o import contra o servidor
 * antigo — e warning é justamente o que não deve derrubar o import.
 */
const warning = z.object({
  code: z.string().max(60),
  file: z.string().max(300).optional(),
  detail: z.string().max(500),
});

export const snapshotPayload = z.object({
  importedAt: z.number().int().finite().optional(),
  exportedAt: z.number().int().finite().optional(),
  format: z.enum(['json', 'html', 'mixed']).optional(),
  dataWindow: z.object({ from: z.number().int(), to: z.number().int() }).optional(),
  relationships: z.object({
    followers: z.array(relationship),
    following: z.array(relationship),
    pendingRequestsSent: z.array(relationship).default([]),
    recentlyUnfollowed: z.array(relationship).default([]),
    blocked: z.array(relationship).default([]),
    closeFriends: z.array(relationship).default([]),
    restricted: z.array(relationship).default([]),
  }),
  warnings: z.array(warning).max(500).default([]),
});

export type SnapshotPayload = z.infer<typeof snapshotPayload>;

export class PayloadGrandeDemais extends Error {
  constructor(total: number) {
    super(`Este snapshot tem ${total} contas, acima do limite de ${MAX_ENTRIES}.`);
  }
}

/**
 * Converte o payload num Snapshot do core.
 *
 * Normaliza o @ (minúsculo, sem "@") em vez de confiar que o cliente fez isso: a
 * identidade do domínio inteiro é o username, e um "@Fulano" que escape aqui vira
 * uma saída falsa no próximo diff.
 */
export function paraSnapshot(payload: SnapshotPayload, id: string): Snapshot {
  const total = KINDS.reduce((soma, kind) => soma + payload.relationships[kind].length, 0);
  if (total > MAX_ENTRIES) throw new PayloadGrandeDemais(total);

  const relationships = {} as Snapshot['relationships'];
  const descartadas: string[] = [];

  for (const kind of KINDS) {
    const vistos = new Set<string>();
    let ignoradas = 0;
    relationships[kind] = [];

    for (const rel of payload.relationships[kind]) {
      const username = rel.username.trim().replace(/^@+/, '').toLowerCase();
      // Sem @ não há identidade: esta entrada não serve para diff nenhum.
      // Duplicata não é perda — a mesma conta já entrou uma vez.
      if (!username) {
        ignoradas++;
        continue;
      }
      if (vistos.has(username)) continue;
      vistos.add(username);
      relationships[kind].push({
        username,
        since: rel.since,
        ...(rel.href ? { href: rel.href } : {}),
        ...(rel.displayName ? { displayName: rel.displayName } : {}),
      });
    }

    if (ignoradas > 0) descartadas.push(`${ignoradas} em ${kind}`);
  }

  const warnings = [...payload.warnings] as Snapshot['warnings'];
  if (descartadas.length > 0) {
    warnings.push({
      code: 'ENTRIES_SKIPPED',
      detail:
        `Entradas sem um @ legível foram ignoradas (${descartadas.join(', ')}). ` +
        'O formato do export pode ter mudado.',
    });
  }

  return {
    id,
    // O relógio do aparelho pode estar errado, inclusive no futuro. Quem carimba
    // a hora do import é o servidor, que é o dono da ordem dos snapshots.
    importedAt: Date.now(),
    ...(payload.exportedAt !== undefined ? { exportedAt: payload.exportedAt } : {}),
    ...(payload.format ? { format: payload.format } : {}),
    ...(payload.dataWindow ? { dataWindow: payload.dataWindow } : {}),
    relationships,
    warnings,
  };
}

/**
 * Impressão digital do conteúdo, para a mesma idempotência que o zip tem pelo
 * SHA-256 do arquivo.
 *
 * Entram só as coisas que definem o *estado da rede*: quem, desde quando, e a
 * janela declarada. Ficam de fora `importedAt` (muda a cada envio), `format`
 * (o mesmo estado pode vir de JSON ou HTML) e `displayName` (muda sozinho, sem
 * a rede ter mudado).
 */
export function impressaoDoSnapshot(snapshot: Snapshot): string {
  const hasher = createHash('sha256');

  if (snapshot.dataWindow) {
    hasher.update(`janela:${snapshot.dataWindow.from}-${snapshot.dataWindow.to}\n`);
  }

  for (const kind of KINDS) {
    const linhas = snapshot.relationships[kind]
      .map((rel) => `${rel.username}:${rel.since}`)
      .sort();
    hasher.update(`${kind}\n${linhas.join('\n')}\n`);
  }

  return hasher.digest('hex');
}

/**
 * Sessões: emissão, rotação e revogação de refresh token.
 *
 * ## O desenho, e por que não é só "um JWT mais longo"
 *
 * Access token é um JWT de vida curta: não consulta o banco, então cada request
 * custa uma verificação de assinatura e mais nada. O preço é não poder revogá-lo
 * — daí a vida curta.
 *
 * Refresh token é uma linha desta tabela. Vive muito, e por isso precisa ser
 * revogável: trocar a senha, perder o celular ou sair da conta têm que ter efeito
 * imediato sobre ele.
 *
 * ## O que fica no banco
 *
 * Só o SHA-256 do token. Não é hash de senha e por isso não precisa de scrypt: o
 * token tem 32 bytes de entropia de `randomBytes`, e não existe dicionário para
 * atacar isso — o custo alto do scrypt aqui só serviria para tornar o refresh
 * lento. O que importa é que um dump do banco não vira sessão de ninguém.
 *
 * ## Rotação
 *
 * Todo refresh devolve um token novo e revoga o usado. Se um token já revogado
 * reaparecer, a hipótese é cópia em circulação, e a linhagem inteira (`family_id`)
 * cai — o ladrão perde o acesso e o dono é obrigado a entrar de novo.
 *
 * A exceção é a corrida honesta: app com duas requisições simultâneas refresca
 * duas vezes com o mesmo token. Por isso a janela de graça abaixo, dentro da qual
 * um reuso é tratado como "tente de novo" e não como roubo.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from '../db/client.js';

/** Vida do access token. Curta porque não há como revogá-lo antes disso. */
export const ACCESS_TTL = '15m';

const REFRESH_TTL_DIAS = 60;

/**
 * Reuso dentro desta janela é corrida de rede, não roubo. Acima dela, o token
 * antigo já teve tempo de sobra de ser substituído no app.
 */
const GRACA_REUSO_MS = 30_000;

export interface DadosSessao {
  deviceLabel?: string | undefined;
  platform?: 'ios' | 'android' | 'web' | undefined;
}

export interface ParDeTokens {
  refreshToken: string;
  sessionId: string;
  expiresAt: Date;
}

export class ReuseDetectado extends Error {
  constructor() {
    super('Refresh token reapresentado. A sessão foi encerrada por segurança.');
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function novoToken(): string {
  // 32 bytes = 256 bits. base64url para caber em header e querystring sem escape.
  return randomBytes(32).toString('base64url');
}

/** Compara hashes em tempo constante. Ambos têm o mesmo tamanho por construção. */
export function hashesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function daquiA(dias: number): Date {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

/** Abre uma sessão nova (login ou cadastro). Começa uma linhagem própria. */
export async function abrirSessao(userId: string, dados: DadosSessao = {}): Promise<ParDeTokens> {
  const token = novoToken();
  const expiresAt = daquiA(REFRESH_TTL_DIAS);

  const [linha] = await sql<{ id: string }[]>`
    INSERT INTO sessions (user_id, refresh_token_hash, device_label, platform, expires_at, family_id)
    VALUES (
      ${userId}, ${hash(token)}, ${dados.deviceLabel ?? null}, ${dados.platform ?? null},
      ${expiresAt}, gen_random_uuid()
    )
    RETURNING id
  `;

  return { refreshToken: token, sessionId: linha.id, expiresAt };
}

/**
 * Troca um refresh token por um par novo.
 *
 * Devolve `null` quando o token simplesmente não existe ou expirou — caso comum e
 * sem drama, o app manda o usuário entrar de novo. Lança `ReuseDetectado` quando
 * o token existia e já tinha sido usado, que é outra coisa: alguém tem uma cópia.
 */
export async function rotacionar(
  refreshToken: string,
  dados: DadosSessao = {},
): Promise<{ userId: string; par: ParDeTokens } | null> {
  const tokenHash = hash(refreshToken);

  /*
   * A transação decide, mas não revoga a linhagem nem lança.
   *
   * Motivo, descoberto testando: lançar de dentro de `sql.begin` dispara
   * ROLLBACK, e o rollback desfazia o próprio UPDATE que revogava a linhagem.
   * A detecção de reuso "funcionava" — respondia 401 — e não revogava nada, que
   * é exatamente o cenário em que o token roubado continua valendo.
   */
  type Decisao =
    | { tipo: 'invalido' }
    | { tipo: 'reuso'; familyId: string }
    | { tipo: 'ok'; userId: string; par: ParDeTokens };

  const decisao: Decisao = await sql.begin(async (tx) => {
    // FOR UPDATE serializa dois refreshes simultâneos do mesmo token: o segundo
    // espera e enxerga a linha já revogada, em vez de os dois rotacionarem.
    const [sessao] = await tx<
      {
        id: string;
        user_id: string;
        family_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        revoked_reason: string | null;
      }[]
    >`
      SELECT id, user_id, family_id, expires_at, revoked_at, revoked_reason
      FROM sessions WHERE refresh_token_hash = ${tokenHash}
      FOR UPDATE
    `;

    if (!sessao) return { tipo: 'invalido' };

    if (sessao.revoked_at) {
      const idadeDaRevogacao = Date.now() - new Date(sessao.revoked_at).getTime();
      const foiRotacao = sessao.revoked_reason === 'rotacao';

      // Corrida honesta: o app disparou dois refreshes quase juntos.
      if (foiRotacao && idadeDaRevogacao < GRACA_REUSO_MS) return { tipo: 'invalido' };

      // Fora da janela, um token revogado que volta é cópia em circulação.
      return { tipo: 'reuso', familyId: sessao.family_id };
    }

    if (new Date(sessao.expires_at).getTime() <= Date.now()) return { tipo: 'invalido' };

    // A senha pode ter mudado depois desta sessão nascer.
    const [usuario] = await tx<{ password_changed_at: Date; deleted_at: Date | null }[]>`
      SELECT password_changed_at, deleted_at FROM users WHERE id = ${sessao.user_id}
    `;
    if (!usuario || usuario.deleted_at) return { tipo: 'invalido' };

    const token = novoToken();
    const expiresAt = daquiA(REFRESH_TTL_DIAS);

    await tx`
      UPDATE sessions SET revoked_at = now(), revoked_reason = 'rotacao' WHERE id = ${sessao.id}
    `;

    const [nova] = await tx<{ id: string }[]>`
      INSERT INTO sessions (
        user_id, refresh_token_hash, device_label, platform, expires_at, family_id
      ) VALUES (
        ${sessao.user_id}, ${hash(token)}, ${dados.deviceLabel ?? null},
        ${dados.platform ?? null}, ${expiresAt}, ${sessao.family_id}
      )
      RETURNING id
    `;

    return {
      tipo: 'ok',
      userId: sessao.user_id,
      par: { refreshToken: token, sessionId: nova.id, expiresAt },
    };
  });

  if (decisao.tipo === 'invalido') return null;

  if (decisao.tipo === 'reuso') {
    // Fora da transação, para que a revogação sobreviva ao throw.
    await sql`
      UPDATE sessions
      SET revoked_at = now(), revoked_reason = 'reuso_detectado'
      WHERE family_id = ${decisao.familyId} AND revoked_at IS NULL
    `;
    throw new ReuseDetectado();
  }

  return { userId: decisao.userId, par: decisao.par };
}

/** Encerra uma sessão específica (logout deste aparelho). */
export async function revogarSessao(refreshToken: string): Promise<void> {
  await sql`
    UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
    WHERE refresh_token_hash = ${hash(refreshToken)} AND revoked_at IS NULL
  `;
}

/** Encerra todas as sessões do usuário. Usado no "sair de todos os aparelhos". */
export async function revogarTudo(userId: string, motivo: string): Promise<number> {
  const linhas = await sql`
    UPDATE sessions SET revoked_at = now(), revoked_reason = ${motivo}
    WHERE user_id = ${userId} AND revoked_at IS NULL
    RETURNING id
  `;
  return linhas.length;
}

export interface SessaoVisivel {
  id: string;
  deviceLabel: string | null;
  platform: string | null;
  createdAt: Date;
  lastUsedAt: Date;
}

/** As sessões ativas, para a tela "seus aparelhos". Nunca devolve token nem hash. */
export async function listarSessoes(userId: string): Promise<SessaoVisivel[]> {
  const linhas = await sql<
    {
      id: string;
      device_label: string | null;
      platform: string | null;
      created_at: Date;
      last_used_at: Date;
    }[]
  >`
    SELECT id, device_label, platform, created_at, last_used_at
    FROM sessions
    WHERE user_id = ${userId} AND revoked_at IS NULL AND expires_at > now()
    ORDER BY last_used_at DESC
  `;

  return linhas.map((l) => ({
    id: l.id,
    deviceLabel: l.device_label,
    platform: l.platform,
    createdAt: l.created_at,
    lastUsedAt: l.last_used_at,
  }));
}

/** Revoga uma sessão pelo id, conferindo que ela é do próprio usuário. */
export async function revogarPorId(sessionId: string, userId: string): Promise<boolean> {
  const linhas = await sql`
    UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
    WHERE id = ${sessionId} AND user_id = ${userId} AND revoked_at IS NULL
    RETURNING id
  `;
  return linhas.length > 0;
}

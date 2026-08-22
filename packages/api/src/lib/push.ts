/**
 * Envio de notificação para o aparelho, pelo serviço da Expo.
 *
 * ## O que pode ir num push, e o que nunca vai
 *
 * O push atravessa a Apple e o Google em texto que eles leem, aparece na tela de
 * bloqueio de quem estiver por perto e fica no histórico do sistema. Então vale
 * a mesma regra da telemetria, e por motivo mais forte: **daqui só sai número**.
 *
 *   pode ....... "Você perdeu 3 seguidores"
 *   não pode ... "@fulano deixou de te seguir"
 *
 * O nome de quem saiu existe no aparelho e só lá. Mandá-lo por push seria
 * publicar a rede social de alguém na barra de notificação — e, no caminho do
 * modo conectado, seria além de tudo mentira: a API oficial não diz quem.
 *
 * ## Por que o histórico é gravado antes do envio
 *
 * `notifications.dedupe_key` tem UNIQUE. Gravar primeiro faz do banco o guarda
 * da duplicidade: se o agendador rodar de novo depois de uma falha parcial, o
 * INSERT falha e o envio não acontece. Ao contrário, um envio bem-sucedido cujo
 * INSERT falhasse depois viraria a mesma notificação toda hora.
 */

import { sql } from '../db/client.js';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/** Quantos tokens por requisição. A Expo documenta 100 como teto. */
const LOTE = 100;

export interface Aviso {
  userId: string;
  profileId: string;
  /** Casa com a coluna `kind` de `notifications`. */
  kind: 'queda_seguidores' | 'lembrete_import' | 'sync_falhou';
  /** Chave estável do evento: 'queda:<profileId>:2026-08-21'. */
  dedupeKey: string;
  title: string;
  body: string;
}

interface RespostaDaExpo {
  data?: Array<{
    status?: string;
    message?: string;
    details?: { error?: string };
  }>;
}

/**
 * Manda um aviso para todos os aparelhos ativos do usuário.
 *
 * Devolve quantos aparelhos receberam. Zero é resultado normal e não é erro:
 * quem não instalou em nenhum aparelho, ou negou a permissão, não tem token.
 *
 * Nunca lança. Uma falha de push não pode derrubar a coleta de métricas que a
 * originou — o número já foi gravado, e é ele que o app mostra ao abrir.
 */
export async function enviarAviso(aviso: Aviso): Promise<number> {
  try {
    const inserido = await sql`
      INSERT INTO notifications (user_id, profile_id, kind, dedupe_key, title, body)
      VALUES (${aviso.userId}, ${aviso.profileId}, ${aviso.kind}, ${aviso.dedupeKey},
              ${aviso.title}, ${aviso.body})
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING id
    `;
    // Já saiu antes. É o caminho esperado quando o agendador repete.
    if (inserido.length === 0) return 0;

    const aparelhos = (await sql`
      SELECT id, expo_push_token FROM devices
      WHERE user_id = ${aviso.userId} AND disabled_at IS NULL
    `) as unknown as Array<{ id: string; expo_push_token: string }>;
    if (aparelhos.length === 0) return 0;

    let entregues = 0;
    for (let i = 0; i < aparelhos.length; i += LOTE) {
      entregues += await enviarLote(aparelhos.slice(i, i + LOTE), aviso);
    }
    return entregues;
  } catch {
    // Ver o cabeçalho: push é acessório, a métrica é o produto.
    return 0;
  }
}

async function enviarLote(
  aparelhos: Array<{ id: string; expo_push_token: string }>,
  aviso: Aviso,
): Promise<number> {
  /*
   * `EXPO_ACCESS_TOKEN` é opcional e recomendado: sem ele a Expo aceita o envio,
   * mas qualquer um que descubra um token de push de um usuário nosso pode
   * mandar notificação em nome do projeto. Gerado em expo.dev → Access Tokens.
   */
  const credencial = process.env.EXPO_ACCESS_TOKEN;

  const resposta = await fetch(EXPO_PUSH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(credencial ? { authorization: `Bearer ${credencial}` } : {}),
    },
    body: JSON.stringify(
      aparelhos.map((a) => ({
        to: a.expo_push_token,
        title: aviso.title,
        body: aviso.body,
        sound: 'default',
        // `data` chega ao app e serve para abrir a tela certa. Só o tipo do
        // evento e o perfil: nada de conteúdo.
        data: { kind: aviso.kind, profileId: aviso.profileId },
      })),
    ),
  });

  if (!resposta.ok) return 0;
  const corpo = (await resposta.json().catch(() => null)) as RespostaDaExpo | null;
  const tickets = corpo?.data ?? [];

  let ok = 0;
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket?.status === 'ok') {
      ok++;
      continue;
    }
    /*
     * `DeviceNotRegistered` significa app desinstalado ou token trocado.
     * Continuar disparando para ele é o que faz um projeto ser marcado como
     * abusivo pela Expo e perder o serviço para todo mundo.
     */
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      const aparelho = aparelhos[i];
      if (aparelho) {
        await sql`
          UPDATE devices
          SET disabled_at = now(), disabled_reason = 'DeviceNotRegistered'
          WHERE id = ${aparelho.id}
        `;
      }
    }
  }
  return ok;
}

export interface PreferenciasDeAviso {
  quedaSeguidores: boolean;
  quedaMinima: number;
  silencioInicioHora: number;
  silencioFimHora: number;
}

/** Preferências do perfil, com os padrões da tabela quando ainda não há linha. */
export async function lerPreferencias(profileId: string): Promise<PreferenciasDeAviso> {
  const [linha] = await sql`
    SELECT queda_seguidores, queda_minima, silencio_inicio_hora, silencio_fim_hora
    FROM notification_prefs WHERE profile_id = ${profileId}
  `;
  return {
    quedaSeguidores: linha?.queda_seguidores ?? true,
    quedaMinima: linha?.queda_minima ?? 1,
    silencioInicioHora: linha?.silencio_inicio_hora ?? 22,
    silencioFimHora: linha?.silencio_fim_hora ?? 8,
  };
}

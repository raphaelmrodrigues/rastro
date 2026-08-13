/**
 * Coleta periódica das métricas do modo conectado.
 *
 * A API do Instagram devolve o `followers_count` de agora, não a série histórica.
 * Então a série é construída por amostragem: uma leitura por perfil por dia.
 * Sem isto, o modo conectado não teria gráfico nenhum — só o número de hoje.
 *
 * Implementação deliberadamente simples (um `setInterval` no processo): o volume
 * é de uma requisição por perfil por dia. Quando houver mais de uma instância da
 * API, isto vira um job externo com trava — senão duas instâncias amostram o
 * mesmo perfil e a série ganha pontos duplicados.
 */

import { sql } from '../db/client.js';
import { collectMetrics } from '../routes/instagram.js';
import { isConnectedModeConfigured } from './instagramApi.js';

/** De quanto em quanto tempo procuramos perfis a amostrar. */
const TICK_MS = 60 * 60 * 1000;
/** Idade mínima da última amostra para coletar de novo. */
const MIN_AGE_MS = 20 * 60 * 60 * 1000;

interface Logger {
  info(payload: unknown, message?: string): void;
  warn(payload: unknown, message?: string): void;
}

async function tick(log: Logger): Promise<void> {
  const due = await sql`
    SELECT ca.profile_id
    FROM connected_accounts ca
    WHERE ca.last_sync_at IS NULL
       OR ca.last_sync_at < ${new Date(Date.now() - MIN_AGE_MS)}
  `;

  for (const row of due) {
    try {
      await collectMetrics(row.profile_id);
    } catch (error) {
      // Uma conta que falha (token revogado, conta virou pessoal) não pode
      // interromper a coleta das outras. O erro fica registrado na conta.
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ profileId: row.profile_id, message }, 'falha ao coletar métricas');
      await sql`UPDATE connected_accounts SET last_error = ${message} WHERE profile_id = ${row.profile_id}`;
    }
  }
}

export function startMetricsScheduler(log: Logger): void {
  if (!isConnectedModeConfigured()) {
    log.info({}, 'modo conectado desligado (sem credenciais do app da Meta)');
    return;
  }

  const run = () => {
    tick(log).catch((error) => log.warn({ error: String(error) }, 'tick de métricas falhou'));
  };

  // `unref` para o agendador não segurar o processo em pé no shutdown.
  setInterval(run, TICK_MS).unref();
  run();
}

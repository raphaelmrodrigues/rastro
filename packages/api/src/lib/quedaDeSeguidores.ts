/**
 * "Alguém deixou de te seguir" — o aviso, e o que ele pode dizer.
 *
 * ## O texto é sobre número, e é assim de propósito
 *
 * Este aviso nasce do modo conectado, onde a fonte é a API oficial da Meta. Ela
 * devolve `followers_count` e mais nada: **não existe** lista de quem saiu, para
 * nenhum aplicativo de terceiro. Então o aviso diz "você perdeu 3 seguidores" e
 * convida a importar o arquivo, que é onde os nomes moram.
 *
 * A tentação óbvia — "@fulano deixou de te seguir" — é impossível por dois
 * motivos ao mesmo tempo, e vale registrar os dois porque o pedido vai voltar:
 *
 *   1. O dado não existe aqui. Descobrir o nome exigiria API privada e sessão
 *      logada, que banem a conta do usuário (regras 1 e 2 do CLAUDE.md).
 *   2. Mesmo se existisse, o push atravessa Apple e Google em claro e aparece na
 *      tela de bloqueio. O @ de quem saiu não vai para lá.
 *
 * ## Por que não avisa alta
 *
 * Porque ninguém pede para ser interrompido com boa notícia todo dia, e um app
 * que notifica os dois lados vira barulho e é silenciado — junto com o aviso que
 * a pessoa queria.
 */

import { sql } from '../db/client.js';
import { enviarAviso, lerPreferencias } from './push.js';

/** Um número por dia, por perfil. A chave é o que impede o aviso repetido. */
const chaveDoDia = (profileId: string, quando: Date): string =>
  `queda:${profileId}:${quando.toISOString().slice(0, 10)}`;

/**
 * A hora local está dentro da faixa de silêncio?
 *
 * A faixa cruza a meia-noite no padrão (22h → 8h), então não dá para comparar
 * com um intervalo simples: `22 <= h && h < 8` é sempre falso.
 */
export function emSilencio(hora: number, inicio: number, fim: number): boolean {
  if (inicio === fim) return false;
  return inicio < fim ? hora >= inicio && hora < fim : hora >= inicio || hora < fim;
}

/**
 * Hora local do usuário, pelo fuso do aparelho mais recente.
 *
 * Sem aparelho com fuso conhecido, devolve `null` e o silêncio não se aplica —
 * quem não tem aparelho registrado também não recebe push, então a questão é
 * teórica; o `null` existe para não inventar um fuso e silenciar por engano.
 */
async function horaLocal(userId: string, quando: Date): Promise<number | null> {
  const [aparelho] = await sql`
    SELECT timezone FROM devices
    WHERE user_id = ${userId} AND disabled_at IS NULL AND timezone IS NOT NULL
    ORDER BY last_seen_at DESC LIMIT 1
  `;
  if (!aparelho?.timezone) return null;
  try {
    const texto = new Intl.DateTimeFormat('en-US', {
      timeZone: aparelho.timezone,
      hour: 'numeric',
      hour12: false,
    }).format(quando);
    const hora = Number(texto);
    return Number.isFinite(hora) ? hora % 24 : null;
  } catch {
    // Fuso inválido guardado por uma versão antiga do app. Não silencia.
    return null;
  }
}

/**
 * Compara duas contagens e avisa, se for o caso.
 *
 * Nunca lança: é chamada sem `await` de dentro da coleta, e uma exceção aqui
 * viraria rejeição não tratada no processo da API.
 */
export async function avisarSeCaiu(
  profileId: string,
  antes: number,
  agora: number,
  quando = new Date(),
): Promise<void> {
  try {
    const perdidos = antes - agora;
    if (perdidos <= 0) return;

    const [perfil] = await sql`SELECT user_id, handle FROM profiles WHERE id = ${profileId}`;
    if (!perfil) return;

    const prefs = await lerPreferencias(profileId);
    if (!prefs.quedaSeguidores) return;
    if (perdidos < prefs.quedaMinima) return;

    /*
     * Dentro da faixa de silêncio o aviso não é enviado NEM gravado. Gravar
     * queimaria a chave do dia e o aviso nunca sairia: o agendador roda de hora
     * em hora, então ele volta aqui depois que a faixa terminar e manda com a
     * mesma chave.
     */
    const hora = await horaLocal(perfil.user_id, quando);
    if (hora !== null && emSilencio(hora, prefs.silencioInicioHora, prefs.silencioFimHora)) {
      return;
    }

    await enviarAviso({
      userId: perfil.user_id,
      profileId,
      kind: 'queda_seguidores',
      dedupeKey: chaveDoDia(profileId, quando),
      title: perdidos === 1 ? 'Você perdeu 1 seguidor' : `Você perdeu ${perdidos} seguidores`,
      // A segunda frase não é enfeite: é a única resposta honesta à pergunta que
      // a primeira provoca, e evita que a pessoa abra o app procurando um nome
      // que o modo conectado nunca vai ter.
      body:
        `Sua contagem caiu de ${antes} para ${agora}. ` +
        'Para saber quem saiu, importe um arquivo novo do Instagram.',
    });
  } catch {
    // Ver o cabeçalho de push.ts: a métrica já está gravada e é ela que importa.
  }
}

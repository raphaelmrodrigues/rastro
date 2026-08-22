/**
 * Webhook do Instagram — mensagens e comentários chegando em tempo real.
 *
 * ## O que entra por aqui
 *
 * A API oficial **não tem endpoint de histórico** de mensagens. O que existe é
 * este webhook: a partir do momento em que o usuário conecta, cada mensagem e
 * cada comentário novo chega aqui. O que aconteceu antes não existe para o app,
 * e a tela diz isso — lista vazia sem explicação parece defeito.
 *
 * ## A regra que não se negocia neste arquivo
 *
 * **Nada de texto entra no banco em claro.** O evento chega, é selado com a
 * chave pública do perfil (`lib/cofre.ts`) e gravado. O servidor não guarda como
 * abrir. Se algum dia alguém precisar "só espiar para depurar", a resposta é
 * não: é justamente essa impossibilidade que sustenta a decisão de guardar DM.
 *
 * Perfil sem chave pública registrada **descarta o evento**. Guardar em claro
 * "só até o app registrar a chave" é como toda promessa de criptografia morre.
 *
 * ## Por que o corpo é lido como buffer
 *
 * A assinatura `X-Hub-Signature-256` é o HMAC do corpo **exatamente como veio**.
 * Deixar o Fastify parsear e depois re-serializar muda espaços e ordem de chave,
 * e a verificação falha sem motivo aparente. O parser abaixo é local a este
 * plugin — o resto da API continua recebendo JSON normal.
 */

import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../db/client.js';
import { chavePublicaValida, selar } from '../lib/cofre.js';

/** Quanto tempo o conteúdo fica no servidor. Ver a migração 005. */
const RETENCAO_DIAS = Number(process.env.INSTAGRAM_CONTENT_RETENTION_DAYS ?? 30);

interface EventoDeMensagem {
  sender?: { id?: unknown };
  recipient?: { id?: unknown };
  timestamp?: unknown;
  message?: {
    mid?: unknown;
    text?: unknown;
    is_echo?: unknown;
    is_deleted?: unknown;
    attachments?: Array<{ type?: unknown }>;
  };
}

interface MudancaDeComentario {
  field?: unknown;
  value?: {
    id?: unknown;
    text?: unknown;
    parent_id?: unknown;
    from?: { id?: unknown; username?: unknown };
    media?: { id?: unknown };
  };
}

interface Entrada {
  id?: unknown;
  time?: unknown;
  messaging?: EventoDeMensagem[];
  changes?: MudancaDeComentario[];
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const ehVerdade = (v: unknown): boolean => v === true;

/** Assinatura confere? Comparação em tempo constante, como manda o manual. */
function assinaturaConfere(corpo: Buffer, cabecalho: string | undefined): boolean {
  const segredo = process.env.INSTAGRAM_APP_SECRET;
  if (!segredo || !cabecalho?.startsWith('sha256=')) return false;

  const esperado = createHmac('sha256', segredo).update(corpo).digest();
  let recebido: Buffer;
  try {
    recebido = Buffer.from(cabecalho.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  // `timingSafeEqual` lança se os tamanhos diferem — checar antes é obrigatório.
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/** O perfil dono da conta do Instagram que gerou o evento, e a chave dele. */
async function destinatario(
  igUserId: string,
): Promise<{ profileId: string; publicKey: string } | null> {
  const [linha] = await sql`
    SELECT ca.profile_id, pk.public_key
    FROM connected_accounts ca
    LEFT JOIN profile_keys pk ON pk.profile_id = ca.profile_id
    WHERE ca.ig_user_id = ${igUserId}
  `;
  if (!linha?.public_key || !chavePublicaValida(linha.public_key)) return null;
  return { profileId: linha.profile_id, publicKey: linha.public_key };
}

const expiraEm = (): Date => new Date(Date.now() + RETENCAO_DIAS * 24 * 3600 * 1000);

/**
 * O que sobra de um anexo: o tipo, nunca a URL.
 *
 * A URL da mídia do Instagram é assinada e temporária, mas é acesso ao arquivo.
 * O app mostra "mandou uma foto", que é o que a pessoa precisa para lembrar da
 * conversa — mesma escolha de `activity.ts` no caminho do export.
 */
function rotuloDoAnexo(anexos: Array<{ type?: unknown }> | undefined): string {
  const tipos = (anexos ?? []).map((a) => texto(a.type)).filter(Boolean);
  if (tipos.length === 0) return '';
  const nomes: Record<string, string> = {
    image: 'uma foto',
    video: 'um vídeo',
    audio: 'um áudio',
    file: 'um arquivo',
    share: 'um post',
    story_mention: 'uma menção em story',
    ig_reel: 'um reel',
  };
  return `[mandou ${nomes[tipos[0]!] ?? 'um anexo'}]`;
}

async function guardarMensagem(entrada: Entrada, evento: EventoDeMensagem): Promise<void> {
  const igUserId = texto(entrada.id);
  const mid = texto(evento.message?.mid);
  if (!igUserId || !mid) return;

  // Mensagem apagada pelo remetente não vira registro: o Rastro não pode ser o
  // lugar onde sobrevive o que a pessoa apagou.
  if (ehVerdade(evento.message?.is_deleted)) return;

  const alvo = await destinatario(igUserId);
  if (!alvo) return;

  /*
   * `is_echo` marca as mensagens que o próprio dono da conta mandou — elas
   * voltam pelo webhook. O `sender` nesse caso é ele, então quem está do outro
   * lado é o `recipient`.
   */
  const daPessoa = ehVerdade(evento.message?.is_echo);
  const outroLado = texto(daPessoa ? evento.recipient?.id : evento.sender?.id);

  const corpo = texto(evento.message?.text);
  const anexo = rotuloDoAnexo(evento.message?.attachments);
  const conteudo = [corpo, anexo].filter(Boolean).join(' ').trim();
  if (!conteudo) return;

  const quando = typeof evento.timestamp === 'number' ? new Date(evento.timestamp) : new Date();

  await sql`
    INSERT INTO instagram_messages (
      profile_id, message_id, thread_id, from_self, sender_id, sent_at, payload_enc, expires_at
    ) VALUES (
      ${alvo.profileId}, ${mid}, ${outroLado || 'desconhecido'}, ${daPessoa},
      ${texto(evento.sender?.id) || null}, ${quando},
      ${selar(JSON.stringify({ text: conteudo }), alvo.publicKey)}, ${expiraEm()}
    )
    ON CONFLICT (profile_id, message_id) DO NOTHING
  `;
}

async function guardarComentario(entrada: Entrada, mudanca: MudancaDeComentario): Promise<void> {
  const igUserId = texto(entrada.id);
  const valor = mudanca.value;
  const id = texto(valor?.id);
  if (!igUserId || !id) return;

  const alvo = await destinatario(igUserId);
  if (!alvo) return;

  const conteudo = texto(valor?.text);
  if (!conteudo) return;

  const autor = texto(valor?.from?.username);
  const quando =
    typeof entrada.time === 'number' ? new Date(entrada.time * 1000) : new Date();

  await sql`
    INSERT INTO instagram_comments (
      profile_id, comment_id, media_id, parent_id, from_self, created_at, payload_enc, expires_at
    ) VALUES (
      ${alvo.profileId}, ${id}, ${texto(valor?.media?.id) || null},
      ${texto(valor?.parent_id) || null},
      ${texto(valor?.from?.id) === igUserId},
      ${quando},
      ${selar(JSON.stringify({ text: conteudo, username: autor }), alvo.publicKey)},
      ${expiraEm()}
    )
    ON CONFLICT (profile_id, comment_id) DO NOTHING
  `;
}

export const instagramWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Local a este plugin: o resto da API continua com o parser padrão.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, corpo, feito) => feito(null, corpo),
  );

  /**
   * Verificação de posse da URL. A Meta chama uma vez, ao salvar o webhook no
   * painel, e espera o `hub.challenge` devolvido como texto puro.
   */
  app.get('/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const esperado = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

    if (!esperado) return reply.code(503).send('Webhook não configurado.');
    if (q['hub.mode'] !== 'subscribe' || q['hub.verify_token'] !== esperado) {
      return reply.code(403).send('Verificação recusada.');
    }
    return reply.type('text/plain').send(q['hub.challenge'] ?? '');
  });

  /**
   * Os eventos.
   *
   * Responde 200 antes de terminar de gravar, e isso é deliberado: a Meta
   * reenvia o evento se não receber 200 em poucos segundos, e reenvio com o
   * banco lento vira evento duplicado. O `ON CONFLICT` cobre o resto.
   *
   * Erro aqui nunca vira 500. Um 500 faz a Meta reentregar e, se o defeito for
   * nosso e persistente, desativar o webhook por "falha do endpoint".
   */
  app.post('/webhook', async (req, reply) => {
    const corpo = req.body as Buffer;
    if (!assinaturaConfere(corpo, req.headers['x-hub-signature-256'] as string | undefined)) {
      return reply.code(401).send();
    }

    reply.code(200).send();

    try {
      const evento = JSON.parse(corpo.toString('utf8')) as { entry?: Entrada[] };
      for (const entrada of evento.entry ?? []) {
        for (const m of entrada.messaging ?? []) {
          if (m.message) await guardarMensagem(entrada, m);
        }
        for (const c of entrada.changes ?? []) {
          if (texto(c.field) === 'comments') await guardarComentario(entrada, c);
        }
      }
    } catch (erro) {
      req.log.warn({ erro: String(erro) }, 'evento de webhook do Instagram descartado');
    }
  });
};

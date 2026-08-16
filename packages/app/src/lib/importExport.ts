/**
 * Leitura do .zip do export DENTRO do aparelho.
 *
 * Este e o caminho "modo privado": o arquivo nunca sai do celular. O upload para a
 * API e opcional e existe so para sincronizar historico entre aparelhos.
 *
 * Regra: filtrar antes de descompactar. O export completo do Instagram passa de
 * 100 MB — o do dono do projeto tem 479 MB — e e quase todo midia. Dos milhares
 * de arquivos do zip, poucos interessam.
 *
 * ## Os dois tamanhos de export
 *
 * O app aceita os dois pedidos que o Instagram oferece:
 *
 * - **só "Seguidores e seguindo"**: 662 KB no arquivo real, dez arquivos. É o
 *   padrão e é o que o onboarding pede, porque fica pronto muito mais rápido.
 * - **"Todas as informações"**: 479 MB, com conversas, comentários, anunciantes
 *   e buscas. Habilita a aba Atividade.
 *
 * Uma passagem só do zip cobre os dois: o filtro aceita as listas de relação e
 * os arquivos de atividade, e quem não tiver os segundos simplesmente termina
 * com `atividade: null`. Ler o zip duas vezes custaria dezenas de segundos a
 * mais num arquivo desse tamanho.
 */

import {
  conversationFolder,
  isActivityFile,
  parseAdvertisers,
  parseComments,
  parseExport,
  parseProfileSearches,
  readConversation,
  summarizeConversations,
  RELEVANT_EXPORT_FILE,
  type ActivityData,
  type ConversationDraft,
  type Snapshot,
} from '@rastro/core';
import { extrairDoZip, type FonteArquivo } from './zip';

export interface ImportResult {
  snapshot: Snapshot;
  /** Quantos arquivos de lista foram encontrados. Zero significa export errado. */
  filesFound: number;
  /** Só existe quando o usuário pediu o export completo. */
  atividade: ActivityData | null;
}

/** Casa com os arquivos de atividade que não são conversa (poucos e pequenos). */
const COMENTARIOS = /comments\/(post_comments_\d+|reels_comments)\.json$/;
const ANUNCIANTES = /advertisers_using_your_activity_or_information\.json$/;
const BUSCAS = /recent_searches\/profile_searches\.json$/;

/**
 * Monta um snapshot a partir do zip, e o resumo de atividade se ele estiver lá.
 *
 * Aceita export em JSON e em HTML. O JSON e melhor (data exata), mas o usuario
 * costuma trazer HTML, que e o formato oferecido por padrao em varios pontos do
 * app do Instagram — e recusar o arquivo depois de ele ter esperado ate 48h pelo
 * download seria perder o usuario por preciosismo.
 */
export async function snapshotFromZip(
  fonte: FonteArquivo,
  snapshotId: string,
  aoProgredir?: (fracao: number) => void,
): Promise<ImportResult> {
  const listas: Record<string, string> = {};
  const comentarios: unknown[] = [];
  const conversas: ConversationDraft[] = [];
  let anunciantesCru: unknown = null;
  let buscasCru: unknown = null;

  const lerJson = (conteudo: string): unknown => {
    try {
      return JSON.parse(conteudo);
    } catch {
      return null;
    }
  };

  await extrairDoZip(
    fonte,
    (nome) => RELEVANT_EXPORT_FILE.test(nome) || isActivityFile(nome),
    aoProgredir,
    /*
     * Cada arquivo é tratado e descartado aqui dentro.
     *
     * As conversas são o motivo: são 1.582 arquivos somando 59 MB de JSON no
     * export real. Guardá-las para processar depois pediria 59 MB de string de
     * uma vez, que é exatamente o que o leitor de zip existe para evitar. Aqui
     * cada uma vira um resumo de poucas dezenas de bytes — 182 KB no total — e o
     * texto some antes do arquivo seguinte.
     */
    (nome, conteudo) => {
      if (RELEVANT_EXPORT_FILE.test(nome)) {
        listas[nome] = conteudo;
        return;
      }

      const pasta = conversationFolder(nome);
      if (pasta) {
        const draft = readConversation(lerJson(conteudo), pasta);
        if (draft) conversas.push(draft);
        return;
      }

      if (COMENTARIOS.test(nome)) comentarios.push(lerJson(conteudo));
      else if (ANUNCIANTES.test(nome)) anunciantesCru = lerJson(conteudo);
      else if (BUSCAS.test(nome)) buscasCru = lerJson(conteudo);
    },
  );

  const files: Record<string, unknown> = {};
  for (const [caminho, conteudo] of Object.entries(listas)) {
    const valor = caminho.endsWith('.json') ? lerJson(conteudo) : conteudo;
    // JSON quebrado nao derruba o import inteiro. O core registra o warning
    // do que faltou; um import parcial vale mais que um import falho.
    if (valor !== null) files[caminho] = valor;
  }

  const snapshot = parseExport({
    files,
    snapshotId,
    importedAt: Date.now(),
    // Se o cabecalho do HTML nao declarar o fuso, assumir o do aparelho e melhor
    // palpite do que UTC: o export foi gerado para este usuario.
    fallbackTimezoneOffsetMinutes: -new Date().getTimezoneOffset(),
  });

  return {
    snapshot,
    filesFound: Object.keys(files).length,
    atividade: montarAtividade(snapshot, conversas, comentarios, anunciantesCru, buscasCru),
  };
}

/**
 * Junta o que veio do export completo.
 *
 * Devolve `null` quando nada de atividade apareceu — o caso de quem pediu só
 * "Seguidores e seguindo", que é o padrão. `null` é o sinal que a interface usa
 * para oferecer o export completo em vez de mostrar telas vazias.
 */
function montarAtividade(
  snapshot: Snapshot,
  conversas: ConversationDraft[],
  comentarios: unknown[],
  anunciantesCru: unknown,
  buscasCru: unknown,
): ActivityData | null {
  const temAlgo =
    conversas.length > 0 || comentarios.length > 0 || anunciantesCru !== null || buscasCru !== null;
  if (!temAlgo) return null;

  /*
   * Os @ que já conhecemos, para tentar ligar uma conversa a um perfil que dê
   * para abrir. Só as duas listas grandes: um @ de bloqueado ou restrito não
   * ajuda a abrir uma conversa e só aumentaria a chance de casar errado.
   */
  const conhecidos = new Set<string>();
  for (const r of snapshot.relationships.followers) conhecidos.add(r.username);
  for (const r of snapshot.relationships.following) conhecidos.add(r.username);

  const { self, conversations } = summarizeConversations(conversas, conhecidos);

  return {
    builtAt: Date.now(),
    self,
    conversations,
    commentedOn: parseComments(comentarios),
    advertisers: anunciantesCru ? parseAdvertisers(anunciantesCru) : [],
    profileSearches: buscasCru ? parseProfileSearches(buscasCru) : [],
    warnings: [],
  };
}

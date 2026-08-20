/**
 * Relatos de falha para o servidor.
 *
 * Existem por um motivo específico: o Instagram muda o formato do export sem
 * aviso. Quando isso acontecer, o parser vai começar a descartar listas — e o
 * sintoma para o usuário é uma tela dizendo "você segue 0 pessoas" com toda a
 * cara de dado correto. Sem telemetria, o dono descobre por avaliação ruim na
 * loja, semanas depois, sem saber qual versão nem qual arquivo.
 *
 * ## A regra que este arquivo existe para não quebrar
 *
 * **Nenhum conteúdo de snapshot sai daqui.** E o perigo é concreto: o campo
 * `detail` de um `ParseWarning` é texto livre e traz o @ da pessoa dentro da
 * frase — `Entrada "fulano" sem timestamp`. Mandar o warning inteiro seria
 * transformar diagnóstico em vazamento contínuo, sem ninguém perceber.
 *
 * Por isso só atravessam: o `code`, o nome do arquivo e uma contagem. O texto do
 * aviso fica no aparelho.
 *
 * ## Nunca atrapalha o usuário
 *
 * Toda função aqui engole o próprio erro. Um servidor fora do ar não pode
 * derrubar um import que funcionou, e telemetria que quebra o app é pior que
 * telemetria nenhuma.
 */

import { Platform } from 'react-native';
import type { ParseWarning, Snapshot } from '@rastro/core';
import { API_URL, VERSAO_DO_APP, tokenAtual } from './../api/client';

/** Plataforma no formato que o servidor aceita. */
function plataforma(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

async function enviar(corpo: unknown): Promise<void> {
  try {
    const token = tokenAtual();
    await fetch(`${API_URL}/reports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rastro-versao': VERSAO_DO_APP,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(corpo),
    });
  } catch {
    // Silêncio de propósito. Ver o cabeçalho do arquivo.
  }
}

/**
 * Agrupa os avisos por código e arquivo, jogando fora o texto.
 *
 * Um export com 2.000 entradas sem timestamp gera 2.000 warnings; o que
 * interessa saber é "MISSING_TIMESTAMP, neste arquivo, 2.000 vezes".
 */
function resumirAvisos(warnings: ParseWarning[]): Array<{ code: string; file?: string; count: number }> {
  const por = new Map<string, { code: string; file?: string; count: number }>();

  for (const w of warnings) {
    const chave = `${w.code}|${w.file ?? ''}`;
    const atual = por.get(chave);
    if (atual) atual.count += 1;
    else por.set(chave, { code: w.code, ...(w.file ? { file: w.file } : {}), count: 1 });
  }

  // O servidor aceita no máximo 50; os mais frequentes são os que importam.
  return [...por.values()].sort((a, b) => b.count - a.count).slice(0, 50);
}

/**
 * Relata um import que terminou com avisos.
 *
 * Só manda quando há aviso. Import limpo é a maioria e não tem o que dizer —
 * relatar todos gastaria dados do usuário e encheria a tabela de ruído.
 */
export function relatarImport(snapshot: Snapshot, arquivosEncontrados: number): void {
  if (snapshot.warnings.length === 0) return;

  void enviar({
    kind: 'parse',
    appVersion: VERSAO_DO_APP,
    platform: plataforma(),
    warnings: resumirAvisos(snapshot.warnings),
    ...(snapshot.format ? { format: snapshot.format } : {}),
    // Contagens, não conteúdo. Zero seguidor com arquivo encontrado é o padrão
    // exato de "o formato mudou e o parser não viu nada".
    followers: snapshot.relationships.followers.length,
    following: snapshot.relationships.following.length,
    files: arquivosEncontrados,
  });
}

/** Corta o que for grande demais e tira quebra de linha, que polui a tabela. */
function limpar(texto: string, max: number): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Como `limpar`, mas preserva a quebra de linha.
 *
 * A pilha sem quebra de linha é uma frase de quatro mil caracteres que ninguém
 * lê. O painel mostra a pilha dentro de um bloco de código, onde cada `at ...`
 * na sua própria linha é o que a torna legível — juntar tudo era desperdiçar um
 * dado que já estava sendo guardado.
 */
function limparPilha(texto: string, max: number): string {
  return texto
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim()
    .slice(0, max);
}

/**
 * Relata um erro que derrubou uma tela.
 *
 * A mensagem é o único texto livre que sai do aparelho. É um risco aceito e
 * limitado: sem ela, o relato diz "algo quebrou" e não serve para consertar
 * nada. Vai truncada, e a origem são erros de código, não dados do usuário.
 */
export function relatarErro(erro: unknown, tela?: string): void {
  const e = erro instanceof Error ? erro : new Error(String(erro));

  void enviar({
    kind: 'crash',
    appVersion: VERSAO_DO_APP,
    platform: plataforma(),
    name: limpar(e.name || 'Error', 120),
    /*
     * Mil, e não os 500 de antes: no Android um erro vindo do módulo nativo traz
     * o rastro de pilha do Java dentro da própria `message`, e meio kilobyte
     * cortava exatamente a parte que dizia onde tinha estourado.
     */
    message: limpar(e.message || 'sem mensagem', 1000),
    ...(e.stack ? { stack: limparPilha(e.stack, 4000) } : {}),
    ...(tela ? { screen: limpar(tela, 60) } : {}),
  });
}

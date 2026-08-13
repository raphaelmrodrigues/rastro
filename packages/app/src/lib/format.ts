/**
 * Texto de data e numero.
 *
 * O trabalho central deste arquivo e nao mentir. Um evento com precisao 'window'
 * NUNCA pode ser escrito como se tivesse hora certa: o app so sabe que aconteceu
 * entre dois imports. Escrever "saiu em 12/03 as 14h" quando a verdade e "entre
 * 01/03 e 15/03" e o tipo de detalhe que o usuario acaba conferindo — e quando ele
 * descobre, perde a confianca em todo o resto do app, inclusive no que esta certo.
 */

import type { FollowEvent, Precision } from '@rastro/core';

const DIA_MS = 86_400_000;

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "há 3 dias", "hoje". Usado onde a data exata nao acrescenta nada. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const days = Math.floor((now - timestamp) / DIA_MS);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'há 1 mês';
  if (months < 12) return `há ${months} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'há 1 ano' : `há ${years} anos`;
}

/**
 * A frase de um evento, calibrada pela precisao.
 *
 * 'exact'  -> o export disse a data; podemos afirmar.
 * 'window' -> so sabemos o intervalo; a frase precisa dizer "entre".
 */
export function describeEvent(event: FollowEvent): string {
  if (event.precision === 'exact') {
    return `entrou em ${formatDate(event.at)}`;
  }

  const mesmoDia =
    new Date(event.windowStart).toDateString() === new Date(event.windowEnd).toDateString();

  if (mesmoDia) return `saiu em ${formatDate(event.windowEnd)}`;
  return `saiu entre ${formatDate(event.windowStart)} e ${formatDate(event.windowEnd)}`;
}

/** Rotulo curto para o selo de precisao ao lado do evento. */
export function precisionLabel(precision: Precision): string {
  return precision === 'exact' ? 'data exata' : 'data aproximada';
}

export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits).replace('.', ',')}%`;
}

/** 'YYYY-MM' -> 'mar/2026'. */
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const nome = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${nome}/${year}`;
}

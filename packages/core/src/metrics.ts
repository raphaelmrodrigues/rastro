/**
 * Modo conectado: métricas obtidas da API oficial do Instagram, sem arquivo.
 *
 * ## O que este modo é, e o que ele não é
 *
 * A API oficial da Meta (Instagram API with Instagram Login / Graph API) **não tem
 * endpoint de lista de seguidores**. Não é uma permissão que falta pedir nem um
 * escopo que se aprove: o endpoint não existe desde a descontinuação da API antiga.
 * O que existe é contagem e agregado:
 *
 *   - `followers_count` no perfil            → um número, sem nomes
 *   - insights `follows_and_unfollows`        → quantos entraram e saíram no período
 *   - insights `follower_demographics`        → país/cidade/idade/gênero agregados
 *
 * Consequência que a UI precisa dizer com todas as letras: **o modo conectado nunca
 * responde "quem" deixou de seguir.** Ele responde "quantos". Quem saiu, nominalmente,
 * só sai do arquivo de export.
 *
 * Qualquer serviço que prometa a lista nominal sem o export está usando API privada
 * ou sessão logada do usuário — exatamente o que queima a conta do cliente, e o que
 * as regras 1 e 2 do CLAUDE.md proíbem. Não é uma limitação nossa a contornar: é a
 * fronteira do que dá para fazer sem colocar a conta de quem usa o app em risco.
 *
 * ## Por que amostramos em vez de perguntar o histórico
 *
 * A API devolve o `followers_count` de agora, não a série histórica. Então o histórico
 * é nosso: guardamos uma amostra por dia e a série nasce daí. Isso significa que o
 * modo conectado só conhece o que aconteceu **depois** que o usuário conectou — ele
 * não tem passado. O modo arquivo, ao contrário, já nasce com anos de histórico,
 * porque o export traz a data em que cada seguidor entrou.
 *
 * Os dois se complementam, e é por isso que o app oferece os dois.
 *
 * Pureza: nada aqui faz HTTP. As funções recebem a resposta já baixada pela camada
 * de fora e devolvem objetos. O cliente HTTP mora em packages/api.
 */

/** Uma leitura do perfil num instante. É o que amostramos periodicamente. */
export interface ProfileSample {
  /** ms UTC do momento da coleta. */
  at: number;
  followerCount: number;
  followsCount?: number;
  mediaCount?: number;
}

/** Um dia da série reconstruída a partir das amostras. */
export interface DailyFollowerPoint {
  /** 'YYYY-MM-DD' em UTC. */
  day: string;
  /** Contagem no fim do dia (última amostra do dia). */
  followerCount: number;
  /**
   * Variação em relação ao dia anterior com amostra.
   * `null` no primeiro ponto: não há com o que comparar, e zero seria mentira.
   */
  netChange: number | null;
  /**
   * Dias desde a amostra anterior. Maior que 1 significa que houve buraco na
   * coleta e a variação se acumulou — a UI não deve desenhar isso como um dia.
   */
  gapDays: number;
}

/** Entradas e saídas agregadas num período, vindas de insights. */
export interface FollowActivity {
  /** 'YYYY-MM-DD' em UTC. */
  day: string;
  follows: number;
  unfollows: number;
}

export interface AudienceBreakdown {
  /** 'country' | 'city' | 'age' | 'gender', como pedido no breakdown. */
  dimension: string;
  entries: Array<{ label: string; value: number }>;
}

/** 'YYYY-MM-DD' em UTC. Toda agregação diária do core usa UTC. */
export function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/**
 * Reconstrói a série diária a partir das amostras cruas.
 *
 * Regras deliberadas:
 *  - uma amostra por dia (a última vence): coletas repetidas no mesmo dia não
 *    viram degraus falsos no gráfico;
 *  - `netChange` do primeiro ponto é null, não zero — não sabemos o que veio antes;
 *  - buracos de coleta viram `gapDays`, para o gráfico poder marcar a incerteza em
 *    vez de fingir que a variação de uma semana aconteceu num dia.
 */
export function buildDailySeries(samples: ProfileSample[]): DailyFollowerPoint[] {
  const lastOfDay = new Map<string, ProfileSample>();
  for (const sample of samples) {
    const key = dayKey(sample.at);
    const current = lastOfDay.get(key);
    if (!current || sample.at >= current.at) lastOfDay.set(key, sample);
  }

  const days = [...lastOfDay.keys()].sort();
  return days.map((day, index) => {
    const sample = lastOfDay.get(day)!;
    if (index === 0) {
      return { day, followerCount: sample.followerCount, netChange: null, gapDays: 0 };
    }
    const previousDay = days[index - 1];
    const previous = lastOfDay.get(previousDay)!;
    return {
      day,
      followerCount: sample.followerCount,
      netChange: sample.followerCount - previous.followerCount,
      gapDays: Math.round((Date.parse(day) - Date.parse(previousDay)) / DAY_MS),
    };
  });
}

/**
 * Soma o movimento de um intervalo fechado de dias.
 * `net` vem da diferença de contagem, não da soma dos netChange, para não propagar
 * o buraco de dias sem coleta.
 */
export function summarizeSeries(
  series: DailyFollowerPoint[],
): { from: string; to: string; net: number; startCount: number; endCount: number } | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  return {
    from: first.day,
    to: last.day,
    net: last.followerCount - first.followerCount,
    startCount: first.followerCount,
    endCount: last.followerCount,
  };
}

// --- Leitura das respostas de insights ---------------------------------------
// O formato abaixo é o da Graph API com metric_type=total_value. Ele já mudou de
// forma entre versões, então tudo aqui é defensivo: campo faltando vira ausência
// de dado, nunca exceção.

interface RawInsightsResponse {
  data?: Array<{
    name?: string;
    period?: string;
    total_value?: {
      value?: number;
      breakdowns?: Array<{
        dimension_keys?: string[];
        results?: Array<{ dimension_values?: string[]; value?: number }>;
      }>;
    };
    values?: Array<{ value?: number; end_time?: string }>;
  }>;
}

/**
 * Lê `follows_and_unfollows` com breakdown por `follow_type`.
 *
 * A Meta não documenta de forma estável os rótulos do breakdown, e eles já
 * apareceram como FOLLOWER/UNFOLLOWER e como FOLLOW/UNFOLLOW. Em vez de casar com
 * uma lista de constantes que envelhece, classificamos pelo radical "unfollow":
 * o que contém é saída, o resto é entrada.
 *
 * `day` precisa ser informado por quem chamou, porque a resposta de total_value
 * descreve o intervalo pedido, não um dia específico.
 */
export function parseFollowActivity(raw: unknown, day: string): FollowActivity {
  const response = raw as RawInsightsResponse;
  const metric = response?.data?.find((d) => d.name === 'follows_and_unfollows');

  let follows = 0;
  let unfollows = 0;

  for (const breakdown of metric?.total_value?.breakdowns ?? []) {
    for (const result of breakdown.results ?? []) {
      const label = (result.dimension_values ?? []).join(' ').toLowerCase();
      const value = typeof result.value === 'number' ? result.value : 0;
      if (label.includes('unfollow')) unfollows += value;
      else follows += value;
    }
  }

  return { day, follows, unfollows };
}

/** Lê um breakdown demográfico (`follower_demographics`) para uma dimensão. */
export function parseAudienceBreakdown(raw: unknown, dimension: string): AudienceBreakdown {
  const response = raw as RawInsightsResponse;
  const metric = response?.data?.find((d) => d.name === 'follower_demographics');
  const entries: Array<{ label: string; value: number }> = [];

  for (const breakdown of metric?.total_value?.breakdowns ?? []) {
    for (const result of breakdown.results ?? []) {
      const label = (result.dimension_values ?? [])[0];
      if (!label) continue;
      entries.push({ label, value: typeof result.value === 'number' ? result.value : 0 });
    }
  }

  entries.sort((a, b) => b.value - a.value);
  return { dimension, entries };
}

/** Lê `followers_count` / `follows_count` da resposta de perfil (`GET /me`). */
export function parseProfileSample(raw: unknown, at: number): ProfileSample | null {
  const profile = raw as Record<string, unknown> | null;
  const followerCount = profile?.['followers_count'];
  if (typeof followerCount !== 'number') return null;

  const followsCount = profile?.['follows_count'];
  const mediaCount = profile?.['media_count'];
  return {
    at,
    followerCount,
    ...(typeof followsCount === 'number' ? { followsCount } : {}),
    ...(typeof mediaCount === 'number' ? { mediaCount } : {}),
  };
}

// --- Honestidade sobre o modo ------------------------------------------------

/**
 * O que cada modo consegue responder.
 *
 * Isto não é documentação: é dado que a UI consome para montar a comparação na tela
 * de escolha do modo. Está no core, e não numa tela, porque a promessa precisa ser a
 * mesma no app, no site e em qualquer material — e porque mudar a promessa deve
 * exigir mexer no mesmo lugar que muda o comportamento.
 */
export interface ModeCapability {
  question: string;
  fileMode: 'yes' | 'no' | 'partial';
  connectedMode: 'yes' | 'no' | 'partial';
  note?: string;
}

export const MODE_CAPABILITIES: readonly ModeCapability[] = [
  {
    question: 'Quantos seguidores eu tenho',
    fileMode: 'yes',
    connectedMode: 'yes',
    note: 'No modo conectado, atualiza sozinho todo dia.',
  },
  {
    question: 'Quantos entraram e saíram no período',
    fileMode: 'yes',
    connectedMode: 'yes',
    note: 'Modo conectado usa a métrica oficial de follows/unfollows.',
  },
  {
    question: 'QUEM deixou de me seguir',
    fileMode: 'yes',
    connectedMode: 'no',
    note: 'A API oficial não expõe a lista de seguidores. Só o export tem os nomes.',
  },
  {
    question: 'QUEM começou a me seguir',
    fileMode: 'yes',
    connectedMode: 'no',
    note: 'Mesma limitação: o modo conectado só dá o número.',
  },
  {
    question: 'Quem não me segue de volta',
    fileMode: 'yes',
    connectedMode: 'no',
    note: 'Exige as duas listas nominais, que só o export entrega.',
  },
  {
    question: 'Solicitações pendentes que enviei',
    fileMode: 'yes',
    connectedMode: 'no',
  },
  {
    question: 'De onde é o meu público (país, cidade, idade)',
    fileMode: 'no',
    connectedMode: 'yes',
    note: 'Só a API tem demografia, e só para contas profissionais com 100+ seguidores.',
  },
  {
    question: 'Alcance e visualizações dos posts',
    fileMode: 'no',
    connectedMode: 'yes',
  },
  {
    question: 'Histórico anterior ao primeiro uso do app',
    fileMode: 'yes',
    connectedMode: 'no',
    note: 'O export traz a data de entrada de cada seguidor; a API começa do zero.',
  },
  {
    question: 'Funciona em conta pessoal (não profissional)',
    fileMode: 'yes',
    connectedMode: 'no',
    note: 'A API de insights exige conta Business ou Creator.',
  },
] as const;

/**
 * Requisitos que a conta precisa cumprir para o modo conectado funcionar.
 * A UI usa isto para explicar antes de o usuário tentar conectar e falhar.
 */
export const CONNECTED_MODE_REQUIREMENTS = [
  'A conta precisa ser Profissional (Business ou Creator) — a conversão é gratuita e reversível nas configurações do Instagram.',
  'Demografia e a métrica de follows/unfollows só são liberadas a partir de 100 seguidores.',
  'O acesso é concedido pelo login oficial do Instagram e pode ser revogado a qualquer momento nas configurações da conta.',
] as const;
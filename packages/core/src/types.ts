/**
 * Tipos de domínio do Rastro.
 *
 * Regra: este pacote é puro. Nada aqui conhece arquivo, rede, banco ou React.
 * Entra objeto, sai objeto.
 */

/** Identidade de uma conta. O export só nos dá o @, não o ID numérico. */
export interface Account {
  /** @username, sempre em minúsculas e sem o "@". É a chave de identidade. */
  username: string;
  /** URL do perfil, quando o export fornece. */
  href?: string;
  /**
   * Nome de exibição ("Gabrielle Chaime"), quando o export fornece.
   * Só o export em HTML traz isto, e só em algumas listas. Nunca é identidade:
   * duas pessoas podem ter o mesmo nome, e ele muda sem aviso.
   */
  displayName?: string;
}

/** Uma relação com data de início conhecida (veio do export com timestamp). */
export interface Relationship extends Account {
  /** Momento em que a relação começou, em ms UTC. Exato — vem do export. */
  since: number;
}

/**
 * O Instagram entrega o export em JSON ou em HTML, à escolha do usuário.
 * Suportamos os dois porque o usuário não relê a instrução: ele pede o export
 * do jeito que estiver na frente dele e volta com o arquivo que tem.
 */
export type ExportFormat = 'json' | 'html' | 'mixed';

/** Categorias de listas que sabemos extrair do export. */
export type RelationshipKind =
  | 'followers'
  | 'following'
  | 'pendingRequestsSent'
  | 'recentlyUnfollowed'
  | 'blocked'
  | 'closeFriends'
  | 'restricted';

/**
 * Uma fotografia do estado da rede num instante.
 * É a unidade que persistimos. Todo relatório nasce do diff entre dois destes.
 */
export interface Snapshot {
  id: string;
  /** Quando o usuário importou. Não é quando o Instagram gerou o export. */
  importedAt: number;
  /** Data que o Instagram declara ter gerado o export, se conseguirmos descobrir. */
  exportedAt?: number;
  /**
   * Em que formato o export veio. 'html' tem precisão de minuto e fuso derivado
   * do cabeçalho; 'json' tem epoch exato. A UI usa isto para calibrar o que promete.
   */
  format?: ExportFormat;
  /**
   * Intervalo que o export declara cobrir, quando o usuário limitou o período no
   * pedido. Ausente significa "todo o período" (o pedido correto). Snapshots com
   * janelas diferentes não são comparáveis — ver `SnapshotDiff.reliability`.
   */
  dataWindow?: { from: number; to: number };
  relationships: Record<RelationshipKind, Relationship[]>;
  /** Problemas não-fatais encontrados no parsing. Nunca engolir em silêncio. */
  warnings: ParseWarning[];
}

export interface ParseWarning {
  code:
    | 'UNKNOWN_FILE_SHAPE'
    | 'MISSING_FILE'
    | 'EMPTY_LIST'
    | 'MISSING_TIMESTAMP'
    | 'DUPLICATE_USERNAME'
    /**
     * Entradas descartadas por não ter um @ legível. Sinal de formato novo:
     * é assim que uma lista inteira some sem ninguém perceber.
     */
    | 'ENTRIES_SKIPPED'
    /** Data em texto que nenhum dos idiomas conhecidos conseguiu ler. */
    | 'UNPARSEABLE_DATE'
    /**
     * Export em HTML cujo fuso não pôde ser derivado do cabeçalho.
     * As datas podem estar deslocadas em algumas horas. Ver htmlExport.ts.
     */
    | 'AMBIGUOUS_TIMEZONE'
    /** Formato de export em HTML, menos preciso que o JSON. */
    | 'HTML_EXPORT'
    /**
     * O export cobre só um pedaço do tempo, não a conta inteira. É o problema
     * mais perigoso que sabemos detectar: ver detectDataWindow em htmlExport.ts.
     */
    | 'PARTIAL_EXPORT';
  file?: string;
  detail: string;
}

/** Quão confiante estamos na data de um evento. A UI depende disso. */
export type Precision =
  /** Data exata: veio de um timestamp do próprio export. */
  | 'exact'
  /** Só sabemos que aconteceu entre dois snapshots. */
  | 'window';

export interface FollowEvent {
  username: string;
  href?: string;
  type: 'followed' | 'unfollowed';
  precision: Precision;
  /** Para 'exact', at === windowStart === windowEnd. */
  at: number;
  windowStart: number;
  windowEnd: number;
  /**
   * true quando suspeitamos que este "unfollowed" é na verdade uma troca de @.
   * Ver docs/EXPORT-INSTAGRAM.md.
   */
  suspectedRename?: {
    /** O @ que provavelmente é a mesma pessoa. */
    counterpart: string;
    confidence: 'high' | 'medium';
  };
}

/**
 * Quanto se pode confiar num diff.
 *
 * Existe porque a falha mais destrutiva do produto não é errar um nome: é comparar
 * dois exports que não são comparáveis (um truncado por período, outro completo;
 * ou um a que faltou um arquivo `followers_2`) e despejar na tela uma lista de
 * pessoas que "deixaram de seguir" e não deixaram. Um relatório assim é pior que
 * relatório nenhum, porque o usuário age em cima dele.
 *
 * Quando `level` não é 'ok', a UI mostra o aviso ANTES da lista, e a lista vem
 * recolhida — não é rodapé.
 */
export interface DiffReliability {
  level: 'ok' | 'suspect';
  /** Frases prontas para exibição, em português, explicando o que houve. */
  reasons: string[];
}

/** Resultado da comparação entre dois snapshots. */
export interface SnapshotDiff {
  previousSnapshotId: string;
  currentSnapshotId: string;
  windowStart: number;
  windowEnd: number;
  gained: FollowEvent[];
  lost: FollowEvent[];
  /** Trocas de @ detectadas, já removidas de gained/lost quando confiança é alta. */
  renames: Array<{ from: string; to: string; confidence: 'high' | 'medium' }>;
  netChange: number;
  reliability: DiffReliability;
}

/** Recortes calculados sobre um único snapshot. */
export interface SnapshotInsights {
  followerCount: number;
  followingCount: number;
  /** Segue você e você segue de volta. */
  mutuals: Account[];
  /** Você segue, não te seguem de volta. */
  notFollowingYouBack: Account[];
  /** Te seguem, você não segue de volta. */
  youDontFollowBack: Account[];
  /** Pedidos que você mandou e nunca foram respondidos. */
  pendingRequestsSent: Relationship[];
  /** Quem está com você há mais tempo, do mais antigo para o mais recente. */
  oldestFollowers: Relationship[];
  ratio: number;
}

/** Uma safra: todos que passaram a te seguir no mesmo mês. */
export interface Cohort {
  /** 'YYYY-MM' */
  period: string;
  initialCount: number;
  /** Quantos dessa safra ainda seguem no snapshot mais recente. */
  survivingCount: number;
  retentionRate: number;
}

export interface GrowthPoint {
  at: number;
  followerCount: number;
  gained: number;
  lost: number;
  netChange: number;
  /** Perdidos ÷ base do início do período. */
  churnRate: number;
}

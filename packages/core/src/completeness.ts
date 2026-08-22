/**
 * Vistoria do arquivo antes de ele virar histórico.
 *
 * ## Por que existe
 *
 * O import é irreversível na prática: uma vez salvo, o snapshot vira a base de
 * comparação do próximo, e um arquivo recortado envenena a série inteira. O dano
 * não é "um número errado numa tela" — é o app afirmar, com nome e sobrenome, que
 * centenas de pessoas deixaram de seguir. O usuário age em cima disso.
 *
 * Medido no export real do dono, em 21/08/2026:
 *
 *   export pedido com "Todo o período" .... 1.361 seguidores, o mais antigo de
 *                                           27/11/2014 (o dia em que a conta foi
 *                                           criada)
 *   export pedido com período de 12 meses ....  222 seguidores, o mais antigo de
 *                                           agosto de 2025
 *
 * São 1.139 pessoas que sumiriam da lista sem ter ido a lugar nenhum. É esse
 * arquivo que este módulo existe para barrar.
 *
 * ## O que dá para provar, e o que não dá
 *
 * A vistoria é em camadas, e cada problema carrega a severidade que a evidência
 * banca — nem mais, nem menos:
 *
 *   `block`   há prova no arquivo. O import não acontece.
 *   `confirm` há indício forte, e a resposta está com quem conhece a própria
 *             conta. O app pergunta e obedece.
 *   `warn`    o import serve; algo a menos do que poderia.
 *
 * ## A regra olha `followers`, e só
 *
 * Deixar de seguir gente em massa — o que a fila de faxina existe para
 * organizar — derruba `following` e não toca em `followers`. Verificado no
 * arquivo real: tirar 1.000 dos 1.162 seguidos passa sem um único problema.
 * Se algum dia alguém achar que "as duas listas deviam ser vigiadas", o efeito
 * seria o app punir quem usou a funcionalidade que ele mesmo oferece.
 *
 * A tentação aqui é transformar indício em bloqueio "para o usuário não errar".
 * Não faça: a conta antiga que só engatou seguidores no último ano é
 * indistinguível, pelo arquivo, de um export truncado — e barrá-la é expulsar
 * gente legítima de um app que ela não consegue usar de outro jeito.
 *
 * Este módulo é puro. Ele não sabe o que a tela faz com o resultado.
 */

import type { Snapshot } from './types.js';

export type ExportProblemCode =
  /** Veio em HTML. Menos preciso, e não é o formato que o app pede. */
  | 'FORMAT_HTML'
  /** Sem a lista de seguidores não há snapshot. */
  | 'MISSING_FOLLOWERS'
  /** Sem "seguindo" metade dos relatórios não existe. */
  | 'MISSING_FOLLOWING'
  /** O próprio arquivo declara cobrir só um pedaço do tempo. */
  | 'DECLARED_WINDOW'
  /** A lista é rasa demais para a idade da conta. Indício, não prova. */
  | 'SHALLOW_HISTORY'
  /** Comparado ao arquivo anterior, sumiu gente demais de uma vez. */
  | 'MASS_LOSS'
  /** Primeiro import: só o usuário sabe se a contagem bate. */
  | 'CONFIRM_COUNT'
  /** Sem conversas, comentários nem anunciantes. A aba Atividade fica vazia. */
  | 'NO_ACTIVITY';

export type ExportSeverity = 'block' | 'confirm' | 'warn';

export interface ExportProblem {
  code: ExportProblemCode;
  severity: ExportSeverity;
  /** Uma linha, em português, pronta para virar título na tela. */
  title: string;
  /** O que o app viu no arquivo. Números concretos, nunca adjetivos. */
  detail: string;
  /** O que a pessoa faz a respeito. Ausente quando não há o que fazer. */
  fix?: string;
}

export interface ExportCheckInput {
  snapshot: Snapshot;
  /** O snapshot mais recente já salvo, quando existe. */
  previous?: Snapshot | null;
  /** Quantos arquivos de atividade o zip trouxe (conversas, comentários...). */
  activityFiles?: number;
  now?: number;
}

export interface ExportCheck {
  /** Nenhum `block`. Ainda pode haver `confirm` pendente. */
  ok: boolean;
  /** Há `confirm` a responder. Com `ok` falso, isto é irrelevante. */
  needsConfirmation: boolean;
  /** Do mais grave para o menos, na ordem em que a tela deve mostrar. */
  problems: ExportProblem[];
}

const ANO = 365 * 24 * 3600 * 1000;

/**
 * Perda tolerada entre dois arquivos sem levantar suspeita.
 *
 * 30% é generoso de propósito: uma limpeza de seguidores fantasma feita pelo
 * próprio Instagram derruba alguns por cento, e quem passa meses sem importar
 * acumula saídas legítimas. Quem cruza esta linha quase sempre trocou de tipo
 * de export, não de público.
 */
const PERDA_SUSPEITA = 0.3;

/** Idade mínima da conta para a rasura do histórico querer dizer alguma coisa. */
const CONTA_MADURA = 2 * ANO;

/** Abaixo disto a lista é pequena demais para a distribuição significar algo. */
const AMOSTRA_MINIMA = 50;

/**
 * Fração da vida da conta que a lista precisa cobrir para não levantar suspeita.
 *
 * Conta de 2014 com o seguidor mais antigo em 2025 cobre 8% — é o desenho exato
 * de um export de 12 meses. O corte em 40% deixa passar quem de fato só começou
 * a ter público na segunda metade da vida da conta.
 */
const COBERTURA_MINIMA = 0.4;

const data = (ms: number): string => new Date(ms).toLocaleDateString('pt-BR');

/** O registro mais antigo entre seguidores e seguindo, ou `null` se não houver. */
export function oldestRelationship(snapshot: Snapshot): number | null {
  let mais: number | null = null;
  for (const lista of [snapshot.relationships.followers, snapshot.relationships.following]) {
    for (const r of lista) {
      // `since` zero é "o export não trouxe data", não "1970".
      if (r.since > 0 && (mais === null || r.since < mais)) mais = r.since;
    }
  }
  return mais;
}

const ORDEM: Record<ExportSeverity, number> = { block: 0, confirm: 1, warn: 2 };

/**
 * Vistoria o arquivo recém-lido.
 *
 * Chamada depois do parsing e antes de salvar. Devolve tudo o que encontrou —
 * a tela decide o que mostrar primeiro, mas a ordem já vem útil.
 */
export function checkExport(input: ExportCheckInput): ExportCheck {
  const { snapshot, previous = null, activityFiles = 0, now = Date.now() } = input;
  const problems: ExportProblem[] = [];

  const seguidores = snapshot.relationships.followers.length;
  const seguindo = snapshot.relationships.following.length;

  /* --- Formato ---------------------------------------------------------- */

  if (snapshot.format === 'html' || snapshot.format === 'mixed') {
    problems.push({
      code: 'FORMAT_HTML',
      severity: 'block',
      title: 'Este export veio em HTML',
      detail:
        'No HTML a data de cada pessoa tem precisão de minuto e depende do fuso ' +
        'declarado no arquivo, que o Instagram declara errado. No JSON a data é exata.',
      fix: 'Ao pedir o export, escolha o formato JSON.',
    });
  }

  /* --- Listas essenciais ------------------------------------------------ */

  if (seguidores === 0) {
    problems.push({
      code: 'MISSING_FOLLOWERS',
      severity: 'block',
      title: 'Não há lista de seguidores neste arquivo',
      detail:
        'Sem ela não existe snapshot: é a lista que todo relatório do app compara.',
      fix: 'Ao pedir o export, marque "Seguidores e seguindo".',
    });
  }

  if (seguindo === 0 && seguidores > 0) {
    problems.push({
      code: 'MISSING_FOLLOWING',
      severity: 'block',
      title: 'Não há lista de quem você segue',
      detail:
        'Sem ela o app não consegue dizer quem não te segue de volta nem quem ' +
        'você não segue de volta — que é metade do que ele faz.',
      fix: 'Ao pedir o export, marque "Seguidores e seguindo" inteira.',
    });
  }

  /* --- Período ---------------------------------------------------------- */

  if (snapshot.dataWindow) {
    const meses = Math.max(
      1,
      Math.round((snapshot.dataWindow.to - snapshot.dataWindow.from) / (30 * 24 * 3600 * 1000)),
    );
    problems.push({
      code: 'DECLARED_WINDOW',
      severity: 'block',
      title: 'Este export cobre só um período',
      detail:
        `O próprio arquivo declara cobrir ${meses} meses, de ` +
        `${data(snapshot.dataWindow.from)} a ${data(snapshot.dataWindow.to)}. ` +
        'Quem começou a te seguir antes disso não está na lista, e o app ' +
        'contaria essas pessoas como se tivessem ido embora.',
      fix: 'Peça o export de novo escolhendo "Todo o período".',
    });
  }

  /*
   * Sem declaração de período — o caso do JSON, que não traz essa informação em
   * lugar nenhum — sobra a forma da lista. Conta velha com histórico raso é o
   * desenho de um export recortado, mas é só isso: um desenho.
   */
  const maisAntigo = oldestRelationship(snapshot);
  const nascimento = snapshot.accountCreatedAt;

  /*
   * O arquivo prova a própria profundidade?
   *
   * Verdadeiro quando ele não declara período recortado, sabemos quando a conta
   * nasceu, e as listas alcançam a vida dela. Nesse caso o arquivo demonstrou
   * não ser um recorte — o que muda a leitura de uma queda grande de seguidores,
   * mais abaixo.
   *
   * Falso também quando simplesmente não dá para saber (export sem
   * `signup_details.json`). Ausência de prova não é prova, e nas duas regras que
   * dependem disto o lado seguro é o mesmo: perguntar em vez de presumir.
   */
  const profundidadeProvada =
    !snapshot.dataWindow &&
    maisAntigo !== null &&
    nascimento !== undefined &&
    (now - maisAntigo) / (now - nascimento) >= COBERTURA_MINIMA;

  if (
    !snapshot.dataWindow &&
    maisAntigo !== null &&
    nascimento !== undefined &&
    now - nascimento > CONTA_MADURA &&
    seguidores >= AMOSTRA_MINIMA
  ) {
    const idade = now - nascimento;
    const cobertura = (now - maisAntigo) / idade;
    if (cobertura < COBERTURA_MINIMA) {
      const anos = Math.floor(idade / ANO);
      problems.push({
        code: 'SHALLOW_HISTORY',
        severity: 'confirm',
        title: 'O histórico deste arquivo parece curto demais',
        detail:
          `Sua conta existe há ${anos} anos (desde ${data(nascimento)}), mas a pessoa ` +
          `mais antiga deste arquivo entrou em ${data(maisAntigo)}. É assim que ` +
          'fica um export pedido com período limitado.',
        fix:
          'Se você já tinha seguidores antes dessa data, peça o export de novo ' +
          'escolhendo "Todo o período".',
      });
    }
  }

  /* --- Comparação com o arquivo anterior -------------------------------- */

  if (previous) {
    const antes = previous.relationships.followers.length;
    const perdidos = antes - seguidores;
    if (antes > 0 && perdidos / antes > PERDA_SUSPEITA) {
      const pct = Math.round((perdidos / antes) * 100);
      const quanto =
        `O arquivo anterior listava ${antes} seguidores e este lista ${seguidores} ` +
        `— ${pct}% a menos, ${perdidos} pessoas.`;

      /*
       * Queda grande tem duas explicações, e o arquivo às vezes descarta uma.
       *
       * Se ele prova a própria profundidade — alcança a criação da conta e não
       * declara recorte —, então não é um export truncado, e a queda é ou real
       * (limpeza de contas falsas pelo Instagram, conta que viralizou e
       * esvaziou) ou coisa que só o dono sabe. Bloquear aí seria trancar alguém
       * fora do próprio histórico por um evento que de fato aconteceu.
       *
       * Sem essa prova, continua bloqueio: é a assinatura exata do arquivo
       * recortado, que é a falha mais destrutiva que o produto conhece.
       */
      problems.push(
        profundidadeProvada
          ? {
              code: 'MASS_LOSS',
              severity: 'confirm',
              title: 'Muita gente saiu de uma vez',
              detail:
                `${quanto} Este arquivo parece completo — ele alcança o começo da ` +
                'sua conta —, então provavelmente é queda real e não arquivo ' +
                'recortado. Mas é bastante gente de uma vez só.',
              fix:
                'Se o número no seu perfil do Instagram bate com o daqui, pode ' +
                'guardar. Se não bate, o export veio recortado e vale pedir de novo.',
            }
          : {
              code: 'MASS_LOSS',
              severity: 'block',
              title: 'Este arquivo tem gente de menos',
              detail:
                `${quanto} Uma queda dessas de uma vez quase sempre significa ` +
                'export pedido com período limitado, não gente que saiu.',
              fix:
                'Peça o export de novo com "Todo o período" e formato JSON. Se a ' +
                'queda for real mesmo, o arquivo novo vai passar.',
            },
      );
    }
  } else if (seguidores > 0) {
    /*
     * Primeiro import: não há com o que comparar, e o arquivo pode estar
     * recortado sem que nada nele denuncie. Quem sabe a resposta é o dono da
     * conta — ele abre o Instagram e lê o número. Perguntar é a única
     * verificação honesta que existe aqui, e é mais confiável que qualquer
     * heurística nossa.
     */
    problems.push({
      code: 'CONFIRM_COUNT',
      severity: 'confirm',
      title: 'Confira se o número bate',
      detail:
        `Este arquivo traz ${seguidores} seguidores e ${seguindo} pessoas que você segue.` +
        (maisAntigo !== null ? ` O seguidor mais antigo entrou em ${data(maisAntigo)}.` : ''),
      fix:
        'Abra seu perfil no Instagram e compare. Se lá o número for bem maior, o ' +
        'export veio recortado e vale pedir de novo com "Todo o período".',
    });
  }

  /* --- Categorias ------------------------------------------------------- */

  if (activityFiles === 0) {
    problems.push({
      code: 'NO_ACTIVITY',
      severity: 'warn',
      title: 'Este export não trouxe suas conversas',
      detail:
        'As listas de seguidores estão completas e o import funciona. O que fica ' +
        'de fora é a aba Atividade: conversas sem resposta, pedidos de mensagem e ' +
        'com quem você mais interage.',
      fix: 'Para tê-la, peça o export marcando também "Mensagens".',
    });
  }

  problems.sort((a, b) => ORDEM[a.severity] - ORDEM[b.severity]);

  const bloqueado = problems.some((p) => p.severity === 'block');

  /*
   * Com o arquivo bloqueado, perguntar não faz sentido: não há resposta que o
   * deixe entrar. Medido no export em HTML do dono, a vistoria devolvia dois
   * bloqueios e ainda pedia para conferir a contagem — uma pergunta cuja única
   * resposta útil já estava dada duas linhas acima.
   */
  const finais = bloqueado ? problems.filter((p) => p.severity !== 'confirm') : problems;

  return {
    ok: !bloqueado,
    needsConfirmation: finais.some((p) => p.severity === 'confirm'),
    problems: finais,
  };
}

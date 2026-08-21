/**
 * A fila de faxina: uma lista de contas para o usuário resolver, uma a uma.
 *
 * ## Por que isto existe, e por que não é um botão de "deixar de seguir todos"
 *
 * O pedido original era ação em massa: marcar 300 contas e o app deixar de
 * seguir todas. **Não existe caminho legítimo para isso**, e a recusa não é
 * preciosismo:
 *
 * - A API oficial da Meta não tem endpoint de unfollow. Os escopos liberados
 *   para apps de terceiros são de leitura, e sempre foram.
 * - A única via técnica seria login programático e API privada — regras 1 e 2 do
 *   CLAUDE.md. O Instagram detecta unfollow em lote vindo de fora e **bane a
 *   conta do usuário**, não a nossa. Quem paga é quem instalou.
 * - Automação de conta é remoção certa nas duas lojas (regra 4).
 * - E seria incoerente até o ridículo: o argumento de venda do Rastro é não
 *   pedir a senha do Instagram, e isso exigiria pedir exatamente ela.
 *
 * O que esta fila faz é tirar o **trabalho de procurar**, que é onde a hora
 * inteira se perde. A pessoa marca quem quer resolver, o app guarda a lista e
 * abre um perfil por vez no Instagram. Ela toca no botão lá dentro, volta, e o
 * app já está com o próximo pronto. Nada é executado na conta dela por nós.
 *
 * ## Uma coisa que este módulo não sabe, e não finge saber
 *
 * O app **não tem como verificar** se a pessoa realmente deixou de seguir. Não
 * há retorno do Instagram, e conferir exigiria justamente a API que não podemos
 * usar. Então `feitos` é declaração do usuário, não fato observado — e a tela
 * precisa falar nesses termos ("marquei como resolvido"), nunca afirmar que a
 * ação aconteceu.
 *
 * A fila também não se corrige sozinha: se a pessoa marcar como feito e não
 * fizer, a conta reaparece no próximo import. Isso é o certo — o próximo arquivo
 * é a única fonte de verdade que temos.
 */

import { lerAjuste, salvarAjuste } from './storage';

/**
 * O que o usuário vai fazer com cada conta da fila.
 *
 * O nome descreve a ação **dele**, não uma ação nossa: o app só abre o perfil.
 */
export type AcaoDaFila = 'deixar-de-seguir' | 'seguir' | 'cancelar-pedido';

export interface Fila {
  acao: AcaoDaFila;
  /** Ainda não resolvidos, na ordem em que serão abertos. */
  pendentes: string[];
  /** Marcados como resolvidos pelo usuário. Ver a ressalva no topo. */
  feitos: string[];
  /** Marcados como "deixa quieto". Saem da fila sem virar `feitos`. */
  pulados: string[];
  criadaEm: number;
}

/** Textos de cada ação, num lugar só. A tela não monta frase por conta própria. */
export const TEXTO_DA_ACAO: Record<
  AcaoDaFila,
  {
    /** Verbo no infinitivo, para título e botão de iniciar. */
    titulo: string;
    /** O que fazer dentro do Instagram, em uma frase. */
    comoFazer: string;
    /** Rótulo do botão que confirma. Primeira pessoa: foi o usuário que fez. */
    confirmar: string;
  }
> = {
  'deixar-de-seguir': {
    titulo: 'Deixar de seguir',
    comoFazer: 'No perfil, toque em "Seguindo" e depois em "Deixar de seguir".',
    confirmar: 'Deixei de seguir',
  },
  seguir: {
    titulo: 'Seguir de volta',
    comoFazer: 'No perfil, toque em "Seguir".',
    confirmar: 'Segui',
  },
  'cancelar-pedido': {
    titulo: 'Cancelar solicitação',
    comoFazer: 'No perfil, toque em "Solicitado" para cancelar o pedido.',
    confirmar: 'Cancelei',
  },
};

const CHAVE = 'fila.atual';

/**
 * Uma fila por vez, de propósito.
 *
 * Duas filas abertas ao mesmo tempo — uma de deixar de seguir, outra de seguir —
 * significam a pessoa alternando entre dois trabalhos que se parecem, com o
 * Instagram no meio. Começar uma nova substitui a anterior, e a tela avisa.
 */
export async function lerFila(): Promise<Fila | null> {
  const bruto = await lerAjuste(CHAVE);
  if (!bruto) return null;
  try {
    const d = JSON.parse(bruto) as Partial<Fila>;
    const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    if (!d.acao || !(d.acao in TEXTO_DA_ACAO)) return null;
    return {
      acao: d.acao,
      pendentes: lista(d.pendentes),
      feitos: lista(d.feitos),
      pulados: lista(d.pulados),
      criadaEm: typeof d.criadaEm === 'number' ? d.criadaEm : 0,
    };
  } catch {
    // Fila corrompida não pode impedir a tela de abrir. Perder uma fila custa
    // ao usuário remarcar; travar o app custa o usuário.
    return null;
  }
}

export async function salvarFila(fila: Fila | null): Promise<void> {
  await salvarAjuste(CHAVE, fila ? JSON.stringify(fila) : null);
}

export function criarFila(acao: AcaoDaFila, usernames: string[]): Fila {
  return { acao, pendentes: [...usernames], feitos: [], pulados: [], criadaEm: Date.now() };
}

/** Quantas contas a fila já resolveu, de quantas foram marcadas no início. */
export function progresso(fila: Fila): { feitas: number; total: number } {
  return {
    feitas: fila.feitos.length + fila.pulados.length,
    total: fila.pendentes.length + fila.feitos.length + fila.pulados.length,
  };
}

/** Tira a conta do topo e a coloca em `feitos` ou `pulados`. */
export function resolver(fila: Fila, username: string, como: 'feito' | 'pulado'): Fila {
  const pendentes = fila.pendentes.filter((u) => u !== username);
  return como === 'feito'
    ? { ...fila, pendentes, feitos: [...fila.feitos, username] }
    : { ...fila, pendentes, pulados: [...fila.pulados, username] };
}

/**
 * A ação que faz sentido para cada lista, ou `null` se nenhuma faz.
 *
 * Fora destas três, a fila não aparece. Em "deixaram de seguir" ela seria uma
 * sugestão de revanche, e não é esse o produto; nas listas que a pessoa mesma
 * mantém no Instagram (bloqueados, melhores amigos) não há ação de rede a tomar.
 */
export function acaoDaLista(lista: string): AcaoDaFila | null {
  if (lista === 'nao-seguem-de-volta') return 'deixar-de-seguir';
  if (lista === 'voce-nao-segue') return 'seguir';
  if (lista === 'pendentes') return 'cancelar-pedido';
  return null;
}

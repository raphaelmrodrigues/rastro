/**
 * Persistencia local dos snapshots.
 *
 * Modo privado: os dados moram no diretorio do app, no aparelho, e nao sao
 * enviados a lugar nenhum. Um snapshot por arquivo, mais um indice leve — assim a
 * tela inicial abre sem carregar milhares de @s na memoria.
 *
 * Retencao: guardamos os N snapshots mais recentes. O historico completo e feature
 * do modo com servidor; aqui o objetivo e o aparelho nao virar um arquivo morto de
 * dados sensiveis.
 */

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { ActivityData, Snapshot } from '@rastro/core';

/**
 * A API de arquivos mudou no SDK 54: `documentDirectory` + funções soltas viraram
 * as classes `Directory` e `File`. A antiga ainda existe em
 * `expo-file-system/legacy`, mas importar de lá seria adiar a migração para uma
 * versão em que ela já não exista — e este arquivo tem seis chamadas, não
 * sessenta.
 *
 * Diferença que importa ao ler o código: `exists`, `create`, `write` e `delete`
 * são síncronos agora; só a leitura de conteúdo (`text()`) é assíncrona.
 *
 * Tudo aqui é função, e não constante de módulo, por causa do navegador: no web o
 * expo-file-system é um esboço que lança em `Paths.document`. Um
 * `const ROOT = new Directory(...)` no topo do arquivo roda na importação, antes
 * de qualquer `if (isWeb)` — e derruba o app inteiro numa tela branca, mesmo no
 * caminho que nunca tocaria em disco.
 */
const raiz = () => new Directory(Paths.document, 'rastro');
const arquivoDoIndice = (root: Directory) => new File(root, 'index.json');

/** Quantos snapshots completos ficam no aparelho. */
const MAX_SNAPSHOTS = 12;

/**
 * No navegador o expo-file-system nao existe (nao ha sistema de arquivos), entao
 * o mesmo contrato e atendido por localStorage.
 *
 * O alvo do produto e mobile; o web serve para desenvolver e testar sem precisar
 * passar o zip para o celular. Por isso a limitacao de tamanho do localStorage
 * (~5 MB, o que da uns poucos milhares de seguidores por snapshot) e aceitavel
 * aqui e nao vale a complexidade de IndexedDB.
 */
const isWeb = Platform.OS === 'web';
const webKey = (name: string) => `rastro:${name}`;

const webStore = {
  read(name: string): string | null {
    return globalThis.localStorage?.getItem(webKey(name)) ?? null;
  },
  write(name: string, content: string): void {
    globalThis.localStorage?.setItem(webKey(name), content);
  },
  remove(name: string): void {
    globalThis.localStorage?.removeItem(webKey(name));
  },
  clear(): void {
    const storage = globalThis.localStorage;
    if (!storage) return;
    for (const key of Object.keys(storage)) {
      if (key.startsWith('rastro:')) storage.removeItem(key);
    }
  },
};

/*
 * Ajustes leves — @ do perfil ativo, id do último snapshot enviado, preferência
 * de lembrete. Coisas pequenas, que não são segredo e não valem um arquivo cada.
 *
 * Existe aqui, e não solto em quem precisa, porque `globalThis.localStorage`
 * **não existe no React Native**. Código que grava direto no localStorage compila,
 * roda no navegador e vira silenciosamente um no-op no celular: o valor nunca é
 * gravado, a leitura devolve `null` e nada reclama. Foi exatamente o que estava
 * acontecendo com o perfil ativo e com o controle de envio pendente.
 */
const ARQUIVO_DE_AJUSTES = 'ajustes.json';

/**
 * Evita reler o arquivo a cada consulta. Precisa ser invalidado em
 * `eraseEverything`, senão um valor apagado do disco continuaria respondendo.
 */
let cacheDeAjustes: Record<string, string> | null = null;

async function lerTodosOsAjustes(): Promise<Record<string, string>> {
  if (cacheDeAjustes) return cacheDeAjustes;
  try {
    const arquivo = new File(ensureRoot(), ARQUIVO_DE_AJUSTES);
    const raw = arquivo.exists ? await arquivo.text() : null;
    cacheDeAjustes = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    cacheDeAjustes = {};
  }
  return cacheDeAjustes;
}

/**
 * Lê um ajuste. A chave é usada como está — inclua o prefixo `rastro:` para que
 * `webStore.clear()` alcance a chave no navegador.
 */
export async function lerAjuste(chave: string): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(chave) ?? null;
  return (await lerTodosOsAjustes())[chave] ?? null;
}

/** Grava um ajuste; `null` apaga. */
export async function salvarAjuste(chave: string, valor: string | null): Promise<void> {
  if (isWeb) {
    if (valor === null) globalThis.localStorage?.removeItem(chave);
    else globalThis.localStorage?.setItem(chave, valor);
    return;
  }

  const ajustes = { ...(await lerTodosOsAjustes()) };
  if (valor === null) delete ajustes[chave];
  else ajustes[chave] = valor;

  const arquivo = new File(ensureRoot(), ARQUIVO_DE_AJUSTES);
  if (!arquivo.exists) arquivo.create();
  arquivo.write(JSON.stringify(ajustes));
  cacheDeAjustes = ajustes;
}

/*
 * Resumo do export completo — conversas, comentários, anunciantes, buscas.
 *
 * **Nunca sobe para o servidor, e isso é a regra mais importante deste arquivo.**
 *
 * O snapshot de seguidores sobe porque o histórico entre aparelhos depende
 * disso. Este não: é derivado de conversa privada e do perfil publicitário da
 * pessoa. Hoje um vazamento do nosso banco expõe uma lista de @s; se este objeto
 * subisse, passaria a expor com quem cada usuário conversa e quem ele deixou no
 * vácuo. Nenhuma funcionalidade paga esse risco.
 *
 * Fica em arquivo separado do índice de snapshots também por retenção: some com
 * `eraseEverything`, junto com o resto, sem passo extra que alguém possa
 * esquecer de chamar.
 */
const ARQUIVO_DE_ATIVIDADE = 'atividade.json';

/**
 * Completa o que faltar num `ActivityData` gravado por uma versão anterior.
 *
 * O arquivo no aparelho foi escrito pela versão do app que estava instalada
 * naquele dia, e o app de hoje lê com o tipo de hoje. Um `as ActivityData` cego
 * sobre esse JSON é uma mentira para o compilador que só aparece em produção —
 * e apareceu: `lastMessages` entrou em 20/08/2026, o `atividade.json` de quem já
 * tinha importado não tinha o campo, e a tela de conversas quebrou inteira com
 * "Cannot read property 'length' of undefined".
 *
 * A regra que fica: **todo campo novo aqui precisa de valor padrão nesta
 * função**, porque o arquivo do usuário nunca é reescrito até o próximo import.
 */
function completar(bruto: unknown): ActivityData | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const d = bruto as Partial<ActivityData>;
  const lista = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

  return {
    builtAt: typeof d.builtAt === 'number' ? d.builtAt : 0,
    self: typeof d.self === 'string' ? d.self : null,
    conversations: lista(d.conversations).map((c) => ({
      ...c,
      // O campo que faltava. Sem ele a lista de conversas não abre.
      lastMessages: lista(c.lastMessages),
    })),
    commentedOn: lista(d.commentedOn),
    advertisers: lista(d.advertisers),
    profileSearches: lista(d.profileSearches),
    warnings: lista(d.warnings),
  };
}

export async function readActivity(): Promise<ActivityData | null> {
  try {
    let raw: string | null;
    if (isWeb) {
      raw = webStore.read('atividade');
    } else {
      const arquivo = new File(ensureRoot(), ARQUIVO_DE_ATIVIDADE);
      raw = arquivo.exists ? await arquivo.text() : null;
    }
    return raw ? completar(JSON.parse(raw)) : null;
  } catch {
    // Igual ao índice: dado corrompido não pode impedir o app de abrir.
    return null;
  }
}

export async function saveActivity(atividade: ActivityData): Promise<void> {
  const serializado = JSON.stringify(atividade);
  if (isWeb) {
    webStore.write('atividade', serializado);
    return;
  }
  const arquivo = new File(ensureRoot(), ARQUIVO_DE_ATIVIDADE);
  if (!arquivo.exists) arquivo.create();
  arquivo.write(serializado);
}

export interface SnapshotIndexEntry {
  id: string;
  importedAt: number;
  followerCount: number;
  followingCount: number;
  format?: string;
  hasWarnings: boolean;
}

/** Garante o diretorio e devolve ele; so pode ser chamada fora do web. */
function ensureRoot(): Directory {
  const root = raiz();
  if (!root.exists) root.create({ intermediates: true });
  return root;
}

export async function readIndex(): Promise<SnapshotIndexEntry[]> {
  try {
    let raw: string | null;

    if (isWeb) {
      raw = webStore.read('index');
    } else {
      const arquivo = arquivoDoIndice(ensureRoot());
      raw = arquivo.exists ? await arquivo.text() : null;
    }

    if (!raw) return [];
    const parsed = JSON.parse(raw) as SnapshotIndexEntry[];
    return parsed.sort((a, b) => b.importedAt - a.importedAt);
  } catch {
    // Indice corrompido nao pode impedir o app de abrir; o pior caso e recomecar.
    return [];
  }
}

export async function loadSnapshot(id: string): Promise<Snapshot | null> {
  try {
    if (isWeb) {
      const raw = webStore.read(id);
      return raw ? (JSON.parse(raw) as Snapshot) : null;
    }
    const arquivo = new File(raiz(), `${id}.json`);
    return arquivo.exists ? (JSON.parse(await arquivo.text()) as Snapshot) : null;
  } catch {
    return null;
  }
}

/** Grava o snapshot e atualiza o indice, descartando os mais antigos. */
export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const serialized = JSON.stringify(snapshot);

  // Uma raiz so para a funcao inteira: no web ela nem e construida.
  const root = isWeb ? null : ensureRoot();

  if (root === null) {
    webStore.write(snapshot.id, serialized);
  } else {
    const arquivo = new File(root, `${snapshot.id}.json`);
    // `create` so quando falta: gravar sobre um arquivo existente lança.
    if (!arquivo.exists) arquivo.create();
    arquivo.write(serialized);
  }

  const entry: SnapshotIndexEntry = {
    id: snapshot.id,
    importedAt: snapshot.importedAt,
    followerCount: snapshot.relationships.followers.length,
    followingCount: snapshot.relationships.following.length,
    ...(snapshot.format ? { format: snapshot.format } : {}),
    hasWarnings: snapshot.warnings.length > 0,
  };

  const index = [entry, ...(await readIndex()).filter((e) => e.id !== snapshot.id)].sort(
    (a, b) => b.importedAt - a.importedAt,
  );

  const kept = index.slice(0, MAX_SNAPSHOTS);
  for (const dropped of index.slice(MAX_SNAPSHOTS)) {
    if (root === null) {
      webStore.remove(dropped.id);
    } else {
      const antigo = new File(root, `${dropped.id}.json`);
      // `exists` antes de apagar: a API nova lança se o arquivo não estiver lá,
      // e a antiga tinha `idempotent: true` para exatamente este caso.
      if (antigo.exists) antigo.delete();
    }
  }

  const serializedIndex = JSON.stringify(kept);
  if (root === null) {
    webStore.write('index', serializedIndex);
  } else {
    const indice = arquivoDoIndice(root);
    if (!indice.exists) indice.create();
    indice.write(serializedIndex);
  }
}

/**
 * Apaga tudo. Precisa existir e precisa estar acessivel na interface: o app guarda
 * a rede social inteira de uma pessoa, e ela tem que conseguir tirar isso do
 * aparelho sem desinstalar nada.
 */
export async function eraseEverything(): Promise<void> {
  // O cache de ajustes vive fora do disco; sem limpar aqui, um valor recém
  // apagado continuaria sendo respondido pelo resto da sessão.
  cacheDeAjustes = null;

  if (isWeb) {
    webStore.clear();
    return;
  }
  const root = raiz();
  if (root.exists) root.delete();
}

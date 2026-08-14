/**
 * Configuracao do Metro para monorepo npm workspaces.
 *
 * Sem isto o bundler nao encontra @rastro/core: por padrao o Metro so observa a
 * pasta do proprio app e so procura node_modules a partir dela. Num workspace as
 * dependencias ficam hasteadas na raiz e o core mora fora do diretorio do app.
 *
 * Os dois ajustes:
 *  - watchFolders: a raiz do monorepo, para o Metro enxergar packages/core;
 *  - nodeModulesPaths: procura no app e depois na raiz.
 *
 * Havia um terceiro, `disableHierarchicalLookup = true`, que era a receita de
 * monorepo ate o SDK 51. A partir do 52 o proprio `expo/metro-config` resolve
 * isso, e manter a linha passou a ser o problema em vez da solucao: o
 * `expo-doctor` do SDK 57 aponta o conflito explicitamente. O risco que ela
 * evitava — duas copias de react/react-native, que dao "invalid hooks" sem
 * mensagem util — hoje e coberto pelo dedupe do npm workspaces.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
module.exports = config;

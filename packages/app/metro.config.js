/**
 * Configuracao do Metro para monorepo npm workspaces.
 *
 * Sem isto o bundler nao encontra @rastro/core: por padrao o Metro so observa a
 * pasta do proprio app e so procura node_modules a partir dela. Num workspace as
 * dependencias ficam hasteadas na raiz e o core mora fora do diretorio do app.
 *
 * Os tres ajustes:
 *  - watchFolders: a raiz do monorepo, para o Metro enxergar packages/core;
 *  - nodeModulesPaths: procura no app e depois na raiz;
 *  - disableHierarchicalLookup: evita o Metro subir por conta propria e pegar
 *    uma copia duplicada de react/react-native, o que gera o erro classico de
 *    "dois Reacts" (hooks invalidos) sem mensagem util.
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
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

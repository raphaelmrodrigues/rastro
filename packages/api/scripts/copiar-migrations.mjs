/**
 * Copia para o dist o que não é código.
 *
 * O `tsc` só emite o que ele compila, e migration é dado, não código. Sem este
 * passo o build passa, o container sobe e só então o migrate falha com
 * "ENOENT: migrations" — no deploy, longe da máquina de quem programou.
 *
 * O mesmo vale para o `painel.html`: o `/admin` lê o arquivo do disco ao lado do
 * módulo compilado. Esquecer de copiá-lo dá um 500 no painel em produção, e só lá.
 */

import { copyFile, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));

const origem = join(raiz, 'src', 'db', 'migrations');
const destino = join(raiz, 'dist', 'db', 'migrations');
await mkdir(destino, { recursive: true });
await cp(origem, destino, { recursive: true });
console.log(`migrations copiadas para ${destino}`);

const rotas = join(raiz, 'dist', 'routes');
await mkdir(rotas, { recursive: true });
await copyFile(join(raiz, 'src', 'routes', 'painel.html'), join(rotas, 'painel.html'));
console.log(`painel.html copiado para ${rotas}`);

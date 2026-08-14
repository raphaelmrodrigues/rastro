/**
 * Copia os .sql para o dist.
 *
 * O `tsc` só emite o que ele compila, e migration é dado, não código. Sem este
 * passo o build passa, o container sobe e só então o migrate falha com
 * "ENOENT: migrations" — no deploy, longe da máquina de quem programou.
 */

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const origem = join(raiz, 'src', 'db', 'migrations');
const destino = join(raiz, 'dist', 'db', 'migrations');

await mkdir(destino, { recursive: true });
await cp(origem, destino, { recursive: true });
console.log(`migrations copiadas para ${destino}`);

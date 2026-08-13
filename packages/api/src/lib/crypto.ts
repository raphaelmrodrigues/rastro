/**
 * Senhas e segredos em repouso.
 *
 * ## Por que scrypt e não argon2id
 *
 * A escolha original era argon2id, que é de fato o padrão preferido hoje. O
 * problema prático: as implementações em Node são módulos nativos, exigem
 * toolchain de compilação e quebram build em imagem enxuta e no Windows do dono
 * do projeto. scrypt vem no `node:crypto`, é memory-hard, tem parametrização
 * pública desde 2016 e é aceito pelo OWASP para este uso.
 *
 * Trocar por argon2id depois é uma migração barata: o hash carrega o algoritmo no
 * prefixo, então `verifyPassword` continua validando os hashes antigos enquanto os
 * novos saem no formato novo.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Parâmetros do OWASP para scrypt (N=2^17, r=8, p=1). Custam ~128MB de memória
 * por verificação, o que é o ponto: encarece o ataque em GPU.
 */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'scrypt') return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });

  // Comparação em tempo constante: comparar com === vaza o tamanho do prefixo igual.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// --- Segredos em repouso -----------------------------------------------------

/**
 * Chave de criptografia dos tokens do modo conectado.
 * Em produção é obrigatória: sem ela, um dump do banco vira acesso às contas.
 */
function encryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOKEN_ENCRYPTION_KEY é obrigatório em produção.');
    }
    // Chave fixa de desenvolvimento: previsível de propósito, para deixar claro
    // que não serve para nada além de rodar na máquina de quem programa.
    return Buffer.alloc(32, 7);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64.');
  }
  return key;
}

/** AES-256-GCM. Formato: iv.tag.ciphertext, tudo em base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

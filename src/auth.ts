import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';

const scryptAsync = promisify(scrypt) as (
  pw: string, salt: Buffer, len: number, opts: object,
) => Promise<Buffer>;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  // Sempre gasta o mesmo tempo, exista ou não o usuário (evita enumeração por tempo)
  const parts = (stored ?? '').split('$');
  const salt = Buffer.from(parts[1] ?? 'AAAAAAAAAAAAAAAAAAAAAA==', 'base64');
  const expected = Buffer.from(parts[2] ?? '', 'base64');
  const actual = await scryptAsync(pw, salt, 64, SCRYPT);
  return parts[0] === 'scrypt' && expected.length === actual.length && timingSafeEqual(expected, actual);
}

const secret = new TextEncoder().encode(config.jwtSecret);

export async function signAccessToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + config.accessTtlSec * 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Limitador simples em memória (suficiente para uso local; use Redis em produção). */
const attempts = new Map<string, { n: number; resetAt: number }>();
export function tooManyAttempts(key: string, max = 8, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.resetAt < now) {
    attempts.set(key, { n: 1, resetAt: now + windowMs });
    return false;
  }
  cur.n += 1;
  return cur.n > max;
}
export const clearAttempts = (key: string) => attempts.delete(key);

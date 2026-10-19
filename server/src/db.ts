import pg from 'pg';
import { config } from './config.js';

// date -> string 'YYYY-MM-DD' (evita deslocar fuso); int8 (count) -> number
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

/**
 * Executa `fn` numa transação. Com `userId`, define app.user_id (SET LOCAL),
 * que ativa as políticas de RLS do banco para esse usuário.
 */
export async function tx<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (userId) await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());

/** Converte as chaves snake_case de uma linha do banco para camelCase. */
export function row<T = any>(r: Record<string, unknown> | undefined | null): T {
  if (!r) return r as T;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v])) as T;
}

export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

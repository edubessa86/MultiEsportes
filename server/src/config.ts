function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Variável ${key} ausente. Rode "npm run setup" e confira o .env.`);
  return v;
}

const jwtSecret = need('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres.');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** 127.0.0.1 = só esta máquina. Use 0.0.0.0 para testar pelo celular na mesma rede Wi-Fi. */
  host: process.env.HOST ?? '127.0.0.1',
  databaseUrl: need('DATABASE_URL'),
  jwtSecret,
  isProd: process.env.NODE_ENV === 'production',
  accessTtlSec: 15 * 60,
  refreshTtlDays: 60,
  /** XP concedido por sessão válida (uma vez por sessão). */
  xpPerValidSession: 20,
  /** Limites de payload do syncSession. */
  limits: { metrics: 50, trackPoints: 50_000, motionEvents: 20_000, maxSessionHours: 8 },
} as const;

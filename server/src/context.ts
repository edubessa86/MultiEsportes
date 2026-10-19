import { GraphQLError } from 'graphql';

export type Ctx = { userId: string | null };

export function requireUser(ctx: Ctx): string {
  if (!ctx.userId) {
    throw new GraphQLError('Não autenticado. Envie o header Authorization: Bearer <token>.', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.userId;
}

export const userError = (code: string, message: string, field?: string[]) => ({
  code,
  message,
  field: field ?? null,
});

export const clamp = (n: unknown, min: number, max: number, dflt: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : dflt;
  return Math.min(max, Math.max(min, v));
};

/** O enum Language chega como 'pt-BR' | 'en'. Qualquer outro valor cai em pt-BR. */
export const pickLang = (lang: unknown): 'pt-BR' | 'en' => (lang === 'en' ? 'en' : 'pt-BR');

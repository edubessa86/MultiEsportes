import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { pool, row, tx, isUniqueViolation } from '../db.js';
import {
  clearAttempts, hashPassword, hashRefreshToken, newRefreshToken, signAccessToken,
  tooManyAttempts, verifyPassword,
} from '../auth.js';
import { requireUser, userError, type Ctx } from '../context.js';
import { mapModality, mapUser } from '../mappers.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ageOf(birthdate: string): number | null {
  if (!DATE_RE.test(birthdate)) return null;
  const b = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  const n = new Date();
  let age = n.getUTCFullYear() - b.getUTCFullYear();
  const m = n.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

const authFail = (errors: ReturnType<typeof userError>[]) => ({
  accessToken: null, refreshToken: null, expiresAt: null, viewer: null, userErrors: errors,
});

async function issueTokens(c: PoolClient, userId: string) {
  const { token: accessToken, expiresAt } = await signAccessToken(userId);
  const refresh = newRefreshToken();
  await c.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, refresh.hash, config.refreshTtlDays],
  );
  return { accessToken, refreshToken: refresh.token, expiresAt };
}

async function loadUser(userId: string) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export const accountResolvers = {
  Query: {
    viewer: async (_: unknown, __: unknown, ctx: Ctx) => (ctx.userId ? loadUser(ctx.userId) : null),

    // MVP: só o próprio usuário (perfil de terceiros expõe dados pessoais)
    user: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      return a.id === me ? loadUser(me) : null;
    },

    myConsents: async (_: unknown, __: unknown, ctx: Ctx) => {
      const me = requireUser(ctx);
      return tx(me, async (c) =>
        (
          await c.query(
            `SELECT DISTINCT ON (kind) kind, version, granted, created_at
               FROM consents WHERE user_id = $1 ORDER BY kind, created_at DESC`,
            [me],
          )
        ).rows.map((r) => row(r)),
      );
    },
  },

  User: {
    guardian: () => null,
    teams: () => [],
    organizations: () => [],
    xpTotal: async (p: any) =>
      (await pool.query('SELECT COALESCE(SUM(amount),0)::int AS n FROM xp_entries WHERE user_id = $1', [p.id])).rows[0].n,
    modalities: async (p: any) => {
      const { rows } = await pool.query(
        `SELECT um.* FROM user_modalities um WHERE um.user_id = $1 ORDER BY um.created_at`,
        [p.id],
      );
      return Promise.all(
        rows.map(async (r) => {
          const m = (await pool.query('SELECT * FROM modalities WHERE id = $1', [r.modality_id])).rows[0];
          const pos = r.primary_position_id
            ? (await pool.query('SELECT id, code, label_pt AS name FROM positions WHERE id = $1', [r.primary_position_id])).rows[0]
            : null;
          return {
            modality: mapModality(m, 'pt-BR'),
            primaryPosition: pos,
            dominantSide: r.dominant_side,
            level: r.level,
            isFavorite: r.is_favorite,
          };
        }),
      );
    },
  },

  Mutation: {
    signUp: async (_: unknown, { input }: any) => {
      const errors: ReturnType<typeof userError>[] = [];
      const email = String(input.email ?? '').trim().toLowerCase();
      const fullName = String(input.fullName ?? '').trim();
      const password = String(input.password ?? '');
      const locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(input.locale ?? '') ? input.locale : 'pt-BR';

      if (!EMAIL_RE.test(email) || email.length > 254) errors.push(userError('INVALID_EMAIL', 'E-mail inválido.', ['email']));
      if (password.length < 8 || password.length > 200)
        errors.push(userError('WEAK_PASSWORD', 'A senha precisa ter entre 8 e 200 caracteres.', ['password']));
      if (fullName.length < 2 || fullName.length > 120)
        errors.push(userError('INVALID_NAME', 'Informe seu nome completo.', ['fullName']));

      let birthdate: string | null = null;
      if (input.birthdate) {
        const age = ageOf(String(input.birthdate));
        if (age === null) errors.push(userError('INVALID_BIRTHDATE', 'Data de nascimento inválida.', ['birthdate']));
        else if (age < 18)
          // LGPD art. 14: menores exigem consentimento do responsável (fluxo ainda não implementado)
          errors.push(userError('GUARDIAN_FLOW_NOT_IMPLEMENTED', 'Cadastro de menores de 18 anos ainda não está disponível.', ['birthdate']));
        else birthdate = String(input.birthdate);
      }
      if (errors.length) return authFail(errors);

      const hash = await hashPassword(password);
      try {
        return await tx(null, async (c) => {
          const u = (
            await c.query(
              'INSERT INTO users (email, full_name, birthdate, locale) VALUES ($1,$2,$3,$4) RETURNING *',
              [email, fullName, birthdate, locale],
            )
          ).rows[0];
          await c.query(
            `INSERT INTO auth_identities (user_id, provider, provider_uid, password_hash) VALUES ($1,'password',$2,$3)`,
            [u.id, email, hash],
          );
          const tokens = await issueTokens(c, u.id);
          return { ...tokens, viewer: mapUser(u), userErrors: [] };
        });
      } catch (e) {
        if (isUniqueViolation(e)) return authFail([userError('EMAIL_TAKEN', 'Este e-mail já está cadastrado.', ['email'])]);
        throw e;
      }
    },

    signIn: async (_: unknown, { input }: any) => {
      const email = String(input.email ?? '').trim().toLowerCase();
      const key = `signin:${email}`;
      if (tooManyAttempts(key)) return authFail([userError('TOO_MANY_ATTEMPTS', 'Muitas tentativas. Aguarde alguns minutos.')]);

      const found = (
        await pool.query(
          `SELECT ai.user_id, ai.password_hash, u.deleted_at
             FROM auth_identities ai JOIN users u ON u.id = ai.user_id
            WHERE ai.provider = 'password' AND ai.provider_uid = $1`,
          [email],
        )
      ).rows[0];
      const ok = await verifyPassword(String(input.password ?? ''), found?.password_hash);
      if (!ok || !found || found.deleted_at) return authFail([userError('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.')]);

      clearAttempts(key);
      const tokens = await tx(null, (c) => issueTokens(c, found.user_id));
      return { ...tokens, viewer: await loadUser(found.user_id), userErrors: [] };
    },

    // Refresh token rotativo: cada token só vale uma vez. Reuso => revoga todos (sinal de roubo).
    refreshSession: async (_: unknown, { refreshToken }: any) =>
      tx(null, async (c) => {
        const t = (
          await c.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [hashRefreshToken(String(refreshToken ?? ''))])
        ).rows[0];
        if (!t) return authFail([userError('INVALID_REFRESH_TOKEN', 'Sessão inválida. Entre novamente.')]);
        if (t.revoked_at) {
          await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [t.user_id]);
          return authFail([userError('INVALID_REFRESH_TOKEN', 'Sessão inválida. Entre novamente.')]);
        }
        if (new Date(t.expires_at) < new Date()) return authFail([userError('INVALID_REFRESH_TOKEN', 'Sessão expirada. Entre novamente.')]);
        await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [t.id]);
        const tokens = await issueTokens(c, t.user_id);
        const u = (await c.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [t.user_id])).rows[0];
        if (!u) return authFail([userError('INVALID_REFRESH_TOKEN', 'Conta indisponível.')]);
        return { ...tokens, viewer: mapUser(u), userErrors: [] };
      }),

    signOut: async (_: unknown, { refreshToken }: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL',
        [me, hashRefreshToken(String(refreshToken ?? ''))],
      );
      return { success: true, userErrors: [] };
    },

    updateProfile: async (_: unknown, { input }: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      const errors: ReturnType<typeof userError>[] = [];
      const loc = input.location ?? {};
      if (input.fullName != null && (input.fullName.trim().length < 2 || input.fullName.length > 120))
        errors.push(userError('INVALID_NAME', 'Nome inválido.', ['fullName']));
      if (input.displayName != null && input.displayName.length > 40)
        errors.push(userError('INVALID_NAME', 'Apelido muito longo (máx. 40).', ['displayName']));
      if (input.pictureUrl != null && !/^https:\/\//.test(input.pictureUrl))
        errors.push(userError('INVALID_URL', 'A foto precisa ser uma URL https.', ['pictureUrl']));
      if (loc.countryCode != null && !/^[A-Z]{2}$/.test(loc.countryCode))
        errors.push(userError('INVALID_COUNTRY', 'Use o código do país com 2 letras (ex.: BR).', ['location', 'countryCode']));
      if (input.birthdate != null) {
        const age = ageOf(String(input.birthdate));
        if (age === null || age < 18) errors.push(userError('INVALID_BIRTHDATE', 'Data de nascimento inválida ou menor de 18 anos.', ['birthdate']));
      }
      if (errors.length) return { user: null, userErrors: errors };

      const u = await tx(me, async (c) =>
        (
          await c.query(
            `UPDATE users SET
               full_name       = COALESCE($2, full_name),
               display_name    = COALESCE($3, display_name),
               birthdate       = COALESCE($4::date, birthdate),
               picture_url     = COALESCE($5, picture_url),
               locale          = COALESCE($6, locale),
               location_cc     = COALESCE($7, location_cc),
               location_admin1 = COALESCE($8, location_admin1),
               location_admin2 = COALESCE($9, location_admin2)
             WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
            [
              me, input.fullName?.trim() ?? null, input.displayName?.trim() ?? null, input.birthdate ?? null,
              input.pictureUrl ?? null, input.locale ?? null, loc.countryCode ?? null, loc.admin1 ?? null, loc.admin2 ?? null,
            ],
          )
        ).rows[0],
      );
      return { user: u ? mapUser(u) : null, userErrors: [] };
    },

    upsertUserModality: async (_: unknown, { input }: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      try {
        await tx(me, async (c) => {
          const m = (await c.query('SELECT id FROM modalities WHERE id = $1 AND is_active', [input.modalityId])).rows[0];
          if (!m) throw Object.assign(new Error('modality'), { code: 'NO_MODALITY' });
          if (input.primaryPositionId != null) {
            const ok = (await c.query('SELECT 1 FROM positions WHERE id = $1 AND modality_id = $2', [input.primaryPositionId, input.modalityId])).rowCount;
            if (!ok) throw Object.assign(new Error('position'), { code: 'NO_POSITION' });
          }
          await c.query(
            `INSERT INTO user_modalities (user_id, modality_id, primary_position_id, dominant_side, level, is_favorite)
             VALUES ($1,$2,$3,$4,$5,COALESCE($6,false))
             ON CONFLICT (user_id, modality_id) DO UPDATE SET
               primary_position_id = COALESCE(EXCLUDED.primary_position_id, user_modalities.primary_position_id),
               dominant_side = COALESCE(EXCLUDED.dominant_side, user_modalities.dominant_side),
               level = COALESCE(EXCLUDED.level, user_modalities.level),
               is_favorite = COALESCE($6, user_modalities.is_favorite)`,
            [me, input.modalityId, input.primaryPositionId ?? null, input.dominantSide ?? null, input.level ?? null, input.isFavorite ?? null],
          );
        });
      } catch (e: any) {
        if (e.code === 'NO_MODALITY') return { user: null, userErrors: [userError('UNKNOWN_MODALITY', 'Modalidade inexistente.', ['modalityId'])] };
        if (e.code === 'NO_POSITION') return { user: null, userErrors: [userError('INVALID_POSITION', 'Posição não pertence a esta modalidade.', ['primaryPositionId'])] };
        if (e.code === '23514') return { user: null, userErrors: [userError('INVALID_VALUE', 'Valor inválido para lado dominante ou nível.')] };
        throw e;
      }
      return { user: await loadUser(me), userErrors: [] };
    },

    removeUserModality: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      await tx(me, (c) => c.query('DELETE FROM user_modalities WHERE user_id = $1 AND modality_id = $2', [me, a.modalityId]));
      return { user: await loadUser(me), userErrors: [] };
    },

    recordConsent: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      await tx(me, (c) =>
        c.query('INSERT INTO consents (user_id, kind, version, granted) VALUES ($1,$2,$3,$4)', [me, a.kind, String(a.version).slice(0, 40), !!a.granted]),
      );
      return { success: true, userErrors: [] };
    },
  },
};

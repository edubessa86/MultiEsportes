import { row } from './db.js';
import { pickLang } from './context.js';

type Lang = 'pt-BR' | 'en';
const label = (r: any, base: string, lang: Lang) =>
  lang === 'en'
    ? r[`${base}_en`] ?? r[`${base}_pt`] ?? r[base]
    : r[`${base}_pt`] ?? r[base] ?? r[`${base}_en`];

export function mapSport(r: any, lang: unknown) {
  const l = pickLang(lang);
  return { id: r.id, slug: r.slug, name: label(r, 'name', l), icon: r.icon, _lang: l };
}

export function mapModality(r: any, lang: unknown) {
  const l = pickLang(lang);
  return { ...row(r), name: label(r, 'name', l), _lang: l };
}

export function mapUser(r: any) {
  return {
    ...row(r),
    isPremium: !!r.premium_until && new Date(r.premium_until) > new Date(),
    location: {
      countryCode: r.location_cc?.trim() ?? null,
      admin1: r.location_admin1 ?? null,
      admin2: r.location_admin2 ?? null,
    },
  };
}

/** Só o que pode aparecer para outros atletas (ranking). */
export function mapPublicUser(r: any) {
  return {
    id: r.user_id ?? r.id,
    displayName: r.display_name ?? String(r.full_name ?? 'Atleta').split(' ')[0],
    pictureUrl: r.picture_url ?? null,
    location: {
      countryCode: r.location_cc?.trim() ?? null,
      admin1: r.location_admin1 ?? null,
      admin2: r.location_admin2 ?? null,
    },
  };
}

export function mapSession(r: any) {
  const { durationS, ...rest } = row<any>(r);
  return { ...rest, durationSeconds: durationS ?? null };
}

export const encodeCursor = (parts: unknown[]) => Buffer.from(JSON.stringify(parts)).toString('base64url');
export function decodeCursor(c: string): unknown[] | null {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

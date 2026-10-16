import { pool, row } from '../db.js';
import { mapModality, mapSport } from '../mappers.js';
import { pickLang } from '../context.js';

export const catalogResolvers = {
  Query: {
    sports: async (_: unknown, a: any) =>
      (await pool.query('SELECT * FROM sports ORDER BY sort_order')).rows.map((r) => mapSport(r, a.lang)),

    modalities: async (_: unknown, a: any) => {
      const { rows } = await pool.query(
        `SELECT m.* FROM modalities m JOIN sports s ON s.id = m.sport_id
          WHERE m.is_active AND ($1::text IS NULL OR s.slug = $1) ORDER BY m.sort_order`,
        [a.sportSlug ?? null],
      );
      return rows.map((r) => mapModality(r, a.lang));
    },

    modality: async (_: unknown, a: any) => {
      const { rows } = await pool.query('SELECT * FROM modalities WHERE slug = $1 AND is_active', [a.slug]);
      return rows[0] ? mapModality(rows[0], a.lang) : null;
    },

    seasons: async (_: unknown, a: any) =>
      (
        await pool.query(
          `SELECT id, name, starts_on, ends_on FROM seasons
            WHERE organization_id IS NOT DISTINCT FROM $1::uuid ORDER BY starts_on DESC`,
          [a.organizationId ?? null],
        )
      ).rows.map((r) => row(r)),
  },

  Sport: {
    modalities: async (p: any) =>
      (await pool.query('SELECT * FROM modalities WHERE sport_id = $1 AND is_active ORDER BY sort_order', [p.id])).rows.map(
        (r) => mapModality(r, p._lang),
      ),
  },

  Modality: {
    sport: async (p: any) => {
      const { rows } = await pool.query('SELECT * FROM sports WHERE id = $1', [p.sportId]);
      return mapSport(rows[0], p._lang);
    },

    positions: async (p: any) => {
      const l = pickLang(p._lang);
      const { rows } = await pool.query('SELECT id, code, label_pt, label_en FROM positions WHERE modality_id = $1 ORDER BY sort_order', [p.id]);
      return rows.map((r) => ({ id: r.id, code: r.code, name: l === 'en' ? r.label_en : r.label_pt }));
    },

    eventTypes: async (p: any) => {
      const l = pickLang(p._lang);
      const { rows } = await pool.query(
        `SELECT et.id, et.code, et.label_pt, et.label_en, et.category, et.credits_opponent,
                COALESCE(met.points, et.default_points) AS points
           FROM modality_event_types met JOIN event_types et ON et.id = met.event_type_id
          WHERE met.modality_id = $1 ORDER BY et.category, et.code`,
        [p.id],
      );
      return rows.map((r) => ({
        points: r.points,
        eventType: {
          id: r.id, code: r.code, name: l === 'en' ? r.label_en : r.label_pt,
          category: r.category, creditsOpponent: r.credits_opponent,
        },
      }));
    },

    metrics: async (p: any) => {
      const l = pickLang(p._lang);
      const { rows } = await pool.query(
        `SELECT md.id, md.code, md.label_pt, md.label_en, md.unit, md.source,
                mm.is_primary, mm.weight, mm.reference_value
           FROM modality_metrics mm JOIN metric_definitions md ON md.id = mm.metric_id
          WHERE mm.modality_id = $1 ORDER BY mm.is_primary DESC, mm.weight DESC, md.code`,
        [p.id],
      );
      return rows.map((r) => ({
        isPrimary: r.is_primary, weight: r.weight, referenceValue: r.reference_value,
        metric: { id: r.id, code: r.code, name: l === 'en' ? r.label_en : r.label_pt, unit: r.unit, source: r.source },
      }));
    },
  },
};

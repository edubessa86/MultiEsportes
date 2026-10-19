import { pool } from '../db.js';
import { clamp, requireUser, type Ctx } from '../context.js';
import { mapPublicUser } from '../mappers.js';

const USER_COLS = 'u.display_name, u.full_name, u.picture_url, u.location_cc, u.location_admin1, u.location_admin2';

export const rankingResolvers = {
  Query: {
    performanceRanking: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      const first = clamp(a.first, 1, 100, 50);
      const offset = clamp(a.offset, 0, 100_000, 0);
      const loc = a.location ?? {};
      const sql = (limit: number, off: number, onlyMe: boolean) => ({
        text: `SELECT r.rank_pos, r.user_id, r.total_score, r.sessions_counted, ${USER_COLS}
                 FROM fn_ranking_performance($1::smallint, $2::int, $3::char(2), $4::text, $5::text, $6::int, $7::int) r
                 JOIN users u ON u.id = r.user_id
                ${onlyMe ? 'WHERE r.user_id = $8' : ''}
                ORDER BY r.rank_pos, r.user_id`,
        values: [a.modalityId, a.seasonId, loc.countryCode ?? null, loc.admin1 ?? null, loc.admin2 ?? null, limit, off, ...(onlyMe ? [me] : [])],
      });
      const toEntry = (r: any) => ({
        position: Number(r.rank_pos), user: mapPublicUser(r), totalScore: r.total_score, sessionsCounted: r.sessions_counted,
      });
      const [page, mine] = await Promise.all([pool.query(sql(first, offset, false)), pool.query(sql(1_000_000, 0, true))]);
      return { entries: page.rows.map(toEntry), viewerEntry: mine.rows[0] ? toEntry(mine.rows[0]) : null };
    },

    xpRanking: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      const first = clamp(a.first, 1, 100, 50);
      const offset = clamp(a.offset, 0, 100_000, 0);
      const sql = (limit: number, off: number, onlyMe: boolean) => ({
        text: `SELECT r.rank_pos, r.user_id, r.total_xp, ${USER_COLS}
                 FROM fn_ranking_xp($1::int, $2::smallint, $3::int, $4::int) r
                 JOIN users u ON u.id = r.user_id
                ${onlyMe ? 'WHERE r.user_id = $5' : ''}
                ORDER BY r.rank_pos, r.user_id`,
        values: [a.seasonId ?? null, a.modalityId ?? null, limit, off, ...(onlyMe ? [me] : [])],
      });
      const toEntry = (r: any) => ({ position: Number(r.rank_pos), user: mapPublicUser(r), totalXp: Number(r.total_xp) });
      const [page, mine] = await Promise.all([pool.query(sql(first, offset, false)), pool.query(sql(1_000_000, 0, true))]);
      return { entries: page.rows.map(toEntry), viewerEntry: mine.rows[0] ? toEntry(mine.rows[0]) : null };
    },
  },
};

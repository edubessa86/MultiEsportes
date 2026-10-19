import { GraphQLError } from 'graphql';
import { config } from '../config.js';
import { pool, row, tx, isUniqueViolation } from '../db.js';
import { clamp, requireUser, userError, type Ctx } from '../context.js';
import { decodeCursor, encodeCursor, mapSession, mapUser } from '../mappers.js';
import { mapModality } from '../mappers.js';

const UE = userError;
type UErr = ReturnType<typeof userError>;

const syncFail = (errors: UErr[]) => ({ session: null, alreadySynced: false, xpEarned: 0, userErrors: errors });

async function xpOfSession(c: { query: Function }, userId: string, sessionId: string): Promise<number> {
  const r = await c.query(
    `SELECT COALESCE(SUM(amount),0)::int AS n FROM xp_entries WHERE user_id = $1 AND source_kind = 'session' AND source_ref = $2`,
    [userId, sessionId],
  );
  return r.rows[0].n;
}

/** Valida o formato do payload antes de tocar no banco. */
function validateSyncInput(i: any): UErr[] {
  const errs: UErr[] = [];
  const L = config.limits;
  const start = new Date(i.startedAt).getTime();
  const end = new Date(i.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errs.push(UE('INVALID_TIME_RANGE', 'O fim da sessão precisa ser depois do início.', ['endedAt']));
  } else {
    if ((end - start) / 3_600_000 > L.maxSessionHours) errs.push(UE('SESSION_TOO_LONG', `Sessões acima de ${L.maxSessionHours}h não são aceitas.`, ['endedAt']));
    if (start > Date.now() + 5 * 60_000 || end > Date.now() + 5 * 60_000) errs.push(UE('FUTURE_SESSION', 'A sessão não pode estar no futuro.', ['startedAt']));
  }
  if ((i.metrics?.length ?? 0) > L.metrics) errs.push(UE('TOO_MANY_METRICS', `Máximo de ${L.metrics} métricas.`, ['metrics']));
  if ((i.trackPoints?.length ?? 0) > L.trackPoints) errs.push(UE('TOO_MANY_TRACK_POINTS', `Máximo de ${L.trackPoints} pontos de GPS.`, ['trackPoints']));
  if ((i.motionEvents?.length ?? 0) > L.motionEvents) errs.push(UE('TOO_MANY_MOTION_EVENTS', `Máximo de ${L.motionEvents} eventos de movimento.`, ['motionEvents']));
  if (i.rpe != null && (i.rpe < 1 || i.rpe > 10)) errs.push(UE('INVALID_RPE', 'RPE deve estar entre 1 e 10.', ['rpe']));
  if (i.feeling != null && (i.feeling < 1 || i.feeling > 5)) errs.push(UE('INVALID_FEELING', 'Sensação deve estar entre 1 e 5.', ['feeling']));
  for (const f of ['pointsFor', 'pointsAgainst'] as const)
    if (i[f] != null && (i[f] < 0 || i[f] > 999)) errs.push(UE('INVALID_SCORE', 'Placar inválido.', [f]));

  const codes: string[] = (i.metrics ?? []).map((m: any) => m.metricCode);
  if (new Set(codes).size !== codes.length) errs.push(UE('DUPLICATE_METRIC', 'Métrica repetida no envio.', ['metrics']));
  for (const m of i.metrics ?? [])
    if (!Number.isFinite(Number(m.value))) errs.push(UE('INVALID_METRIC_VALUE', `Valor inválido para ${m.metricCode}.`, ['metrics']));

  const seqs = new Set<number>();
  for (const p of i.trackPoints ?? []) {
    if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) { errs.push(UE('INVALID_TRACK_POINT', 'Coordenada fora do intervalo válido.', ['trackPoints'])); break; }
    if (seqs.has(p.seq)) { errs.push(UE('DUPLICATE_TRACK_POINT', 'Ponto de GPS repetido (seq).', ['trackPoints'])); break; }
    seqs.add(p.seq);
  }
  return errs;
}

export const sessionResolvers = {
  Query: {
    session: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      const r = await tx(me, async (c) => (await c.query('SELECT * FROM sessions WHERE id = $1', [a.id])).rows[0]);
      return r ? mapSession(r) : null; // RLS: sessão de outro usuário => null
    },

    mySessions: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      const first = clamp(a.first, 1, 50, 20);
      const conds = ['user_id = $1'];
      const params: unknown[] = [me];
      const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
      if (a.modalityId != null) add('modality_id = ?', a.modalityId);
      if (a.status) add('status = ?::session_status', a.status);
      if (a.from) add('started_at >= ?::timestamptz', a.from);
      if (a.to) add('started_at < ?::timestamptz', a.to);

      return tx(me, async (c) => {
        const total = (await c.query(`SELECT count(*)::int AS n FROM sessions WHERE ${conds.join(' AND ')}`, params)).rows[0].n;
        if (a.after) {
          const cur = decodeCursor(a.after);
          if (!cur || cur.length !== 2) throw new GraphQLError('Cursor inválido.', { extensions: { code: 'BAD_CURSOR' } });
          params.push(cur[0], cur[1]);
          conds.push(`(started_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
        }
        params.push(first + 1);
        const { rows } = await c.query(
          `SELECT *, to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
             FROM sessions WHERE ${conds.join(' AND ')}
            ORDER BY started_at DESC, id DESC LIMIT $${params.length}`,
          params,
        );
        const edges = rows.slice(0, first).map((r) => ({ cursor: encodeCursor([r.cursor_ts, r.id]), node: mapSession(r) }));
        return {
          edges,
          totalCount: total,
          pageInfo: { hasNextPage: rows.length > first, endCursor: edges.at(-1)?.cursor ?? null },
        };
      });
    },

    athleteStatistics: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      if (a.userId && a.userId !== me) throw new GraphQLError('Sem permissão para ver estatísticas de outro usuário.', { extensions: { code: 'FORBIDDEN' } });
      return tx(me, async (c) => {
        const mod = (await c.query('SELECT * FROM modalities WHERE id = $1', [a.modalityId])).rows[0];
        if (!mod) throw new GraphQLError('Modalidade inexistente.', { extensions: { code: 'NOT_FOUND' } });
        const user = (await c.query('SELECT * FROM users WHERE id = $1', [me])).rows[0];

        const season = a.seasonId
          ? (await c.query('SELECT starts_on, ends_on FROM seasons WHERE id = $1', [a.seasonId])).rows[0]
          : null;
        if (a.seasonId && !season) throw new GraphQLError('Temporada inexistente.', { extensions: { code: 'NOT_FOUND' } });
        const from = season?.starts_on ?? null;
        const to = season ? `${season.ends_on}` : null;
        const base = [me, a.modalityId, from, to];
        const period = `AND ($3::date IS NULL OR started_at >= $3::date) AND ($4::date IS NULL OR started_at < $4::date + 1)`;

        const totals = (
          await c.query(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE status = 'valid')::int AS valid,
                    avg(score) FILTER (WHERE status = 'valid') AS avg_score
               FROM sessions WHERE user_id = $1 AND modality_id = $2 ${period}`,
            base,
          )
        ).rows[0];

        const metrics = (
          await c.query(
            `SELECT md.id, md.code, md.label_pt, md.unit, md.source,
                    avg(sm.value) AS average, max(sm.value) AS best, count(*)::int AS n
               FROM sessions s
               JOIN session_metrics sm ON sm.session_id = s.id
               JOIN metric_definitions md ON md.id = sm.metric_id
              WHERE s.user_id = $1 AND s.modality_id = $2 AND s.status = 'valid' ${period}
              GROUP BY md.id ORDER BY md.code`,
            base,
          )
        ).rows;

        const played = (
          await c.query(
            `SELECT count(DISTINCT l.match_id)::int AS n FROM match_lineups l JOIN matches m ON m.id = l.match_id
              WHERE l.user_id = $1 AND m.modality_id = $2 AND m.status = 'finished'`,
            [me, a.modalityId],
          )
        ).rows[0].n;

        const events = (
          await c.query(
            `SELECT et.id, et.code, et.label_pt, et.category, et.credits_opponent, v.occurrences, v.points
               FROM v_athlete_event_totals v
               JOIN modalities m ON m.id = v.modality_id
               JOIN event_types et ON et.sport_id = m.sport_id AND et.code = v.event_code
              WHERE v.user_id = $1 AND v.modality_id = $2 ORDER BY et.code`,
            [me, a.modalityId],
          )
        ).rows;

        return {
          user: mapUser(user),
          modality: mapModality(mod, 'pt-BR'),
          sessionsCount: totals.total,
          validSessionsCount: totals.valid,
          matchesPlayed: played,
          averageScore: totals.avg_score === null ? null : Number(totals.avg_score).toFixed(2),
          metrics: metrics.map((m) => ({
            metric: { id: m.id, code: m.code, name: m.label_pt, unit: m.unit, source: m.source },
            average: Number(m.average).toFixed(2),
            best: m.best,
            sessionsCount: m.n,
          })),
          eventTotals: events.map((e) => ({
            eventType: { id: e.id, code: e.code, name: e.label_pt, category: e.category, creditsOpponent: e.credits_opponent },
            occurrences: e.occurrences,
            points: e.points,
          })),
        };
      });
    },
  },

  Session: {
    user: async (p: any) => mapUser((await pool.query('SELECT * FROM users WHERE id = $1', [p.userId])).rows[0]),
    modality: async (p: any) => mapModality((await pool.query('SELECT * FROM modalities WHERE id = $1', [p.modalityId])).rows[0], 'pt-BR'),
    teamActivity: () => null,
    match: () => null,
    venue: () => null,

    metrics: async (p: any, _: unknown, ctx: Ctx) =>
      tx(requireUser(ctx), async (c) =>
        (
          await c.query(
            `SELECT md.id, md.code, md.label_pt, md.unit, md.source, sm.value
               FROM session_metrics sm JOIN metric_definitions md ON md.id = sm.metric_id
              WHERE sm.session_id = $1 ORDER BY md.code`,
            [p.id],
          )
        ).rows.map((r) => ({ value: r.value, metric: { id: r.id, code: r.code, name: r.label_pt, unit: r.unit, source: r.source } })),
      ),

    motionEvents: async (p: any, a: any, ctx: Ctx) =>
      tx(requireUser(ctx), async (c) =>
        (
          await c.query(
            `SELECT kind, occurred_at, value, duration_ms FROM session_motion_events
              WHERE session_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY occurred_at LIMIT 5000`,
            [p.id, a.kind ?? null],
          )
        ).rows.map((r) => row(r)),
      ),

    trackPoints: async (p: any, a: any, ctx: Ctx) =>
      tx(requireUser(ctx), async (c) =>
        (
          await c.query(
            `SELECT seq, recorded_at, lat, lng, accuracy_m, speed_ms FROM session_track_points
              WHERE session_id = $1 AND seq >= $2 ORDER BY seq LIMIT $3`,
            [p.id, Math.max(0, a.after ?? 0), clamp(a.first, 1, 5000, 1000)],
          )
        ).rows.map((r) => row(r)),
      ),

    disputes: async (p: any, _: unknown, ctx: Ctx) =>
      tx(requireUser(ctx), async (c) =>
        (await c.query('SELECT id, message, status, created_at FROM session_disputes WHERE session_id = $1 ORDER BY created_at', [p.id])).rows.map((r) => row(r)),
      ),

    xpEarned: async (p: any) => xpOfSession(pool, p.userId, p.id),
  },

  Mutation: {
    /** Idempotente: o mesmo clientSessionId nunca duplica (app offline pode reenviar à vontade). */
    syncSession: async (_: unknown, { input: i }: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      const errs = validateSyncInput(i);
      if (errs.length) return syncFail(errs);

      const existing = async () =>
        tx(me, async (c) => {
          const r = (await c.query('SELECT * FROM sessions WHERE user_id = $1 AND client_session_id = $2', [me, i.clientSessionId])).rows[0];
          return r ? { session: mapSession(r), alreadySynced: true, xpEarned: await xpOfSession(c, me, r.id), userErrors: [] } : null;
        });

      const prior = await existing();
      if (prior) return prior;

      let result: any;
      try {
        result = await tx(me, async (c) => {
          const mod = (await c.query('SELECT id FROM modalities WHERE id = $1 AND is_active', [i.modalityId])).rows[0];
          if (!mod) return syncFail([UE('UNKNOWN_MODALITY', 'Modalidade inexistente.', ['modalityId'])]);

          // métricas precisam existir E pertencer à modalidade
          const codes: string[] = (i.metrics ?? []).map((m: any) => m.metricCode);
          const defs = (
            await c.query(
              `SELECT md.id, md.code FROM metric_definitions md
                 JOIN modality_metrics mm ON mm.metric_id = md.id AND mm.modality_id = $1
                WHERE md.code = ANY($2::text[])`,
              [i.modalityId, codes],
            )
          ).rows;
          const idOf = new Map<string, number>(defs.map((d) => [d.code, d.id]));
          const bad = codes.filter((code) => !idOf.has(code));
          if (bad.length)
            return syncFail([UE('UNKNOWN_METRIC', `Métrica(s) inexistente(s) ou não usada(s) nesta modalidade: ${bad.join(', ')}.`, ['metrics'])]);

          const s = (
            await c.query(
              `INSERT INTO sessions (user_id, modality_id, client_session_id, started_at, ended_at, source, device_kind,
                                     rpe, feeling, outcome, points_for, points_against, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'processing') RETURNING id, modality_id, started_at`,
              [me, i.modalityId, i.clientSessionId, i.startedAt, i.endedAt, i.source, i.deviceKind ?? null,
               i.rpe ?? null, i.feeling ?? null, i.outcome ?? null, i.pointsFor ?? null, i.pointsAgainst ?? null],
            )
          ).rows[0];

          if (codes.length)
            await c.query(
              'INSERT INTO session_metrics (session_id, metric_id, value) SELECT $1, * FROM unnest($2::smallint[], $3::numeric[])',
              [s.id, codes.map((x) => idOf.get(x)), (i.metrics as any[]).map((m) => String(m.value))],
            );

          const tp: any[] = i.trackPoints ?? [];
          if (tp.length)
            await c.query(
              `INSERT INTO session_track_points (session_id, seq, recorded_at, lat, lng, accuracy_m, speed_ms)
               SELECT $1, * FROM unnest($2::int[], $3::timestamptz[], $4::float8[], $5::float8[], $6::real[], $7::real[])`,
              [s.id, tp.map((p) => p.seq), tp.map((p) => p.recordedAt), tp.map((p) => p.lat), tp.map((p) => p.lng),
               tp.map((p) => p.accuracyM ?? null), tp.map((p) => p.speedMs ?? null)],
            );

          const me2: any[] = i.motionEvents ?? [];
          if (me2.length)
            await c.query(
              `INSERT INTO session_motion_events (session_id, kind, occurred_at, value, duration_ms)
               SELECT $1, * FROM unnest($2::text[], $3::timestamptz[], $4::numeric[], $5::int[])`,
              [s.id, me2.map((e) => e.kind), me2.map((e) => e.occurredAt), me2.map((e) => e.value ?? null), me2.map((e) => e.durationMs ?? null)],
            );

          // Validação anti-fraude e score: SEMPRE no servidor
          const status = (await c.query('SELECT fn_validate_session($1) AS s', [s.id])).rows[0].s;

          let xp = 0;
          if (status === 'valid') {
            const season = (
              await c.query(
                `SELECT id FROM seasons WHERE organization_id IS NULL AND $1::timestamptz::date BETWEEN starts_on AND ends_on LIMIT 1`,
                [s.started_at],
              )
            ).rows[0];
            const ins = await c.query(
              `INSERT INTO xp_entries (user_id, amount, source_kind, source_ref, modality_id, season_id)
               VALUES ($1,$2,'session',$3,$4,$5) ON CONFLICT DO NOTHING RETURNING amount`,
              [me, config.xpPerValidSession, s.id, s.modality_id, season?.id ?? null],
            );
            xp = ins.rows[0]?.amount ?? 0;
          }

          const final = (await c.query('SELECT * FROM sessions WHERE id = $1', [s.id])).rows[0];
          return { session: mapSession(final), alreadySynced: false, xpEarned: xp, userErrors: [] };
        });
      } catch (e) {
        // Dois envios simultâneos do mesmo clientSessionId: o segundo cai aqui
        if (isUniqueViolation(e)) {
          const again = await existing();
          if (again) return again;
        }
        throw e;
      }

      if (result.session) {
        pool.query('SELECT fn_refresh_rankings()').catch((e) => console.error('[ranking] refresh falhou:', e.message));
      }
      return result;
    },

    disputeSession: async (_: unknown, a: any, ctx: Ctx) => {
      const me = requireUser(ctx);
      const msg = String(a.message ?? '').trim();
      if (msg.length < 5 || msg.length > 1000) return { success: false, userErrors: [UE('INVALID_MESSAGE', 'Explique o problema (5 a 1000 caracteres).', ['message'])] };
      return tx(me, async (c) => {
        const s = (await c.query('SELECT id, status FROM sessions WHERE id = $1', [a.sessionId])).rows[0]; // RLS
        if (!s) return { success: false, userErrors: [UE('NOT_FOUND', 'Sessão não encontrada.')] };
        await c.query('INSERT INTO session_disputes (session_id, user_id, message) VALUES ($1,$2,$3)', [s.id, me, msg]);
        if (s.status === 'invalid') await c.query(`UPDATE sessions SET status = 'disputed' WHERE id = $1`, [s.id]);
        return { success: true, userErrors: [] };
      });
    },
  },
};

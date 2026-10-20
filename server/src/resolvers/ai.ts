import { GraphQLError } from 'graphql';
import { pool, tx } from '../db.js';
import { requireUser, clamp, type Ctx } from '../context.js';

type Metric = { code: string; name: string; unit: string; value: number };
type SessionData = {
  date: string;
  modality: string;
  durationSeconds: number | null;
  rpe: number | null;
  feeling: number | null;
  outcome: string | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  metrics: Metric[];
};
type Analysis = {
  title: string;
  summary: string;
  trends: string[];
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  limitations: string[];
};

function text(value: unknown, fallback: string, max = 1200): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}
function stringList(value: unknown, maxItems = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, maxItems).map(x => x.trim().slice(0, 400));
}
function parseAnalysis(content: unknown): Analysis {
  if (typeof content !== 'string') throw new GraphQLError('A IA retornou uma resposta vazia.', { extensions: { code: 'AI_INVALID_RESPONSE' } });
  let parsed: any;
  try { parsed = JSON.parse(content); }
  catch { throw new GraphQLError('Não foi possível interpretar o relatório gerado pela IA. Tente novamente.', { extensions: { code: 'AI_INVALID_RESPONSE' } }); }
  return {
    title: text(parsed.title, 'Análise de desempenho'),
    summary: text(parsed.summary, 'Não foi possível gerar um resumo confiável.'),
    trends: stringList(parsed.trends),
    strengths: stringList(parsed.strengths),
    improvements: stringList(parsed.improvements),
    recommendations: stringList(parsed.recommendations),
    limitations: stringList(parsed.limitations),
  };
}

async function generate(data: SessionData[]): Promise<Analysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new GraphQLError('Análise por IA não configurada no servidor. Configure OPENAI_API_KEY e tente novamente.', { extensions: { code: 'AI_NOT_CONFIGURED' } });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.2, max_tokens: 1400, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: [
            'Você é um analista de desempenho esportivo cuidadoso. Responda em português do Brasil.',
            'Use exclusivamente os dados fornecidos. Não invente valores, eventos, posições táticas ou causas.',
            'Compare sessões antigas e recentes apenas quando houver dados suficientes; os itens estão do mais antigo para o mais recente.',
            'Se houver menos de 3 sessões válidas, deixe claro que não há amostra suficiente para tendência confiável.',
            'Não faça diagnóstico médico, não prescreva tratamento e não incentive treinar com dor. Recomendações devem ser graduais, gerais e seguras.',
            'Considere que métricas podem estar ausentes, GPS pode ter ruído e valores entre modalidades não são diretamente comparáveis.',
            'Retorne SOMENTE JSON com chaves: title, summary, trends, strengths, improvements, recommendations, limitations. Cada lista deve conter frases curtas. Se não houver evidência, informe isso nas limitations.',
          ].join(' ') },
          { role: 'user', content: JSON.stringify({ sessions: data }) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[ai] provider error', response.status, body.slice(0, 300));
      throw new GraphQLError(response.status === 429
        ? 'O serviço de IA está temporariamente limitado. Aguarde um pouco e tente novamente.'
        : 'O serviço de IA não conseguiu gerar o relatório agora. Tente novamente mais tarde.',
        { extensions: { code: response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR' } });
    }
    const payload: any = await response.json();
    return parseAnalysis(payload?.choices?.[0]?.message?.content);
  } catch (e) {
    if (e instanceof GraphQLError) throw e;
    if ((e as { name?: string })?.name === 'AbortError')
      throw new GraphQLError('A análise demorou demais. Tente novamente.', { extensions: { code: 'AI_TIMEOUT' } });
    throw new GraphQLError('Não foi possível conectar ao serviço de IA. Tente novamente mais tarde.', { extensions: { code: 'AI_PROVIDER_ERROR' } });
  } finally {
    clearTimeout(timer);
  }
}

export const aiResolvers = {
  Query: {
    myPerformanceAnalysis: async (_: unknown, args: { modalityId?: number | null; first?: number | null }, ctx: Ctx) => {
      const userId = requireUser(ctx);
      const limit = clamp(args.first, 3, 20, 10);
      const rows = await tx(userId, async c => (await c.query(
        `WITH recent AS (
           SELECT s.id, s.started_at, s.duration_seconds, s.rpe, s.feeling, s.outcome,
                  s.points_for, s.points_against, s.modality_id
             FROM sessions s
            WHERE s.user_id = $1 AND s.status = 'valid'
              AND ($2::int IS NULL OR s.modality_id = $2)
            ORDER BY s.started_at DESC, s.id DESC
            LIMIT $3
         )
         SELECT r.id AS session_id, r.started_at, r.duration_seconds, r.rpe, r.feeling, r.outcome,
                r.points_for, r.points_against, m.name_pt AS modality_name,
                md.code AS metric_code, md.label_pt AS metric_name, md.unit AS metric_unit,
                sm.value::float8 AS metric_value
           FROM recent r
           JOIN modalities m ON m.id = r.modality_id
           LEFT JOIN session_metrics sm ON sm.session_id = r.id
           LEFT JOIN metric_definitions md ON md.id = sm.metric_id
          ORDER BY r.started_at ASC, r.id ASC, md.code`,
        [userId, args.modalityId ?? null, limit],
      )).rows);
      const bySession = new Map<string, SessionData>();
      for (const r of rows as any[]) {
        const key = String(r.session_id);
        let item = bySession.get(key);
        if (!item) {
          item = { date: new Date(r.started_at).toISOString().slice(0, 10), modality: r.modality_name,
            durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
            rpe: r.rpe == null ? null : Number(r.rpe), feeling: r.feeling == null ? null : Number(r.feeling),
            outcome: r.outcome, pointsFor: r.points_for == null ? null : Number(r.points_for),
            pointsAgainst: r.points_against == null ? null : Number(r.points_against), metrics: [] };
          bySession.set(key, item);
        }
        if (r.metric_code && r.metric_value != null && Number.isFinite(Number(r.metric_value))) {
          item.metrics.push({ code: r.metric_code, name: r.metric_name, unit: r.metric_unit, value: Number(r.metric_value) });
        }
      }
      const sessions = [...bySession.values()];
      if (!sessions.length) throw new GraphQLError('Ainda não há sessões válidas com dados para analisar.', { extensions: { code: 'AI_NO_DATA' } });
      const analysis = await generate(sessions);
      return { ...analysis, sessionsAnalyzed: sessions.length, generatedAt: new Date().toISOString() };
    },
  },
};

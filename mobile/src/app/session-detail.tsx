import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Button, Card, Heading, Muted, Screen, Title } from '../components/ui';
import { errorMessage, gql } from '../lib/api';
import { fmtDate, fmtDuration, num, reasonLabel, statusLabel } from '../lib/format';
import { colors, space } from '../lib/theme';

type Metric = { value: string | number; metric: { code: string; name: string; unit: string } };
type Point = { seq: number; recordedAt: string; lat: number; lng: number; accuracyM: number | null; speedMs: number | null };
type Session = {
  id: string; startedAt: string; endedAt: string | null; durationSeconds: number | null;
  status: string; score: string | null; source: string; invalidReasons: string[];
  rpe: number | null; outcome: string | null; pointsFor: number | null; pointsAgainst: number | null;
  xpEarned: number; modality: { name: string; slug: string; sport: { slug: string; name: string } };
  metrics: Metric[]; trackPoints: Point[];
};
const QUERY = `query($id: UUID!) {
  session(id: $id) {
    id startedAt endedAt durationSeconds status score source invalidReasons rpe outcome pointsFor pointsAgainst xpEarned
    modality { name slug sport { slug name } }
    metrics { value metric { code name unit } }
    trackPoints(first: 5000, after: 0) { seq recordedAt lat lng accuracyM speedMs }
  }
}`;
const footballSlugs = new Set(['football_field', 'football_society', 'futsal', 'football_7', 'beach_soccer']);
function metricValue(m: Metric): string {
  const v = Number(m.value);
  if (!Number.isFinite(v)) return '—';
  const c = m.metric.code;
  if (c === 'distance_total_m' || c === 'high_intensity_distance_m') return `${(v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
  if (c === 'elapsed_time_s' || c === 'active_time_s') return fmtDuration(v);
  if (c === 'avg_pace_min_km' || c === 'best_pace_min_km') return `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')} min/km`;
  if (c.endsWith('_speed_kmh')) return `${num(v, 1)} km/h`;
  return `${num(v, 1)} ${m.metric.unit}`.trim();
}
export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await gql<{ session: Session | null }>(QUERY, { id });
        if (!active) return;
        if (d.session) setSession(d.session);
        else setError('Sessão não encontrada ou sem permissão de acesso.');
      } catch (e) { if (active) setError(errorMessage(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [id]);
  if (loading) return <Screen><Title>Relatório da partida</Title><Muted>Carregando dados…</Muted></Screen>;
  if (!session) return <Screen><Title>Relatório da partida</Title><Banner kind="error">{error ?? 'Sessão indisponível.'}</Banner><Button title="Voltar" onPress={() => router.back()} /></Screen>;
  const metrics = session.metrics ?? [];
  const byCode = new Map(metrics.map(m => [m.metric.code, m]));
  const order = ['distance_total_m','elapsed_time_s','active_time_s','avg_speed_kmh','max_speed_kmh','high_intensity_distance_m','sprint_count','accel_count','avg_pace_min_km','best_pace_min_km'];
  const selected = order.map(c => byCode.get(c)).filter((m): m is Metric => !!m);
  const points = session.trackPoints ?? [];
  const acc = points.map(p => p.accuracyM).filter((n): n is number => n != null && Number.isFinite(n));
  const meanAcc = acc.length ? acc.reduce((a,b) => a+b, 0) / acc.length : null;
  const football = footballSlugs.has(session.modality.slug) || /futebol|futsal|society/i.test(session.modality.name);
  return <Screen>
    <Button title="← Histórico" variant="secondary" onPress={() => router.back()} />
    <Title>Relatório da partida</Title>
    <Muted>{session.modality.name} · {fmtDate(session.startedAt)}</Muted>
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading>Status</Heading>
        <Text style={{ color: session.status === 'VALID' ? colors.ok : session.status === 'INVALID' ? colors.danger : colors.warn, fontWeight: '700' }}>{statusLabel(session.status)}</Text>
      </View>
      <Muted>Duração: {session.durationSeconds == null ? '—' : fmtDuration(session.durationSeconds)}</Muted>
      {session.score != null && <Muted>Score do servidor: {num(session.score, 1)} (escala própria; não é nota de 0 a 10).</Muted>}
      {session.rpe != null && <Muted>Esforço percebido: {session.rpe}/10</Muted>}
      {session.outcome && <Muted>Resultado: {session.outcome === 'WIN' ? 'Vitória' : session.outcome === 'DRAW' ? 'Empate' : 'Derrota'}{session.pointsFor != null && session.pointsAgainst != null ? ` · ${session.pointsFor} × ${session.pointsAgainst}` : ''}</Muted>}
      {!!session.xpEarned && <Muted>Experiência: +{session.xpEarned} XP</Muted>}
    </Card>
    <Heading>{football ? 'Indicadores de futebol' : 'Indicadores do treino'}</Heading>
    {selected.length ? <Card>{selected.map(m => <View key={m.metric.code} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 5 }}>
      <Text style={{ flex: 1, color: colors.muted }}>{m.metric.name}</Text>
      <Text style={{ color: colors.text, fontWeight: '600', textAlign: 'right' }}>{metricValue(m)}</Text>
    </View>)}</Card> : <Banner kind="warn">Esta sessão não possui métricas de GPS salvas.</Banner>}
    <Heading>Trilha GPS</Heading>
    <Card>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{points.length} pontos armazenados</Text>
      {points.length >= 2 ? <><Muted>Os pontos podem ser usados para gerar o mapa de deslocamento na próxima etapa.</Muted>
        <Muted>Período: {fmtDate(points[0].recordedAt)} — {fmtDate(points[points.length - 1].recordedAt)}</Muted>
        {meanAcc != null && <Muted>Precisão média informada: {num(meanAcc, 1)} m.</Muted>}
      </> : <Muted>Não há pontos suficientes para desenhar o percurso ou o mapa de calor.</Muted>}
      {points.length > 0 && <Muted>A trilha é um dado de localização e só deve ser exibida ao titular da sessão.</Muted>}
    </Card>
    {session.invalidReasons.length > 0 && <Card><Heading>Alertas de validação</Heading>{session.invalidReasons.map(r => <Muted key={r} style={{ color: colors.danger }}>• {reasonLabel(r)}</Muted>)}</Card>}
    <Banner kind="info">As métricas dependem da qualidade do GPS e da continuidade da gravação. Ainda não há uma nota de desempenho de 0 a 10 validada.</Banner>
  </Screen>;
}

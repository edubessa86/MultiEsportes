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
function metricNumber(metrics: Metric[], code: string): number | null {
  const metric = metrics.find((m) => m.metric.code === code);
  if (!metric) return null;
  const value = Number(metric.value);
  return Number.isFinite(value) ? value : null;
}
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
  const football = footballSlugs.has(session.modality.slug) || /futebol|futsal|society|salão/i.test(session.modality.name);
  const distance = metricNumber(metrics, 'distance_total_m');
  const maxSpeed = metricNumber(metrics, 'max_speed_kmh');
  const sprints = metricNumber(metrics, 'sprint_count');
  const accelerations = metricNumber(metrics, 'accel_count');
  const activeTime = metricNumber(metrics, 'active_time_s');
  const duration = session.durationSeconds ?? metricNumber(metrics, 'elapsed_time_s');
  // Indicador orientativo (não médico): normaliza cada dimensão contra referências configuráveis.
  // Só calcula quando existem pelo menos 3 dimensões medidas; não substitui o score do servidor.
  const scoreParts = [
    distance == null ? null : Math.min(10, (distance / 6000) * 10),
    maxSpeed == null ? null : Math.min(10, (maxSpeed / 28) * 10),
    sprints == null ? null : Math.min(10, (sprints / 12) * 10),
    accelerations == null ? null : Math.min(10, (accelerations / 25) * 10),
    activeTime == null || !duration || duration <= 0 ? null : Math.min(10, (activeTime / duration) * 10),
  ].filter((v): v is number => v != null && Number.isFinite(v));
  const performanceScore = scoreParts.length >= 3
    ? Math.round((scoreParts.reduce((sum, v) => sum + v, 0) / scoreParts.length) * 10) / 10
    : null;
  const gpsPoints = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.accuracyM == null || p.accuracyM <= 30));
  const minLat = gpsPoints.length ? Math.min(...gpsPoints.map((p) => p.lat)) : 0;
  const maxLat = gpsPoints.length ? Math.max(...gpsPoints.map((p) => p.lat)) : 0;
  const minLng = gpsPoints.length ? Math.min(...gpsPoints.map((p) => p.lng)) : 0;
  const maxLng = gpsPoints.length ? Math.max(...gpsPoints.map((p) => p.lng)) : 0;
  const latSpan = maxLat - minLat || 0.00001;
  const lngSpan = maxLng - minLng || 0.00001;
  const movementSummary: string[] = [];
  if (distance != null) movementSummary.push(distance >= 6000 ? 'volume de deslocamento elevado para a referência inicial' : 'há espaço para aumentar o volume de deslocamento gradualmente');
  if (maxSpeed != null) movementSummary.push(maxSpeed >= 25 ? 'atingiu velocidade máxima compatível com corrida intensa' : 'a velocidade máxima registrada ficou abaixo de 25 km/h');
  if (sprints != null) movementSummary.push(sprints > 0 ? `foram detectados ${Math.round(sprints)} sprints` : 'não foram detectados sprints pelos limiares atuais');
  if (activeTime != null && duration && duration > 0) movementSummary.push(`tempo ativo estimado em ${Math.round(activeTime / duration * 100)}% da duração considerada`);
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
      {points.length >= 2 ? <><Muted>O mapa abaixo representa a densidade relativa dos pontos GPS registrados; não é um mapa tático calibrado do campo.</Muted>
        <Muted>Período: {fmtDate(points[0].recordedAt)} — {fmtDate(points[points.length - 1].recordedAt)}</Muted>
        {meanAcc != null && <Muted>Precisão média informada: {num(meanAcc, 1)} m.</Muted>}
      </> : <Muted>Não há pontos suficientes para desenhar o percurso ou o mapa de calor.</Muted>}
      {gpsPoints.length >= 2 && <View style={{ height: 190, borderRadius: 10, backgroundColor: '#236b43', overflow: 'hidden', borderWidth: 2, borderColor: '#d9f0df', position: 'relative', marginTop: 8 }}>
        <View style={{ position: 'absolute', left: '5%', right: '5%', top: '8%', bottom: '8%', borderWidth: 1, borderColor: '#b8e0c5' }} />
        <View style={{ position: 'absolute', left: '50%', top: '8%', bottom: '8%', width: 1, backgroundColor: '#b8e0c5' }} />
        <View style={{ position: 'absolute', width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: '#b8e0c5', left: '50%', top: '50%', marginLeft: -27, marginTop: -27 }} />
        {gpsPoints.filter((_, i) => i % Math.max(1, Math.floor(gpsPoints.length / 220)) === 0).map((p, i) => <View key={p.seq ?? i} style={{ position: 'absolute', left: `${5 + ((p.lng - minLng) / lngSpan) * 90}%`, top: `${8 + (1 - (p.lat - minLat) / latSpan) * 84}%`, width: 9, height: 9, borderRadius: 5, backgroundColor: i % 4 === 0 ? '#ff5252' : i % 2 === 0 ? '#ffd54f' : '#9cffb2', opacity: 0.8 }} />)}
      </View>}
      {points.length > 0 && <Muted>A trilha é um dado de localização e só deve ser exibida ao titular da sessão.</Muted>}
    </Card>
    {football && <><Heading>Nota indicativa de desempenho</Heading>
      <Card>
        {performanceScore == null ? <Muted>Não há pelo menos três indicadores medidos para calcular uma nota responsável. Grave mais dados de GPS para habilitá-la.</Muted> : <>
          <Text style={{ fontSize: 32, fontWeight: '800', color: colors.primary }}>{performanceScore.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/10</Text>
          <Muted>Média simples de indicadores normalizados: distância (referência 6 km), velocidade máxima (28 km/h), sprints (12), acelerações (25) e proporção de tempo ativo. Referências iniciais, não calibradas por posição, idade, sexo ou modalidade.</Muted>
        </>}
      </Card>
      <Heading>Resumo automático</Heading>
      <Card>
        {movementSummary.length ? <Muted>Com base apenas nos dados registrados: {movementSummary.join('; ')}.</Muted> : <Muted>Não há métricas suficientes para gerar um resumo. O resumo atual é baseado em regras locais; ainda não é uma análise por modelo de IA.</Muted>}
        <Muted>Use a comparação entre partidas do mesmo atleta e da mesma modalidade para interpretar evolução; uma sessão isolada não mede sozinha o desempenho técnico ou tático.</Muted>
      </Card>
    </>}
    {(session.invalidReasons ?? []).length > 0 && <Card><Heading>Alertas de validação</Heading>{(session.invalidReasons ?? []).map(r => <Muted key={r} style={{ color: colors.danger }}>• {reasonLabel(r)}</Muted>)}</Card>}
    <Banner kind="info">As métricas dependem da qualidade do GPS e da continuidade da gravação. A nota é indicativa e transparente; a integração de IA generativa e a calibração esportiva ficam como etapas futuras.</Banner>
  </Screen>;
}

import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Text, View } from 'react-native';
import { Banner, Button, Card, Center, Chip, Field, Heading, Muted, Screen, Stat, Title } from '../components/ui';
import { useAuth } from '../lib/auth';
import { loadCatalog, trackingModeOf, type CatalogModality } from '../lib/catalog';
import { fmtDuration, num, reasonLabel } from '../lib/format';
import { computeGpsMetrics, decimate, type GpsResult, type Pt } from '../lib/metrics';
import { MotionRecorder, type MotionResult } from '../lib/motion';
import { enqueue, flush, type SyncInput, type SyncResult } from '../lib/queue';
import { colors, space } from '../lib/theme';
import { clearPoints, getMockedCount, getPoints, startTracking, stopTracking } from '../lib/tracker';

type Phase = 'starting' | 'recording' | 'review' | 'saving' | 'done' | 'error';
const MAX_STORED_POINTS = 4000; // limite do armazenamento local (AsyncStorage) e do envio

const LABELS: Record<string, string> = {
  distance_total_m: 'Distância (m)', max_speed_kmh: 'Vel. máxima (km/h)', sprint_count: 'Sprints', high_intensity_distance_m: 'Alta intensidade (m)',
  accel_count: 'Acelerações', avg_speed_kmh: 'Vel. média (km/h)', active_time_s: 'Tempo ativo (s)', player_load: 'Carga', jump_count: 'Saltos',
  jump_height_avg_cm: 'Altura média salto (cm)',
};

export default function Record() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { user, refreshUser } = useAuth();

  const [modality, setModality] = useState<CatalogModality | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<{ dist: number; speed: number; max: number; points: number } | null>(null);
  const [trackMode, setTrackMode] = useState<'background' | 'foreground' | null>(null);

  const [gps, setGps] = useState<(GpsResult & { points: Pt[]; mocked: number }) | null>(null);
  const [motion, setMotion] = useState<MotionResult | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<'WIN' | 'DRAW' | 'LOSS' | null>(null);
  const [pf, setPf] = useState('');
  const [pa, setPa] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [queued, setQueued] = useState(false);

  const startMs = useRef(0);
  const endMs = useRef(0);
  const motionRef = useRef<MotionRecorder | null>(null);
  const begun = useRef(false);

  // 1) carrega a modalidade (do servidor ou do cache)
  useEffect(() => {
    loadCatalog()
      .then(({ catalog }) => {
        const m = catalog.modalities.find((x) => x.slug === slug);
        if (m) setModality(m);
        else { setErrorMsg('Modalidade não encontrada.'); setPhase('error'); }
      })
      .catch(() => { setErrorMsg('Não foi possível carregar a modalidade. Abra o app com conexão uma vez.'); setPhase('error'); });
  }, [slug]);

  // 2) inicia a medição assim que a modalidade carrega
  useEffect(() => {
    if (!modality || begun.current) return;
    begun.current = true;
    (async () => {
      clearPoints();
      if (trackingModeOf(modality) === 'gps') {
        const r = await startTracking();
        if (!r.ok) { setErrorMsg(r.message); setPhase('error'); return; }
        setTrackMode(r.mode);
        if (r.mode === 'foreground') await activateKeepAwakeAsync('session');
      } else {
        const rec = new MotionRecorder();
        if (!(await rec.start())) { setErrorMsg('Este aparelho não tem acelerômetro disponível.'); setPhase('error'); return; }
        motionRef.current = rec;
        await activateKeepAwakeAsync('session'); // sensores precisam do app aberto e tela ligada
      }
      startMs.current = Date.now();
      setPhase('recording');
    })();
  }, [modality]);

  // 3) relógio e estatísticas ao vivo
  useEffect(() => {
    if (phase !== 'recording' || !modality) return;
    const isGps = trackingModeOf(modality) === 'gps';
    let tick = 0;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startMs.current) / 1000));
      if (isGps && tick++ % 3 === 0) {
        const pts = getPoints();
        const m = computeGpsMetrics(pts).metrics;
        const last = pts[pts.length - 1];
        setLive({ dist: m.distance_total_m, speed: (last?.speed ?? 0) * 3.6, max: m.max_speed_kmh, points: pts.length });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, modality]);

  // 4) limpeza ao sair da tela
  useEffect(() => () => {
    stopTracking();
    deactivateKeepAwake('session');
    motionRef.current?.stop();
  }, []);

  const finish = useCallback(async () => {
    if (!modality) return;
    endMs.current = Date.now();
    if (trackingModeOf(modality) === 'gps') {
      await stopTracking();
      const pts = [...getPoints()];
      setGps({ ...computeGpsMetrics(pts), points: pts, mocked: getMockedCount() });
    } else {
      setMotion(motionRef.current?.stop() ?? { metrics: {}, samples: 0 });
    }
    deactivateKeepAwake('session');
    setPhase('review');
  }, [modality]);

  const leave = useCallback(() => {
    stopTracking();
    deactivateKeepAwake('session');
    clearPoints();
    router.replace('/');
  }, []);

  // Botão voltar do Android: nunca perde um treino sem perguntar
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'recording' || phase === 'review') {
        Alert.alert('Descartar este treino?', 'Os dados medidos serão perdidos.', [
          { text: 'Continuar', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: leave },
        ]);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [phase, leave]);

  const durationS = Math.max(0, Math.round((endMs.current - startMs.current) / 1000));
  const isGps = modality ? trackingModeOf(modality) === 'gps' : false;
  const values = isGps ? gps?.metrics ?? {} : motion?.metrics ?? {};
  const hasEnoughData = isGps ? !!gps?.enough : (motion?.samples ?? 0) >= 200;

  async function save() {
    if (!modality || !user) return;
    setPhase('saving');
    const allowed = new Set(modality.metrics.map((m) => m.metric.code)); // o servidor só aceita métricas da modalidade
    const metrics = Object.entries(values)
      .filter(([code, v]) => allowed.has(code) && Number.isFinite(v))
      .map(([metricCode, value]) => ({ metricCode, value }));

    const forN = pf.trim() === '' ? undefined : Number.parseInt(pf, 10);
    const againstN = pa.trim() === '' ? undefined : Number.parseInt(pa, 10);
    const input: SyncInput = {
      clientSessionId: Crypto.randomUUID(),
      modalityId: modality.id,
      startedAt: new Date(startMs.current).toISOString(),
      endedAt: new Date(endMs.current).toISOString(),
      source: isGps ? 'GPS' : 'IMU',
      deviceKind: 'PHONE',
      metrics,
      trackPoints: isGps && gps
        ? decimate(gps.points, MAX_STORED_POINTS).map((p, i) => ({
            seq: i, recordedAt: new Date(p.t).toISOString(), lat: p.lat, lng: p.lng,
            accuracyM: p.acc ?? undefined, speedMs: p.speed ?? undefined,
          }))
        : undefined,
      rpe: rpe ?? undefined,
      outcome: outcome ?? undefined,
      pointsFor: outcome && Number.isInteger(forN) ? forN : undefined,
      pointsAgainst: outcome && Number.isInteger(againstN) ? againstN : undefined,
    };

    // Primeiro guarda no aparelho (nada se perde), depois tenta enviar
    await enqueue({ id: input.clientSessionId, userId: user.id, modalityName: modality.name, savedAt: new Date().toISOString(), input });
    const r = await flush(user.id);
    const mine = r.results.find((x) => x.id === input.clientSessionId) ?? null;
    setResult(mine);
    setQueued(!mine);
    if (mine) refreshUser();
    clearPoints();
    setPhase('done');
  }

  // ---------- telas ----------
  if (phase === 'error') {
    return (
      <Screen>
        <Title>Não foi possível iniciar</Title>
        <Banner kind="error">{errorMsg}</Banner>
        <Button title="Voltar" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (phase === 'starting' || !modality) {
    return <Screen scroll={false}><Center><Heading>Preparando {modality?.name ?? 'treino'}…</Heading><Muted>Aguarde o GPS/sensores.</Muted></Center></Screen>;
  }

  if (phase === 'recording') {
    return (
      <Screen scroll={false}>
        <Title>{modality.name}</Title>
        <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
          <Text style={{ fontSize: 56, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] }}>{fmtDuration(elapsed)}</Text>
          <Muted>gravando…</Muted>
        </Card>

        {isGps ? (
          <Card>
            <View style={{ flexDirection: 'row' }}>
              <Stat label="Distância" value={live ? num(live.dist / 1000, 2) : '0'} unit="km" />
              <Stat label="Velocidade" value={live ? num(live.speed, 1) : '0'} unit="km/h" />
              <Stat label="Máxima" value={live ? num(live.max, 1) : '0'} unit="km/h" />
            </View>
            <Muted>{live?.points ? `${live.points} pontos de GPS` : 'Aguardando sinal de GPS… vá para um local aberto.'}</Muted>
          </Card>
        ) : (
          <Banner kind="info">Sensores ativos. Mantenha o celular preso ao corpo, o app aberto e a tela ligada.</Banner>
        )}

        {trackMode === 'foreground' && (
          <Banner kind="warn">Localização "o tempo todo" não foi concedida: mantenha o app aberto e a tela ligada durante o treino.</Banner>
        )}
        {trackMode === 'background' && <Muted>Você pode apagar a tela: o GPS continua em segundo plano (notificação fixa).</Muted>}

        <View style={{ flex: 1 }} />
        <Button
          title="Encerrar treino"
          variant="danger"
          onPress={() => Alert.alert('Encerrar o treino?', 'Você poderá revisar antes de salvar.', [
            { text: 'Continuar treinando', style: 'cancel' }, { text: 'Encerrar', onPress: finish },
          ])}
        />
      </Screen>
    );
  }

  if (phase === 'done') {
    const ok = result?.status === 'VALID';
    return (
      <Screen>
        <Title>{result ? (ok ? 'Treino registrado' : 'Treino enviado') : 'Treino salvo'}</Title>
        {result && ok && (
          <Banner kind="ok">Sessão válida · score {num(result.score)} · +{result.xpEarned} XP</Banner>
        )}
        {result && !ok && (
          <Banner kind="error">
            Sessão marcada como {result.status === 'INVALID' ? 'inválida' : result.status}, sem XP.
            {result.invalidReasons.length ? `\nMotivo: ${result.invalidReasons.map(reasonLabel).join('; ')}.` : ''}
          </Banner>
        )}
        {queued && <Banner kind="warn">Salvo no aparelho. Será enviado ao servidor assim que houver conexão (abra a aba Treinar).</Banner>}
        <Button title="Concluir" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  // review / saving
  const short = durationS < modality.minValidDurationMin * 60;
  return (
    <Screen>
      <Title>Revisar treino</Title>
      <Card>
        <Heading>{modality.name}</Heading>
        <Muted>Duração {fmtDuration(durationS)}</Muted>
        {Object.entries(values)
          .filter(([code]) => LABELS[code] && modality.metrics.some((m) => m.metric.code === code))
          .map(([code, v]) => (
            <View key={code} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.muted }}>{LABELS[code]}</Text>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{num(v)}</Text>
            </View>
          ))}
        {!isGps && <Muted>Valores de sensores do celular: experimentais, compare só com seus próprios treinos.</Muted>}
      </Card>

      {!hasEnoughData && (
        <Banner kind="error">
          {isGps
            ? 'Poucos dados de GPS (sinal fraco ou treino muito parado). Para manter o ranking confiável, esta sessão não pode ser enviada. Descarte e tente de novo ao ar livre.'
            : 'Poucos dados dos sensores. Mantenha o app aberto com a tela ligada durante o treino. Esta sessão não pode ser enviada.'}
        </Banner>
      )}
      {short && hasEnoughData && (
        <Banner kind="warn">Menos de {modality.minValidDurationMin} min: o servidor vai marcar esta sessão como inválida (sem XP).</Banner>
      )}
      {!!gps?.mocked && <Banner kind="warn">{gps.mocked} localização(ões) falsa(s) foram ignoradas.</Banner>}

      <Card>
        <Heading>Como foi o esforço? (1–10)</Heading>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <Chip key={n} label={String(n)} selected={rpe === n} onPress={() => setRpe(rpe === n ? null : n)} />
          ))}
        </View>
        <Heading>Resultado (opcional)</Heading>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip label="Vitória" selected={outcome === 'WIN'} onPress={() => setOutcome(outcome === 'WIN' ? null : 'WIN')} />
          <Chip label="Empate" selected={outcome === 'DRAW'} onPress={() => setOutcome(outcome === 'DRAW' ? null : 'DRAW')} />
          <Chip label="Derrota" selected={outcome === 'LOSS'} onPress={() => setOutcome(outcome === 'LOSS' ? null : 'LOSS')} />
        </View>
        {outcome && (
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}><Field label="Seu time" value={pf} onChangeText={setPf} keyboardType="number-pad" maxLength={3} /></View>
            <View style={{ flex: 1 }}><Field label="Adversário" value={pa} onChangeText={setPa} keyboardType="number-pad" maxLength={3} /></View>
          </View>
        )}
      </Card>

      <Button title="Salvar e enviar" onPress={save} disabled={!hasEnoughData} loading={phase === 'saving'} />
      <Button
        title="Descartar"
        variant="secondary"
        onPress={() => Alert.alert('Descartar este treino?', 'Os dados medidos serão perdidos.', [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: leave },
        ])}
      />
    </Screen>
  );
}

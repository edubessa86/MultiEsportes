/**
 * Teste da lógica de métricas com uma trilha de GPS sintética de resultado conhecido.
 * Rodar:  npm run test:metrics
 */
import { computeGpsMetrics, decimate, type Pt } from '../src/lib/metrics';

// Gerador pseudoaleatório determinístico (resultados reproduzíveis)
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1; // [-1, 1)

const LAT0 = -22.9, LNG0 = -43.2;
const mLat = (m: number) => m / 111_320;
const mLng = (m: number) => m / (111_320 * Math.cos((LAT0 * Math.PI) / 180));

export function synthetic(opts: { seconds: number; withGlitches: boolean }): Pt[] {
  const pts: Pt[] = [];
  const t0 = 1_700_000_000_000;
  let x = 0;
  let dir = 1;
  const sprintStarts = [100, 340, 580, 820, 1060, 1300]; // 6 sprints de 4 s a 8 m/s
  for (let s = 0; s < opts.seconds; s++) {
    const sprinting = sprintStarts.some((a) => s >= a && s < a + 4);
    const stopped = s >= 600 && s < 660;
    const v = stopped ? 0 : sprinting ? 8 : 2;
    if (s % 60 === 0) dir = -dir; // vai e volta, como em um campo
    x += dir * v;
    let px = x + rand() * 0.3;
    if (opts.withGlitches && [200, 700, 1100].includes(s)) px += 500; // GPS "teletransportou"
    pts.push({ t: t0 + s * 1000, lat: LAT0, lng: LNG0 + mLng(px), acc: 5, speed: Math.max(0, v + rand() * 0.2) });
  }
  return pts;
}

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`); };

// ----- trilha limpa: 25 min -----
const track = synthetic({ seconds: 1500, withGlitches: true });
const r = computeGpsMetrics(track);
const m = r.metrics;
const expectedDist = 6 * 4 * 8 + (1500 - 24 - 60) * 2; // 3024 m (parado = 0)

check('trilha suficiente (enough)', r.enough);
check('distância ≈ 3024 m (±8%)', Math.abs(m.distance_total_m - expectedDist) / expectedDist < 0.08, `${m.distance_total_m} m`);
check('6 sprints detectados', m.sprint_count === 6, `${m.sprint_count}`);
check('velocidade máxima ≈ 28,8 km/h (27–30)', m.max_speed_kmh >= 27 && m.max_speed_kmh <= 30, `${m.max_speed_kmh} km/h`);
check('3 pontos "teletransportados" descartados', r.discardedPoints >= 3, `${r.discardedPoints} descartados`);
check('distância alta intensidade ≈ 190 m (±25%)', Math.abs(m.high_intensity_distance_m - 192) / 192 < 0.25, `${m.high_intensity_distance_m} m`);
check('tempo ativo ≈ 1440 s (±5%)', Math.abs(m.active_time_s - 1440) / 1440 < 0.05, `${m.active_time_s} s`);
check('velocidade média ≈ 7,3 km/h (±8%)', Math.abs(m.avg_speed_kmh - 7.26) / 7.26 < 0.08, `${m.avg_speed_kmh} km/h`);
check('pace médio coerente com distância e duração', m.avg_pace_min_km > 0 && Math.abs(m.avg_pace_min_km - (m.elapsed_time_s / 60 / (m.distance_total_m / 1000))) < 0.03, `${m.avg_pace_min_km} min/km`);
check('melhor pace por 1 km só existe com trilha suficiente', typeof m.best_pace_min_km === 'number' && m.best_pace_min_km > 0 && m.best_pace_min_km <= m.avg_pace_min_km, `${m.best_pace_min_km} min/km`);
check('duração calculada exclui grandes lacunas de GPS', m.elapsed_time_s < 1500 && m.elapsed_time_s > 1400, `${m.elapsed_time_s} s`);
check('acelerações: 6 arrancadas (+ a saída da parada) => 6 a 9', m.accel_count >= 6 && m.accel_count <= 9, `${m.accel_count}`);

// ----- sem os glitches, mesmo resultado (descarte não pode distorcer) -----
const clean = computeGpsMetrics(synthetic({ seconds: 1500, withGlitches: false })).metrics;
check('glitches não alteram a distância (±2%)', Math.abs(clean.distance_total_m - m.distance_total_m) / clean.distance_total_m < 0.02, `${clean.distance_total_m} vs ${m.distance_total_m}`);

// ----- casos ruins -----
const few = computeGpsMetrics(track.slice(0, 20));
check('poucos pontos => enough = false', !few.enough);
const lowAcc = computeGpsMetrics(track.map((p) => ({ ...p, acc: 80 })));
check('precisão ruim (80 m) => tudo descartado', lowAcc.usedPoints === 0 && !lowAcc.enough, `${lowAcc.usedPoints} usados`);
const standing = computeGpsMetrics(synthetic({ seconds: 200, withGlitches: false }).map((p, i) => ({ ...p, lng: LNG0 + mLng(rand() * 0.3), speed: 0, t: p.t + i * 0 })));
check('parado o tempo todo => distância ~0 e enough = false', standing.metrics.distance_total_m < 20 && !standing.enough, `${standing.metrics.distance_total_m} m`);
const gap = computeGpsMetrics(track.filter((_, i) => i < 300 || i >= 600)); // 5 min sem sinal
check('buraco de sinal não vira "teletransporte" de distância', gap.metrics.distance_total_m < expectedDist, `${gap.metrics.distance_total_m} m`);

// ----- decimate -----
const dec = decimate(track, 400);
check('decimate limita o tamanho e mantém o 1º ponto', dec.length === 400 && dec[0] === track[0]);
check('decimate não mexe em listas pequenas', decimate([1, 2, 3], 10).length === 3);

console.log(fail ? `\n${fail} falha(s)` : '\nTodas as verificações passaram');
if (fail) throw new Error('metrics.test falhou');

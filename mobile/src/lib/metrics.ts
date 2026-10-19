export type Pt = { t: number; lat: number; lng: number; acc: number | null; speed: number | null };

// Limiares usuais em ciências do esporte (valores iniciais; ajuste conforme a modalidade)
const MAX_ACCURACY_M = 30;     // descarta pontos com erro maior que isso
const GLITCH_MS = 12.5;        // 45 km/h: acima disso é erro de GPS, não corrida
const STATIONARY_MS = 0.5;     // abaixo disso conta como parado (evita somar "tremida" do GPS)
const SPRINT_START_MS = 7.0;   // ≈ 25,2 km/h
const SPRINT_KEEP_MS = 6.0;    // histerese: o sprint só termina abaixo disso
const SPRINT_MIN_S = 1.0;
const HIGH_INTENSITY_MS = 5.5; // ≈ 19,8 km/h
const ACCEL_START = 2.0;       // m/s²
const ACCEL_END = 1.0;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: Pt, b: Pt): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type GpsResult = {
  /** Valores prontos para enviar (códigos iguais aos do catálogo do servidor). */
  metrics: Record<string, number>;
  usedPoints: number;
  discardedPoints: number;
  enough: boolean;
};

/** Calcula as métricas de campo a partir da trilha de GPS. */
export function computeGpsMetrics(raw: Pt[]): GpsResult {
  const sorted = raw.filter((p) => p.acc == null || p.acc <= MAX_ACCURACY_M).sort((a, b) => a.t - b.t);
  const pts = sorted.filter((p, i) => i === 0 || p.t > sorted[i - 1].t);

  type Seg = { dt: number; d: number; v: number };
  const segs: Seg[] = [];
  let prev: Pt | null = null;
  let glitches = 0;

  for (const p of pts) {
    if (!prev) { prev = p; continue; }
    const dt = (p.t - prev.t) / 1000;
    if (dt > 10) { prev = p; continue; } // buraco no sinal: não liga os pontos
    const d = haversine(prev, p);
    const vCalc = d / dt;
    if (vCalc > GLITCH_MS) { glitches++; continue; } // ponto absurdo: ignora e mantém o anterior
    const vRep = p.speed != null && p.speed >= 0 ? Math.min(p.speed, GLITCH_MS) : vCalc;
    segs.push({ dt, d: Math.max(vRep, vCalc) >= STATIONARY_MS ? d : 0, v: vRep });
    prev = p;
  }

  // Suaviza a velocidade (média móvel de 3 amostras)
  const vs = segs.map((_, i) => {
    const w = segs.slice(Math.max(0, i - 1), i + 2);
    return w.reduce((s, x) => s + x.v, 0) / w.length;
  });

  const distance = segs.reduce((s, x) => s + x.d, 0);
  const elapsed = pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / 1000 : 0;
  const maxV = vs.length ? Math.max(...vs) : 0;

  let hid = 0, active = 0, sprints = 0, accels = 0;
  let inSprint = false, sprintT = 0, inAccel = false;
  segs.forEach((s, i) => {
    const v = vs[i];
    if (v >= HIGH_INTENSITY_MS) hid += s.d;
    if (v >= 0.7 && s.dt <= 5) active += s.dt;

    if (!inSprint && v >= SPRINT_START_MS) { inSprint = true; sprintT = 0; }
    if (inSprint) {
      if (v >= SPRINT_KEEP_MS) sprintT += s.dt;
      else { if (sprintT >= SPRINT_MIN_S) sprints++; inSprint = false; }
    }

    // Acelerações usam a velocidade SEM suavização: a média móvel achata a arrancada e subconta
    // (a velocidade Doppler do GPS já é limpa; a suavizada fica só para velocidade máxima e sprints)
    if (i > 0) {
      const a = (s.v - segs[i - 1].v) / s.dt;
      if (!inAccel && a >= ACCEL_START) { accels++; inAccel = true; }
      else if (inAccel && a < ACCEL_END) inAccel = false;
    }
  });
  if (inSprint && sprintT >= SPRINT_MIN_S) sprints++;

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    metrics: {
      distance_total_m: Math.round(distance),
      avg_speed_kmh: elapsed > 0 ? r1((distance / elapsed) * 3.6) : 0,
      max_speed_kmh: r1(maxV * 3.6),
      sprint_count: sprints,
      high_intensity_distance_m: Math.round(hid),
      accel_count: accels,
      active_time_s: Math.round(active),
    },
    usedPoints: pts.length,
    discardedPoints: raw.length - pts.length + glitches,
    // pouca trilha = GPS não funcionou direito; o app avisa antes de enviar
    enough: pts.length >= 30 && distance >= 50,
  };
}

/** Reduz a trilha para no máximo `max` pontos (limite do armazenamento local e do envio). */
export function decimate<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]);
}

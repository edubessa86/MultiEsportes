import { Accelerometer } from 'expo-sensors';

/**
 * Métricas por acelerômetro do celular (modalidades de quadra/areia).
 * EXPERIMENTAL: celular no bolso/mão mede diferente de um relógio ou sensor no tronco.
 * Os valores servem para comparar treinos seus entre si, não com outras pessoas.
 */
export type MotionResult = { metrics: Record<string, number>; samples: number };

const G = 9.81;
const INTERVAL_MS = 40; // ~25 Hz

export class MotionRecorder {
  private sub: ReturnType<typeof Accelerometer.addListener> | null = null;
  private samples = 0;
  private load = 0;
  private accels = 0;
  private lastAccelT = -1e9;
  private prev: { x: number; y: number; z: number; mag: number } | null = null;
  private freeFallStart: number | null = null;
  private flights: number[] = [];

  async start(): Promise<boolean> {
    if (!(await Accelerometer.isAvailableAsync())) return false;
    Accelerometer.setUpdateInterval(INTERVAL_MS);
    this.sub = Accelerometer.addListener(({ x, y, z }) => this.onSample(x, y, z, Date.now()));
    return true;
  }

  private onSample(x: number, y: number, z: number, t: number) {
    const mag = Math.hypot(x, y, z); // em "g"
    this.samples++;

    if (this.prev) {
      // Carga: soma da variação da aceleração (aproximação do "player load")
      this.load += Math.hypot(x - this.prev.x, y - this.prev.y, z - this.prev.z);
      // Aceleração brusca: variação grande entre amostras, com intervalo mínimo entre eventos
      if (Math.abs(mag - this.prev.mag) >= 0.6 && t - this.lastAccelT >= 500) {
        this.accels++;
        this.lastAccelT = t;
      }
    }

    // Salto: queda livre (|a| bem abaixo de 1 g) seguida de impacto de pouso
    if (mag < 0.5) {
      this.freeFallStart ??= t;
    } else if (this.freeFallStart !== null) {
      const dur = t - this.freeFallStart;
      if (dur >= 120 && dur <= 1200 && mag > 1.3) this.flights.push(dur / 1000);
      this.freeFallStart = null;
    }
    this.prev = { x, y, z, mag };
  }

  stop(): MotionResult {
    this.sub?.remove();
    this.sub = null;
    const metrics: Record<string, number> = {
      player_load: Math.round((this.load / 10) * 10) / 10,
      accel_count: this.accels,
    };
    // altura pelo tempo de voo: h = g·t²/8 (em cm); descarta valores impossíveis
    const heights = this.flights.map((t) => (G * t * t * 100) / 8).filter((h) => h > 3 && h <= 120);
    metrics.jump_count = heights.length;
    if (heights.length) metrics.jump_height_avg_cm = Math.round((heights.reduce((s, h) => s + h, 0) / heights.length) * 10) / 10;
    return { metrics, samples: this.samples };
  }
}

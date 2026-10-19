export const fmtDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const statusLabel = (s: string): string =>
  ({ VALID: 'Válida', INVALID: 'Inválida', DISPUTED: 'Contestada', PROCESSING: 'Processando', RECORDING: 'Gravando' } as Record<string, string>)[s] ?? s;

/** Traduz os motivos de invalidação que o servidor devolve. */
export const reasonLabel = (r: string): string => {
  if (r === 'duration_too_short') return 'duração abaixo do mínimo da modalidade';
  if (r.startsWith('implausible_')) return `valor impossível em "${r.slice('implausible_'.length)}"`;
  return r;
};

export const num = (v: string | number | null | undefined, digits = 1): string =>
  v == null ? '—' : Number(v).toFixed(digits).replace(/\.0+$/, '');

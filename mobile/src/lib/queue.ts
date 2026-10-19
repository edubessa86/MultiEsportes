import { ApiError, gql, isNetworkError } from './api';
import { kv } from './storage';

export type SyncInput = {
  clientSessionId: string;
  modalityId: number;
  startedAt: string;
  endedAt: string;
  source: 'GPS' | 'IMU' | 'MANUAL';
  deviceKind: 'PHONE';
  metrics: { metricCode: string; value: number }[];
  trackPoints?: { seq: number; recordedAt: string; lat: number; lng: number; accuracyM?: number; speedMs?: number }[];
  rpe?: number;
  feeling?: number;
  outcome?: 'WIN' | 'DRAW' | 'LOSS';
  pointsFor?: number;
  pointsAgainst?: number;
};

export type PendingItem = {
  id: string;            // = clientSessionId
  userId: string;
  modalityName: string;
  savedAt: string;
  input: SyncInput;
  error?: string;        // erro definitivo do servidor (não adianta reenviar igual)
};

export type SyncResult = {
  id: string;
  status: string;
  score: string | null;
  xpEarned: number;
  alreadySynced: boolean;
  invalidReasons: string[];
};

const KEY = 'pending_sessions_v1';

const MUTATION = `mutation($i: SyncSessionInput!){ syncSession(input: $i){
  alreadySynced xpEarned userErrors { code message }
  session { id status score invalidReasons } } }`;

// Um envio por vez: evita mandar a mesma sessão duas vezes em paralelo
let chain: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
};

async function readAll(): Promise<PendingItem[]> {
  return (await kv.get<PendingItem[]>(KEY)) ?? [];
}

export const listPending = async (userId: string) => (await readAll()).filter((p) => p.userId === userId);

export const enqueue = (item: PendingItem) =>
  serial(async () => { await kv.set(KEY, [...(await readAll()).filter((p) => p.id !== item.id), item]); });

export const removePending = (id: string) =>
  serial(async () => { await kv.set(KEY, (await readAll()).filter((p) => p.id !== id)); });

async function markError(id: string, error: string) {
  await kv.set(KEY, (await readAll()).map((p) => (p.id === id ? { ...p, error } : p)));
}

/** Envia as pendentes do usuário. Para na primeira falha de rede (tenta de novo depois). */
export function flush(userId: string): Promise<{ results: SyncResult[]; failed: number; offline: boolean }> {
  return serial(async () => {
    const results: SyncResult[] = [];
    let failed = 0;
    let offline = false;

    for (const item of (await readAll()).filter((p) => p.userId === userId && !p.error)) {
      try {
        const d = await gql<{ syncSession: any }>(MUTATION, { i: item.input });
        const p = d.syncSession;
        if (p.userErrors?.length) {
          failed++;
          await markError(item.id, p.userErrors.map((e: any) => e.message).join(' '));
          continue;
        }
        await kv.set(KEY, (await readAll()).filter((x) => x.id !== item.id));
        results.push({
          id: item.id, status: p.session.status, score: p.session.score, xpEarned: p.xpEarned,
          alreadySynced: p.alreadySynced, invalidReasons: p.session.invalidReasons,
        });
      } catch (e) {
        if (isNetworkError(e)) { offline = true; break; }
        if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') { offline = true; break; }
        failed++;
        await markError(item.id, e instanceof Error ? e.message : 'Erro ao enviar.');
      }
    }
    return { results, failed, offline };
  });
}

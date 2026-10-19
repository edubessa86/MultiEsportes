import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { Pt } from './metrics';

/** IMPORTANTE: este arquivo precisa ser importado no início do app (veja src/app/_layout.tsx),
 *  porque a tarefa de segundo plano é registrada no escopo do módulo. */
const TASK = 'multiesporte-session-location';

let buffer: Pt[] = [];
let mockedCount = 0;
let fgSub: Location.LocationSubscription | null = null;
let mode: 'background' | 'foreground' | null = null;

function ingest(locations: Location.LocationObject[]) {
  for (const l of locations) {
    if (l.mocked) { mockedCount++; continue; } // localização falsa não entra
    buffer.push({
      t: l.timestamp,
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      acc: l.coords.accuracy ?? null,
      speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    });
  }
}

TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (locations?.length) ingest(locations);
});

export type StartResult = { ok: true; mode: 'background' | 'foreground' } | { ok: false; message: string };

export async function startTracking(): Promise<StartResult> {
  buffer = [];
  mockedCount = 0;

  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { ok: false, message: 'Sem permissão de localização. Libere nas configurações do app.' };
  if (!(await Location.hasServicesEnabledAsync())) return { ok: false, message: 'Ative o GPS do aparelho.' };

  // Segundo plano (tela apagada): precisa de "permitir o tempo todo" + serviço com notificação fixa
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.granted) {
    try {
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Treino em andamento',
          notificationBody: 'Medindo distância e velocidade pelo GPS.',
          killServiceOnDestroy: true,
        },
      });
      mode = 'background';
      return { ok: true, mode };
    } catch {
      /* cai para o modo em primeiro plano abaixo */
    }
  }

  fgSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
    (loc) => ingest([loc]),
  );
  mode = 'foreground';
  return { ok: true, mode };
}

export async function stopTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch { /* já parado */ }
  fgSub?.remove();
  fgSub = null;
  mode = null;
}

export const getPoints = (): Pt[] => buffer;
export const getMockedCount = () => mockedCount;
export const getTrackingMode = () => mode;
export const clearPoints = () => { buffer = []; mockedCount = 0; };

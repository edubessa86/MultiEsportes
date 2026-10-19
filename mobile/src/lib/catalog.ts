import { useCallback, useEffect, useState } from 'react';
import { gql } from './api';
import { kv } from './storage';

export type CatalogMetric = { isPrimary: boolean; weight: string; metric: { code: string; name: string; unit: string } };
export type CatalogModality = {
  id: number;
  slug: string;
  name: string;
  gpsRecommended: boolean;
  imuRecommended: boolean;
  minValidDurationMin: number;
  periodKind: string;
  sport: { slug: string; name: string; icon: string | null };
  metrics: CatalogMetric[];
};
export type Catalog = { modalities: CatalogModality[]; seasons: { id: number; name: string }[] };

const QUERY = `{
  modalities { id slug name gpsRecommended imuRecommended minValidDurationMin periodKind
    sport { slug name icon } metrics { isPrimary weight metric { code name unit } } }
  seasons { id name }
}`;

/** Busca no servidor e guarda em cache; sem rede, usa o último catálogo salvo. */
export async function loadCatalog(): Promise<{ catalog: Catalog; fromCache: boolean }> {
  try {
    const d = await gql<Catalog>(QUERY, {}, { auth: false });
    await kv.set('catalog_v1', d);
    return { catalog: d, fromCache: false };
  } catch (e) {
    const cached = await kv.get<Catalog>('catalog_v1');
    if (cached) return { catalog: cached, fromCache: true };
    throw e;
  }
}

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await loadCatalog();
      setCatalog(r.catalog);
      setFromCache(r.fromCache);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o catálogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { catalog, fromCache, loading, error, reload };
}

/** Modalidades de campo medem por GPS; as demais por sensores do aparelho. */
export const trackingModeOf = (m: CatalogModality): 'gps' | 'sensors' => (m.gpsRecommended ? 'gps' : 'sensors');

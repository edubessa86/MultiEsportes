import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { Banner, Button, Card, Chip, Heading, Muted, Screen, Title } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { trackingModeOf, useCatalog, type CatalogModality } from '../../lib/catalog';
import { flush, listPending } from '../../lib/queue';
import { kv } from '../../lib/storage';
import { colors, space } from '../../lib/theme';

export default function Home() {
  const { user, refreshUser } = useAuth();
  const { catalog, fromCache, loading, error, reload } = useCatalog();
  const [slug, setSlug] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { kv.get<string>('lastModality').then((s) => s && setSlug(s)); }, []);

  const selected: CatalogModality | null = useMemo(
    () => catalog?.modalities.find((m) => m.slug === slug) ?? catalog?.modalities[0] ?? null,
    [catalog, slug],
  );

  const bySport = useMemo(() => {
    const map = new Map<string, { name: string; icon: string | null; items: CatalogModality[] }>();
    for (const m of catalog?.modalities ?? []) {
      const g = map.get(m.sport.slug) ?? { name: m.sport.name, icon: m.sport.icon, items: [] };
      g.items.push(m);
      map.set(m.sport.slug, g);
    }
    return [...map.values()];
  }, [catalog]);

  const syncNow = useCallback(async () => {
    if (!user) return;
    const r = await flush(user.id);
    const left = (await listPending(user.id)).length;
    setPending(left);
    if (r.results.length) { setNote(`${r.results.length} sessão(ões) enviada(s) ao servidor.`); refreshUser(); }
    else if (r.offline && left) setNote('Sem conexão com o servidor: as sessões serão enviadas depois.');
    else setNote(null);
  }, [user, refreshUser]);

  useFocusEffect(useCallback(() => { syncNow(); }, [syncNow]));

  const start = () => {
    if (!selected) return;
    kv.set('lastModality', selected.slug);
    router.push({ pathname: '/record', params: { slug: selected.slug } });
  };

  const mode = selected ? trackingModeOf(selected) : null;
  const shown = selected?.metrics.filter((m) => Number(m.weight) > 0).map((m) => m.metric.name) ?? [];

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { reload(); syncNow(); }} />}>
      <Title>Olá, {user?.displayName ?? user?.fullName?.split(' ')[0] ?? 'atleta'}</Title>
      <Muted>{user ? `${user.xpTotal} XP` : ''}</Muted>

      {error && <Banner kind="error">{error}</Banner>}
      {fromCache && <Banner kind="warn">Sem conexão: usando o catálogo salvo no aparelho.</Banner>}
      {pending > 0 && <Banner kind="warn">{pending} sessão(ões) salva(s) aguardando envio. Puxe a tela para tentar de novo.</Banner>}
      {note && <Banner kind="info">{note}</Banner>}

      {bySport.map((g) => (
        <View key={g.name} style={{ gap: space.sm }}>
          <Heading>{g.icon} {g.name}</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {g.items.map((m) => (
              <Chip key={m.slug} label={m.name} selected={selected?.slug === m.slug} onPress={() => setSlug(m.slug)} />
            ))}
          </View>
        </View>
      ))}

      {selected && (
        <Card>
          <Heading>{selected.name}</Heading>
          {mode === 'gps' ? (
            <Muted>Medição por GPS (distância, velocidade, sprints). Treine ao ar livre e deixe o GPS ligado.</Muted>
          ) : (
            <Muted>
              Medição pelos sensores do celular (saltos, acelerações, carga). Experimental: o celular precisa ficar preso ao corpo
              e o app aberto com a tela ligada.
            </Muted>
          )}
          {shown.length > 0 && <Text style={{ color: colors.muted, fontSize: 13 }}>Entra no score: {shown.join(' · ')}</Text>}
          <Muted>Sessões com menos de {selected.minValidDurationMin} min são marcadas como inválidas.</Muted>
        </Card>
      )}

      <Button title="Iniciar treino" onPress={start} disabled={!selected} />
    </Screen>
  );
}

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { Banner, Button, Card, Chip, Heading, Muted, Screen, Title } from '../../components/ui';
import { BrandMark } from '../../components/brand-mark';
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
    () => catalog?.modalities.find((m) => m.slug === slug) ?? catalog?.modalities[0] ?? null, [catalog, slug],
  );
  const bySport = useMemo(() => {
    const map = new Map<string, { name: string; icon: string | null; items: CatalogModality[] }>();
    for (const m of catalog?.modalities ?? []) {
      const g = map.get(m.sport.slug) ?? { name: m.sport.name, icon: m.sport.icon, items: [] };
      g.items.push(m); map.set(m.sport.slug, g);
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
    <Screen refreshControl={<RefreshControl tintColor={colors.accent} refreshing={loading} onRefresh={() => { reload(); syncNow(); }} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 2 }}>CENTRO DE PERFORMANCE</Text>
          <Title>Olá, {user?.displayName ?? user?.fullName?.split(' ')[0] ?? 'atleta'}.</Title>
          <Muted>Pronto para superar seu próximo limite?</Muted>
        </View>
        <BrandMark size={58} />
      </View>

      <View style={{ backgroundColor: '#0C2537', borderRadius: 22, padding: space.lg, borderWidth: 1, borderColor: '#15516A', gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 11, letterSpacing: 1.5 }}>MODO ATLETA</Text>
          <Text style={{ color: colors.primaryDark, fontSize: 12, fontWeight: '700' }}>{user ? `${user.xpTotal} XP` : 'PERFORMANCE'}</Text>
        </View>
        <Text style={{ color: '#F3F7FC', fontSize: 24, fontWeight: '900', lineHeight: 30 }}>Treine com propósito.{"\n"}Evolua com dados.</Text>
        <Text style={{ color: '#B7C8D9', fontSize: 14, lineHeight: 21 }}>Atividade física, foco mental e evolução em cada sessão.</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <View style={{ flex: 1, backgroundColor: '#13394A', borderRadius: 12, padding: 10 }}>
            <Text style={{ color: colors.primaryDark, fontSize: 11, fontWeight: '700' }}>01 / TREINAR</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 12, marginTop: 4 }}>Registre sua sessão</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: '#26351E', borderRadius: 12, padding: 10 }}>
            <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '700' }}>02 / EVOLUIR</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 12, marginTop: 4 }}>Acompanhe métricas</Text>
          </View>
        </View>
      </View>

      {error && <Banner kind="error">{error}</Banner>}
      {fromCache && <Banner kind="warn">Sem conexão: usando o catálogo salvo no aparelho.</Banner>}
      {pending > 0 && <Banner kind="warn">{pending} sessão(ões) salva(s) aguardando envio. Puxe a tela para tentar de novo.</Banner>}
      {note && <Banner kind="info">{note}</Banner>}

      <View style={{ gap: space.sm }}>
        <View style={{ gap: 4 }}>
          <Heading>Escolha sua modalidade</Heading>
          <Muted>Selecione o esporte antes de iniciar.</Muted>
        </View>
        {bySport.map((g) => (
          <View key={g.name} style={{ gap: space.sm, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: space.md }}>
            <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '800' }}>{g.icon ?? '◈'}  {g.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {g.items.map((m) => <Chip key={m.slug} label={m.name} selected={selected?.slug === m.slug} onPress={() => setSlug(m.slug)} />)}
            </View>
          </View>
        ))}
      </View>

      {selected && (
        <Card>
          <Heading>{selected.name}</Heading>
          {mode === 'gps'
            ? <Muted>Medição por GPS: distância, velocidade e sprints. Treine ao ar livre e deixe o GPS ligado.</Muted>
            : <Muted>Medição pelos sensores do celular (saltos, acelerações e carga). Experimental: mantenha o aparelho preso ao corpo e o app aberto.</Muted>}
          {shown.length > 0 && <Text style={{ color: colors.primaryDark, fontSize: 13, lineHeight: 19 }}>Métricas no score: {shown.join(' · ')}</Text>}
          <Muted>Sessões com menos de {selected.minValidDurationMin} min são marcadas como inválidas.</Muted>
        </Card>
      )}
      <Button title="▶  INICIAR TREINO" onPress={start} disabled={!selected} style={{ borderRadius: 16, minHeight: 58 }} />
    </Screen>
  );
}

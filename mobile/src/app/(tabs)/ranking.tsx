import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Card, Chip, Muted, Screen, Title } from '../../components/ui';
import { errorMessage, gql } from '../../lib/api';
import { useCatalog } from '../../lib/catalog';
import { num } from '../../lib/format';
import { colors, space } from '../../lib/theme';

type Entry = { position: number; user: { id: string; displayName: string }; value: string };

const PERF = `query($m: Int!, $s: Int!){ performanceRanking(modalityId: $m, seasonId: $s){
  entries{ position totalScore sessionsCounted user{ id displayName } } viewerEntry{ position totalScore sessionsCounted user{ id displayName } } } }`;
const XP = `{ xpRanking{ entries{ position totalXp user{ id displayName } } viewerEntry{ position totalXp user{ id displayName } } } }`;

export default function Ranking() {
  const { catalog } = useCatalog();
  const [kind, setKind] = useState<'perf' | 'xp'>('perf');
  const [modalityId, setModalityId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mine, setMine] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (catalog && modalityId == null) setModalityId(catalog.modalities[0]?.id ?? null); }, [catalog, modalityId]);

  const load = useCallback(async () => {
    if (!catalog) return;
    setLoading(true);
    setError(null);
    try {
      if (kind === 'perf') {
        const seasonId = catalog.seasons[0]?.id;
        if (modalityId == null || !seasonId) { setEntries([]); setMine(null); return; }
        const d = await gql<any>(PERF, { m: modalityId, s: seasonId });
        const conv = (e: any): Entry => ({ position: e.position, user: e.user, value: `${num(e.totalScore)} pts · ${e.sessionsCounted} sess.` });
        setEntries(d.performanceRanking.entries.map(conv));
        setMine(d.performanceRanking.viewerEntry ? conv(d.performanceRanking.viewerEntry) : null);
      } else {
        const d = await gql<any>(XP);
        const conv = (e: any): Entry => ({ position: e.position, user: e.user, value: `${e.totalXp} XP` });
        setEntries(d.xpRanking.entries.map(conv));
        setMine(d.xpRanking.viewerEntry ? conv(d.xpRanking.viewerEntry) : null);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [catalog, kind, modalityId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const row = (e: Entry, highlight = false) => (
    <View key={`${e.position}-${e.user.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 }}>
      <Text style={{ width: 34, fontWeight: '700', color: highlight ? colors.primary : colors.muted }}>#{e.position}</Text>
      <Text style={{ flex: 1, color: colors.text, fontWeight: highlight ? '700' : '400' }}>{e.user.displayName}</Text>
      <Text style={{ color: colors.muted }}>{e.value}</Text>
    </View>
  );

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Title>Ranking</Title>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Chip label="Desempenho" selected={kind === 'perf'} onPress={() => setKind('perf')} />
        <Chip label="XP" selected={kind === 'xp'} onPress={() => setKind('xp')} />
      </View>

      {kind === 'perf' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {catalog?.modalities.map((m) => (
            <Chip key={m.id} label={m.name} selected={modalityId === m.id} onPress={() => setModalityId(m.id)} />
          ))}
        </ScrollView>
      )}

      {error && <Banner kind="error">{error}</Banner>}
      {mine && <Card style={{ backgroundColor: colors.primarySoft }}><Muted>Sua posição</Muted>{row(mine, true)}</Card>}
      <Card>
        {entries.length === 0 && !loading ? <Muted>Ainda não há ninguém no ranking. Envie uma sessão válida!</Muted> : entries.map((e) => row(e, e.user.id === mine?.user.id))}
      </Card>
      {kind === 'perf' && <Muted>O desempenho soma seus 20 melhores scores válidos da temporada, por modalidade.</Muted>}
    </Screen>
  );
}

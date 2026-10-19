import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, Text, View } from 'react-native';
import { Banner, Button, Card, Heading, Muted, Screen, Title } from '../../components/ui';
import { errorMessage, gql } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDuration, num, reasonLabel, statusLabel } from '../../lib/format';
import { listPending, removePending, type PendingItem } from '../../lib/queue';
import { colors, space } from '../../lib/theme';

type Item = {
  id: string; startedAt: string; durationSeconds: number | null; status: string; score: string | null;
  invalidReasons: string[]; xpEarned: number; modality: { name: string };
};

const QUERY = `query($a: String){ mySessions(first: 20, after: $a){ totalCount pageInfo{ hasNextPage endCursor }
  edges{ node{ id startedAt durationSeconds status score invalidReasons xpEarned modality{ name } } } } }`;

export default function History() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (reset: boolean) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      setPending(await listPending(user.id));
      const d = await gql<any>(QUERY, { a: reset ? null : cursor });
      const page = d.mySessions;
      const nodes: Item[] = page.edges.map((e: any) => e.node);
      setItems((prev) => (reset ? nodes : [...prev, ...nodes]));
      setTotal(page.totalCount);
      setMore(page.pageInfo.hasNextPage);
      setCursor(page.pageInfo.endCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [user, cursor]);

  useFocusEffect(useCallback(() => { load(true); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]));

  const discard = (p: PendingItem) =>
    Alert.alert('Descartar sessão?', 'Ela ainda não foi enviada e será apagada do aparelho.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: async () => { await removePending(p.id); setPending(await listPending(user!.id)); } },
    ]);

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} />}>
      <Title>Histórico</Title>
      {error && <Banner kind="error">{error}</Banner>}

      {pending.length > 0 && <Heading>Aguardando envio</Heading>}
      {pending.map((p) => (
        <Card key={p.id}>
          <Text style={{ fontWeight: '600', color: colors.text }}>{p.modalityName} · {fmtDate(p.input.startedAt)}</Text>
          {p.error ? <Banner kind="error">O servidor recusou: {p.error}</Banner> : <Muted>Será enviada quando houver conexão.</Muted>}
          <Button title="Descartar" variant="secondary" onPress={() => discard(p)} />
        </Card>
      ))}

      <Heading>Enviadas ({total})</Heading>
      {!loading && items.length === 0 && !error && <Muted>Nenhuma sessão ainda. Faça seu primeiro treino na aba Treinar.</Muted>}
      {items.map((s) => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '600', color: colors.text }}>{s.modality.name}</Text>
            <Text style={{ color: s.status === 'VALID' ? colors.ok : s.status === 'INVALID' ? colors.danger : colors.warn, fontWeight: '600' }}>
              {statusLabel(s.status)}
            </Text>
          </View>
          <Muted>
            {fmtDate(s.startedAt)} · {s.durationSeconds ? fmtDuration(s.durationSeconds) : '—'}
            {s.score ? ` · score ${num(s.score)}` : ''}{s.xpEarned ? ` · +${s.xpEarned} XP` : ''}
          </Muted>
          {s.invalidReasons.length > 0 && <Muted style={{ color: colors.danger }}>Motivo: {s.invalidReasons.map(reasonLabel).join('; ')}</Muted>}
        </Card>
      ))}
      {more && <Button title="Carregar mais" variant="secondary" onPress={() => load(false)} loading={loading} style={{ marginTop: space.sm }} />}
    </Screen>
  );
}

import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type RefreshControlProps, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '../lib/theme';

export function Screen({ children, scroll = true, refreshControl, padded = true }: {
  children: ReactNode; scroll?: boolean; refreshControl?: React.ReactElement<RefreshControlProps>; padded?: boolean;
}) {
  const inner = { padding: padded ? space.lg : 0, gap: space.md };
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[inner, { paddingBottom: space.xl * 2 }]} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export const Title = ({ children }: { children: ReactNode }) => <Text style={styles.title}>{children}</Text>;
export const Heading = ({ children }: { children: ReactNode }) => <Text style={styles.heading}>{children}</Text>;
export const Muted = ({ children, style }: { children: ReactNode; style?: object }) => <Text style={[styles.muted, style]}>{children}</Text>;

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.card;
  const fg = variant === 'secondary' ? colors.primaryDark : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.primaryDark }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#667085" autoCapitalize="none" autoCorrect={false} style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Banner({ kind, children }: { kind: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const map = {
    info: [colors.primarySoft, colors.primaryDark], warn: [colors.warnSoft, colors.warn],
    error: [colors.dangerSoft, colors.danger], ok: [colors.okSoft, colors.ok],
  } as const;
  return (
    <View style={[styles.banner, { backgroundColor: map[kind][0] }]}>
      <Text style={{ color: map[kind][1], fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export const Stat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}<Text style={styles.statUnit}>{unit ? ` ${unit}` : ''}</Text></Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

export const Center = ({ children }: { children: ReactNode }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>{children}</View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  heading: { fontSize: 17, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: colors.border },
  btn: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  btnText: { fontSize: 16, fontWeight: '600' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text, fontWeight: '500' },
  label: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: '#F7FAFC', paddingHorizontal: 12, fontSize: 16, color: '#101828' },
  banner: { borderRadius: 10, padding: space.md },
  stat: { flex: 1, alignItems: 'center', paddingVertical: space.sm },
  statValue: { fontSize: 26, fontWeight: '700', color: colors.text },
  statUnit: { fontSize: 14, fontWeight: '500', color: colors.muted },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
});

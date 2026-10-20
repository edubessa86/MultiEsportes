import { Text, View } from 'react-native';
import { colors } from '../lib/theme';

/** Marca compacta: impulso elétrico + órbita, representando corpo, mente e desempenho. */
export function BrandMark({ size = 64 }: { size?: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#0C2537', borderWidth: 2, borderColor: colors.primaryDark,
      shadowColor: colors.primaryDark, shadowOpacity: 0.22, shadowRadius: 12, elevation: 4,
    }}>
      <View style={{
        position: 'absolute', width: size * 0.7, height: size * 0.7, borderRadius: size,
        borderWidth: 1, borderColor: colors.accent, transform: [{ rotate: '-28deg' }],
      }} />
      <Text style={{ fontSize: size * 0.48, color: colors.primaryDark, fontWeight: '900', lineHeight: size * 0.62 }}>ϟ</Text>
      <View style={{
        position: 'absolute', right: size * 0.14, top: size * 0.18, width: size * 0.11, height: size * 0.11,
        borderRadius: size, backgroundColor: colors.accent,
      }} />
    </View>
  );
}

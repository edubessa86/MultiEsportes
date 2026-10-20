import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../lib/theme';

const icon = (emoji: string) => () => <Text style={{ fontSize: 20 }}>{emoji}</Text>;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primaryDark, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border }, tabBarLabelStyle: { fontSize: 12 } }}>
      <Tabs.Screen name="index" options={{ title: 'Treinar', tabBarIcon: icon('⚽') }} />
      <Tabs.Screen name="history" options={{ title: 'Histórico', tabBarIcon: icon('📋') }} />
      <Tabs.Screen name="ranking" options={{ title: 'Ranking', tabBarIcon: icon('🏆') }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}

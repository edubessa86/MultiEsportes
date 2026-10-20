import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Banner, Button, Card, Field, Heading, Muted, Screen } from '../components/ui';
import { BrandMark } from '../components/brand-mark';
import { useAuth } from '../lib/auth';
import { colors, space } from '../lib/theme';

export default function Login() {
  const auth = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const err = mode === 'in' ? await auth.signIn(email.trim(), password) : await auth.signUp(email.trim(), password, name.trim());
      if (err) setError(err);
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <BrandMark size={86} />
          <Text style={{ color: colors.text, fontSize: 29, fontWeight: '900', letterSpacing: 1.2 }}>MULTIESPORTE</Text>
          <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 3 }}>CORPO • MENTE • PERFORMANCE</Text>
          <Muted style={{ textAlign: 'center' }}>Sua evolução começa com cada treino.</Muted>
        </View>
        <Card>
          <Heading>{mode === 'in' ? 'Acesse sua conta' : 'Crie sua conta'}</Heading>
          {mode === 'up' && <Field label="Nome completo" value={name} onChangeText={setName} autoCapitalize="words" />}
          <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          <Field label="Senha (mín. 8 caracteres)" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'in' ? 'password' : 'new-password'} />
          {busy && <Muted>Conectando… se o servidor estava inativo, a primeira conexão pode levar até 1 minuto.</Muted>}
          {error && <Banner kind="error">{error}</Banner>}
          <Button title={mode === 'in' ? 'Entrar' : 'Criar conta'} onPress={submit} loading={busy} />
          <Button title={mode === 'in' ? 'Ainda não tenho conta' : 'Já tenho conta'} variant="secondary"
            onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }} />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

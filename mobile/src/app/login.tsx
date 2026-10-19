import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Banner, Button, Card, Field, Heading, Muted, Screen, Title } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Login() {
  const auth = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [server, setServer] = useState(auth.serverUrl);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!server.trim()) return setError('Informe o endereço do servidor (ex.: https://multiesportes.onrender.com).');
    setBusy(true);
    try {
      await auth.changeServer(server);
      const err = mode === 'in' ? await auth.signIn(email.trim(), password) : await auth.signUp(email.trim(), password, name.trim());
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Title>Multiesporte</Title>
        <Muted>Meça seus treinos de futebol, vôlei, basquete e handebol.</Muted>

        <Card>
          <Heading>Servidor</Heading>
          <Field label="Endereço da API" value={server} onChangeText={setServer} placeholder="https://multiesportes.onrender.com" keyboardType="url" />
          <Muted>Use o endereço do seu servidor na nuvem. Em rede local, use o IP do computador (não "localhost").</Muted>
        </Card>

        <Card>
          <Heading>{mode === 'in' ? 'Entrar' : 'Criar conta'}</Heading>
          {mode === 'up' && <Field label="Nome completo" value={name} onChangeText={setName} autoCapitalize="words" />}
          <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          <Field label="Senha (mín. 8 caracteres)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
          {busy && <Muted>Conectando… se o servidor estava inativo, a primeira vez pode levar até 1 minuto.</Muted>}
          {error && <Banner kind="error">{error}</Banner>}
          <Button title={mode === 'in' ? 'Entrar' : 'Criar conta'} onPress={submit} loading={busy} />
          <Button
            title={mode === 'in' ? 'Ainda não tenho conta' : 'Já tenho conta'}
            variant="secondary"
            onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}
          />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

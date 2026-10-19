import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Banner, Button, Card, Field, Heading, Muted, Screen, Title } from '../../components/ui';
import { useAuth } from '../../lib/auth';

export default function Profile() {
  const { user, serverUrl, changeServer, signOut, refreshUser } = useAuth();
  const [server, setServer] = useState(serverUrl);
  const [saved, setSaved] = useState(false);

  return (
    <Screen>
      <Title>Perfil</Title>
      <Card>
        <Heading>{user?.fullName ?? '—'}</Heading>
        <Muted>{user ? `${user.xpTotal} XP${user.isPremium ? ' · Premium' : ''}` : ''}</Muted>
        <Button title="Atualizar" variant="secondary" onPress={refreshUser} />
      </Card>

      <Card>
        <Heading>Servidor</Heading>
        <Field label="Endereço da API" value={server} onChangeText={(t) => { setServer(t); setSaved(false); }} keyboardType="url" />
        {saved && <Banner kind="ok">Endereço salvo.</Banner>}
        <Button title="Salvar endereço" variant="secondary" onPress={async () => { await changeServer(server); setSaved(true); }} />
      </Card>

      <Card>
        <Heading>Sobre as medições</Heading>
        <Muted>
          GPS: distância, velocidade máxima, sprints e acelerações vêm do GPS do aparelho. Em quadra coberta o GPS não funciona,
          por isso essas modalidades usam o acelerômetro (experimental). O servidor valida cada sessão e recusa valores impossíveis.
        </Muted>
      </Card>

      <Button
        title="Sair da conta"
        variant="danger"
        onPress={() => Alert.alert('Sair?', 'Sessões ainda não enviadas continuam salvas no aparelho.', [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Sair', style: 'destructive', onPress: signOut },
        ])}
      />
      <Muted>Versão {Constants.expoConfig?.version ?? '—'}</Muted>
    </Screen>
  );
}

# App Android (Expo / React Native)

App de celular do projeto: escolhe a modalidade, grava o treino (GPS ou sensores), guarda no aparelho
e envia ao servidor (`../server`), com histórico e ranking. Expo SDK 58 · TypeScript · expo-router.

> **Status honesto:** o código compila (tipos, pacote Android e projeto nativo gerados sem erro), a lógica de
> métricas passa em teste com trilha sintética e o contrato com o servidor foi validado. **Mas ele ainda não foi
> executado em um celular de verdade**, e o APK precisa ser gerado por você (veja abaixo). Espere pequenos
> ajustes no primeiro teste em campo.

## 1. Gerar o APK (nuvem da Expo, grátis)

Precisa de Node 20+ e de uma conta gratuita em <https://expo.dev>. Não precisa instalar Android Studio.

```bash
cd mobile
npm install
npx eas-cli@latest login            # entra com sua conta Expo
npx eas-cli@latest init             # cria o projeto na Expo e grava o projectId no app.json
npm run build:apk                   # = eas build -p android --profile preview
```

Na primeira vez ele pergunta se pode gerar a chave de assinatura: responda **sim** (a Expo guarda para você).
A fila gratuita pode levar de alguns minutos a algumas dezenas de minutos. No fim ele mostra um **link do APK**:
abra no celular (ou baixe e envie), permita "instalar apps desconhecidos" e instale.

**Alternativa local** (se você já tem JDK 17 + Android SDK): `npx expo prebuild --platform android` e depois
`cd android && ./gradlew assembleRelease` (o APK sai em `android/app/build/outputs/apk/release/`).

> Não use o Expo Go: a tarefa de GPS em segundo plano não funciona nele. É preciso instalar o APK.

O identificador do app é `com.example.multiesporte` (em `app.json`). Para uso pessoal serve; troque antes de
publicar em loja.

## 2. Conectar o celular ao servidor

O servidor roda no seu computador. No `server/.env` use `HOST=0.0.0.0`, reinicie e libere a porta 4000 no firewall.
Com o celular **no mesmo Wi-Fi**, descubra o IP do computador (`ipconfig` no Windows, `ipconfig getifaddr en0` no Mac,
`hostname -I` no Linux) e digite no app, na tela de entrada: `192.168.0.10:4000` (use o seu IP).

O app aceita HTTP porque está em rede local. Fora de casa, use um túnel HTTPS (por exemplo Cloudflare Tunnel) e
cole o endereço `https://...` no app. **Não exponha o servidor à internet sem HTTPS.**

## 3. Roteiro de teste em campo (15 minutos)

1. Crie a conta, escolha **Futebol de campo** e toque em **Iniciar treino**.
2. Aceite a localização; quando o Android pedir, escolha **"Permitir o tempo todo"** (é o que deixa o GPS rodar com a tela apagada).
3. Ao ar livre, ande, trote e faça 2 ou 3 arrancadas. Apague a tela por alguns minutos e volte: o relógio deve ter continuado.
4. Encerre (mínimo de **20 min** para a sessão ser válida em futebol de campo; para um teste rápido use uma modalidade com mínimo menor, como o 3x3 com 5 min).
5. Na revisão, confira distância e velocidade máxima. Salve. Veja o resultado (válida, score, XP), o histórico e o ranking.
6. Teste offline: ative o modo avião, grave e salve; desligue o modo avião e abra a aba **Treinar**: a sessão deve subir sozinha.

Se algo não bater (distância muito diferente da real, sprints demais ou de menos), me diga os números: os limiares estão em
`src/lib/metrics.ts` e são fáceis de ajustar.

## Como funciona

| Parte | Arquivo | Observação |
|---|---|---|
| GPS em segundo plano | `src/lib/tracker.ts` | Serviço em primeiro plano (notificação fixa). Sem a permissão "o tempo todo", cai para modo com tela ligada. Localização falsa (mock) é ignorada. |
| Métricas de GPS | `src/lib/metrics.ts` | Distância, velocidade média e máxima, sprints (≥ 25 km/h por ≥ 1 s), alta intensidade (≥ 19,8 km/h), acelerações. Descarta pontos com erro > 30 m e saltos impossíveis (> 45 km/h). |
| Sensores (quadra) | `src/lib/motion.ts` | Acelerômetro: saltos (queda livre), altura (tempo de voo), acelerações e carga. **Experimental.** |
| Fila offline | `src/lib/queue.ts` | Salva no aparelho **antes** de enviar; reenvio idempotente (`clientSessionId`). |
| API e login | `src/lib/api.ts`, `auth.tsx` | Tokens no cofre do sistema (SecureStore); renovação automática. |

O app só envia as métricas que o catálogo do servidor permite para a modalidade, e o servidor sempre revalida tudo.

## Limitações conhecidas

- **Se o app for fechado ou o celular reiniciar durante o treino, os dados em memória se perdem** (ainda não há recuperação de sessão interrompida).
- **Sensores do celular são aproximados.** Servem para comparar seus treinos entre si, não com outras pessoas ou com relógios esportivos. Exigem o app aberto e a tela ligada.
- **Alguns fabricantes (Xiaomi, Samsung, Huawei, Oppo) matam apps em segundo plano.** Se o GPS parar com a tela apagada, desative a otimização de bateria para o app.
- A notificação do serviço de GPS pode não aparecer no Android 13+ se a permissão de notificações não for concedida (o serviço continua rodando).
- Só Android está configurado e testado em build. Não há Wear OS/relógio nem iOS validado.
- Textos e telas em português do Brasil apenas.
- Sua trilha de GPS fica gravada no **seu** servidor. Trate esse banco como dado sensível.

## Scripts

```bash
npm run typecheck      # checagem de tipos
npm run test:metrics   # testa o cálculo de métricas (trilha sintética, 16 verificações)
npm run bundle         # gera o pacote JavaScript do Android (valida que tudo compila)
npm run build:apk      # gera o APK na nuvem da Expo
```

# Servidor GraphQL (MVP para teste próprio)

Node 20.6+ · TypeScript · GraphQL Yoga · PostgreSQL. Usa o mesmo contrato de `../graphql/schema.graphql`.
Escopo do MVP: **um usuário testando sozinho** — cadastro/login por e-mail, catálogo das 12 modalidades,
sincronização de sessões (com validação anti-fraude no servidor), estatísticas e rankings.

## Rodando

**Com Docker** (mais simples; o `docker-compose.yml` não foi executado por mim, veja a nota abaixo):

```bash
cd server
docker compose up -d        # Postgres 16 + esquema + catálogo + papel app_rw
npm install
npm run setup               # cria o .env com um JWT_SECRET aleatório
npm run dev                 # http://127.0.0.1:4000/graphql  (GraphiQL)
```

**Sem Docker** (Postgres já instalado):

```bash
createdb appdb
psql -d appdb -v ON_ERROR_STOP=1 -f ../db/01_schema.sql -f ../db/02_seed_catalog.sql -f ../db/04_app_role.sql
npm install && npm run setup
# ajuste DATABASE_URL no .env se o seu Postgres não estiver em localhost:5432
npm run dev
```

Com o servidor no ar, em outro terminal: `npm run e2e` (47 verificações; cria usuários novos a cada execução).

## Testando pelo navegador (GraphiQL)

Abra `http://127.0.0.1:4000/graphql`. Passo a passo:

```graphql
# 1. cadastro (copie o accessToken da resposta)
mutation { signUp(input: { email: "voce@exemplo.com", password: "uma-senha-forte", fullName: "Seu Nome" }) {
  accessToken refreshToken userErrors { code message } } }

# 2. ids das modalidades
{ modalities { id slug name } }
```

No painel **Headers** do GraphiQL: `{ "authorization": "Bearer <accessToken>" }`

```graphql
# 3. enviar uma sessão (troque modalityId pelo id de football_field)
mutation { syncSession(input: {
  clientSessionId: "6f1c2c3e-8b1a-4b3a-9d55-2a7f0c0e1111"
  modalityId: 1, source: GPS
  startedAt: "2026-10-14T18:00:00Z", endedAt: "2026-10-14T19:30:00Z"
  metrics: [ { metricCode: "distance_total_m", value: 7200 }, { metricCode: "max_speed_kmh", value: 27 },
             { metricCode: "sprint_count", value: 18 } ]
}) { alreadySynced xpEarned userErrors { code message } session { status score invalidReasons } } }

# 4. conferir
{ viewer { xpTotal } mySessions { totalCount edges { node { status score } } } }
{ performanceRanking(modalityId: 1, seasonId: 1) { entries { position totalScore user { displayName } } viewerEntry { position } } }
```

Reenvie o passo 3 com o mesmo `clientSessionId`: volta `alreadySynced: true`, sem duplicar nem dar XP de novo.
Para ver o anti-fraude, envie `max_speed_kmh: 95` ou uma sessão de poucos minutos: fica `INVALID` com os motivos.

## Testar pelo celular (mesma rede Wi-Fi)

No `.env`: `HOST=0.0.0.0`; use `http://<IP-do-seu-computador>:4000/graphql`. Só faça isso em rede de confiança:
em HTTP puro, senha e token trafegam sem criptografia. Para uso fora de casa, coloque atrás de HTTPS.

## O que está implementado

| Área | Operações |
|---|---|
| Catálogo (público) | `sports`, `modalities`, `modality`, `seasons` |
| Conta | `signUp`, `signIn`, `refreshSession`, `signOut`, `viewer`, `user` (só o próprio), `updateProfile`, `upsertUserModality`, `removeUserModality`, `recordConsent`, `myConsents` |
| Sessões | `syncSession` (idempotente), `session`, `mySessions` (paginação por cursor), `disputeSession`, `athleteStatistics` |
| Ranking | `performanceRanking`, `xpRanking` |

As outras 46 operações do schema (times, súmula, quizzes, avaliações, pagamentos...) respondem
`NOT_IMPLEMENTED`, com erro claro em vez de `null`.

## Análise de desempenho com IA generativa

A tela de relatório permite analisar as até 10 sessões válidas mais recentes da mesma modalidade. A análise procura tendências, pontos fortes, oportunidades de melhoria e próximos passos, sempre com base nos dados efetivamente registrados. A API filtra sessões pelo usuário autenticado e não envia coordenadas GPS, IDs de sessão, nome, e-mail ou tokens ao provedor.

Para habilitar a funcionalidade, configure no ambiente do servidor (Render ou `.env` local):

```env
OPENAI_API_KEY=sua_chave_do_provedor
OPENAI_MODEL=gpt-4o-mini
# Opcional, apenas para endpoints compatíveis com a API Chat Completions:
# OPENAI_BASE_URL=https://api.openai.com/v1/chat/completions
```

A chave fica somente no servidor; nunca a inclua no app mobile ou no repositório. Sem a chave, a API responde `AI_NOT_CONFIGURED`. A chamada tem timeout de 25 segundos e limite de 20 sessões por solicitação. O modelo é configurável para permitir trocar de modelo/provedor compatível. A análise não é diagnóstico médico nem avaliação técnica certificada; métricas ausentes, ruído do GPS e poucas sessões podem impedir conclusões confiáveis. Chamadas ao provedor podem gerar custos.
## Decisões de segurança

- Token no header `Authorization`, nunca como argumento. Access token de 15 min; refresh token rotativo
  (reuso de um token antigo revoga todos os do usuário).
- Senhas com scrypt; mesma duração de resposta para e-mail inexistente (evita enumeração).
- O servidor conecta como `app_rw` (sem `BYPASSRLS`, sem ser dono das tabelas) e define `app.user_id` por transação:
  o **RLS do banco é a barreira real** de isolamento entre usuários.
- Ranking usa `PublicUser` (apelido, foto, região): nunca nome completo, nascimento ou e-mail.
- Score e XP só nascem no servidor; o cliente não consegue definir os próprios.
- Menores de 18 anos são **bloqueados** no cadastro (o fluxo de responsável legal da LGPD ainda não existe).

## Limitações conhecidas (para depois do teste)

- Sem verificação de e-mail, recuperação de senha, login social ou por telefone.
- Limite de tentativas de login em memória (reinicia com o servidor; use Redis em produção).
- Sem limite de profundidade/complexidade de queries e sem HTTPS: **não exponha à internet como está**.
- O ranking é atualizado a cada sessão sincronizada (`fn_refresh_rankings`); com muitos usuários, troque por
  `REFRESH ... CONCURRENTLY` agendado.
- A senha do papel `app_rw` em `04_app_role.sql` é só de desenvolvimento.
- `docker-compose.yml`: não havia Docker no ambiente onde eu desenvolvi; validei com Postgres 16 instalado
  direto e os mesmos scripts SQL. Se o compose falhar, use o caminho "sem Docker".

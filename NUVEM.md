# Tudo na nuvem: GitHub + Render + Neon + Expo

Nada precisa rodar no seu computador. Você só usa o navegador.

```
 GitHub (código) ──auto-deploy──▶ Render (servidor GraphQL) ──▶ Neon (banco)
      │                                    ▲
      │ botão "Run workflow"               │ HTTPS
      ▼                                    │
 Expo EAS (gera o APK) ───────▶ App no Android
```

## 1. Levar os arquivos para o GitHub (pelo navegador)
1. Descompacte o `esportes-app.zip` (duplo clique no Mac).
2. No seu repositório: **Add file → Upload files**. Arraste as pastas `db`, `graphql`, `mobile`, `server` e o `README.md` (o limite é 100 arquivos por envio; o pacote tem menos que isso). Escreva uma mensagem e clique em **Commit changes**.
3. A pasta `.github` fica escondida no Finder. Crie os dois arquivos pelo site: **Add file → Create new file**, no nome digite `.github/workflows/build-apk.yml` (as barras criam as pastas) e cole o conteúdo do arquivo de mesmo nome do zip; commit. Repita para `.github/workflows/smoke-test.yml`.

> Se o seu repositório já tem o servidor em outra estrutura, ajuste `working-directory` no `build-apk.yml` e o **Root Directory** no Render.

## 2. Banco (Neon)
No **SQL Editor** do Neon, rode `db/neon_setup.sql` inteiro. Depois, em uma execução separada:
```sql
ALTER ROLE app_rw WITH PASSWORD 'sua-senha-forte';
```
Confira: `SELECT slug, is_active FROM modalities;` deve listar 12, com 3 ativas.

## 3. Servidor (Render)
No serviço (Web Service ligado ao repositório do GitHub):

| Campo | Valor |
|---|---|
| Root Directory | `server` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Auto-Deploy | ligado (cada commit no GitHub atualiza o servidor) |

**Environment** (nada disso vai para o GitHub):
- `DATABASE_URL` = `postgresql://app_rw:SUA_SENHA@ep-xxxx-pooler.REGIAO.aws.neon.tech/neondb?sslmode=require`
  (copie o endereço do botão **Connect** do Neon, com pooling ligado, e troque só usuário e senha)
- `JWT_SECRET` = texto aleatório com 32+ caracteres
- `HOST` = `0.0.0.0`
- `NODE_ENV` = `production`

Se o Render reclamar da versão do Node, acrescente `NODE_VERSION` = `22`.
Teste no Hoppscotch (`https://multiesportes.onrender.com/graphql`): `{ modalities { slug name } }`.

### Se o servidor não subir (aba **Logs** do Render)
O servidor confere o banco antes de abrir a porta e diz o que está errado:

| Mensagem no log | O que fazer |
|---|---|
| `O DATABASE_URL usa o usuário "...", que ignora o isolamento entre usuários` | A URL está com o usuário dono do Neon. Use o `app_rw` (passo 2 e a `DATABASE_URL` acima). Isso é proposital: com o dono, um usuário poderia ler as sessões de outro. |
| `O esquema do banco não está instalado` | Rode `db/neon_setup.sql` no SQL Editor do Neon. |
| `Não foi possível conectar ao banco` | Confira senha, endereço e o `?sslmode=require` da `DATABASE_URL`. |
| `schema.graphql não encontrado` | O repositório precisa ter a pasta `graphql/` ao lado de `server/` (ou defina `SCHEMA_PATH`). |

## 4. Conferir tudo com um botão (sem alterar dados)
GitHub → **Actions → Testar servidor na nuvem → Run workflow** (deixe o endereço padrão ou troque).
Ele espera o Render acordar (até ~2,5 min) e confere: servidor no ar, banco conectado, catálogo com as 3 modalidades ativas, temporada em vigor, login protegido e GraphiQL desligado. **Não cria usuários nem sessões.** Verde = pode instalar o app. Vermelho = a linha com ✗ diz o que corrigir.

Se preferir testar à mão no Hoppscotch (`https://multiesportes.onrender.com/graphql`, aba GraphQL):
```graphql
{ modalities { slug name } }
```
```graphql
mutation { signUp(input: { email: "voce@exemplo.com", password: "uma-senha-forte", fullName: "Seu Nome" }) {
  accessToken userErrors { code message } } }
```
Com o `accessToken` recebido, no painel **Headers** coloque `Authorization: Bearer <accessToken>` e rode `{ viewer { fullName xpTotal } }`.

## 5. APK (Expo EAS, disparado pelo GitHub)

**Uma vez só:**
1. Crie a conta grátis em <https://expo.dev>.
2. **Projects → Create a project** (nome/slug: `multiesporte`). Copie o **Project ID** da página do projeto.
3. No GitHub, edite `mobile/app.json` (ícone de lápis) e acrescente dentro de `"expo"`:
   ```json
   "extra": { "eas": { "projectId": "COLE-O-PROJECT-ID" } },
   ```
   (a Expo mostra o `owner` se for conta de organização; conta pessoal não precisa).
4. No expo.dev: **Account settings → Access tokens → Create token**. Copie o valor.
5. No GitHub: repositório → **Settings → Secrets and variables → Actions → New repository secret**, nome `EXPO_TOKEN`, valor = o token.

**Primeira build (a Expo exige aprovação humana para criar a chave de assinatura do Android).**
Se você já gerou um APK antes, pule esta parte. Senão, sem instalar nada: no GitHub, botão verde **Code → Codespaces → Create codespace** (terminal na nuvem, dentro do navegador) e rode:
```
cd mobile
npm ci
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```
Responda **y** quando ele oferecer gerar o keystore. Depois da primeira build, apague o codespace.

**Daqui em diante (cada nova versão do app):**
1. GitHub → aba **Actions → Gerar APK Android → Run workflow**.
2. Acompanhe em expo.dev → seu projeto → **Builds**.
3. Quando ficar verde, abra o link da build **no celular** e instale o APK (o Android pede para permitir "apps desconhecidos").

## Cuidados
- **Nunca** coloque senhas, `DATABASE_URL` ou `JWT_SECRET` em arquivos do GitHub. Elas ficam só nas variáveis do Render e nos segredos do GitHub. O `.gitignore` já ignora `.env`.
- Se alguma senha aparecer em chat, print ou commit, troque-a (`ALTER ROLE ...` no Neon e a variável no Render).
- Planos gratuitos têm limites: o Render "dorme" depois de um tempo parado (a primeira chamada leva até 1 min), e Neon, Expo e Codespaces têm cotas mensais.

# App multiesporte de performance — banco e API

Futebol, vôlei, basquete e handebol (12 modalidades) em um único modelo.
**Regras de cada modalidade são dados**, não código: adicionar uma modalidade é um `INSERT`.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `db/01_schema.sql` | Estrutura PostgreSQL 15+: catálogo, usuários, times, agenda, súmula, sessões, ranking, XP, avaliações, premium, LGPD, RLS |
| `db/02_seed_catalog.sql` | 4 esportes, 12 modalidades, posições, eventos, métricas (com checagem de integridade no final) |
| `db/03_smoke_test.sql` | Testa tudo numa transação e desfaz (`ROLLBACK`) |
| `db/neon_setup.sql` | **Tudo num arquivo só para o Neon**: preserva tabelas antigas, cria esquema + catálogo + papel `app_rw` (sem senha) e deixa só 3 modalidades ativas |
| `db/04_app_role.sql` | Papel `app_rw` (sem `BYPASSRLS`) usado pelo servidor, para o RLS valer de verdade |
| `graphql/schema.graphql` | API completa: 26 queries, 42 mutations, 2 subscriptions |
| `mobile/` | **App Android** (Expo/React Native): gravação por GPS/sensores, fila offline, histórico e ranking. Veja `mobile/README.md` |
| `server/` | **MVP do servidor** (Node + TypeScript): conta, catálogo, sessões, ranking. Veja `server/README.md` |

```bash
createdb appdb
psql -d appdb -v ON_ERROR_STOP=1 -f db/01_schema.sql -f db/02_seed_catalog.sql
psql -d appdb -v ON_ERROR_STOP=1 -f db/03_smoke_test.sql   # opcional
```

**Validado:** o servidor MVP passa em 47 verificações ponta a ponta (`npm run e2e`); scripts SQL executados em PostgreSQL 16 sem erros, SDL GraphQL compilado com `graphql-core`, e smoke test passando (placar de tempo e de sets, pontuação do 3x3, bloqueio de evento inválido, anti-fraude, ranking, idempotência e RLS). Os testes acharam e corrigi dois bugs antes da entrega (palavra reservada `position` e concatenação de array).

## As 12 modalidades

| Esporte | Modalidade (`slug`) | Em quadra | Formato | Rastreio principal |
|---|---|---|---|---|
| Futebol | `football_field` | 11 | 2 × 45 min | GPS |
| | `football_society` | 7 | 2 × 25 min | GPS |
| | `futsal` | 5 | 2 × 20 min | Sensores |
| | `football_7` | 7 | 2 × 25 min | GPS |
| | `beach_soccer` | 5 | 3 × 12 min | GPS + sensores |
| Vôlei | `volleyball_indoor` | 6 | até 5 sets (25; 5º a 15) | Sensores (saltos) |
| | `volleyball_beach` | 2 | até 3 sets (21; 3º a 15) | Sensores (saltos) |
| | `volleyball_4x4` | 4 | até 3 sets (configurável) | Sensores (saltos) |
| Basquete | `basketball_5x5` | 5 | 4 × 10 min | Sensores |
| | `basketball_3x3` | 3 | 10 min ou 21 pts | Sensores |
| Handebol | `handball_indoor` | 7 | 2 × 30 min | Sensores |
| | `handball_beach` | 4 | 2 sets de 10 min + shoot-out | Sensores |

> **Atenção:** medidas, tempos e limites são **valores padrão editáveis**. Society, futebol 7 e vôlei 4x4 variam por organizador (marcados com `"variant":"configurable"` em `rules`; as quadras do 4x4 ficam `NULL`). Confirme com a confederação ou liga antes de usar em competição oficial.

## Decisões de projeto

**1. Motor de modalidades.** `modalities` guarda formato (`period_kind`: `time` ou `sets`), medidas e um `rules` JSONB para o que for específico (shot clock, suspensões, desempate). Posições, eventos e métricas ficam em tabelas ligadas à modalidade.

**2. Pontuação resolvida por modalidade.** O tipo de evento é do esporte (`fg_inside`, `fg_outside`), e `modality_event_types.points` sobrescreve o valor. Por isso no 3x3 a cesta de dentro vale 1 e a de fora vale 2, sem código novo. O ponto é gravado em `match_events.points` no momento do lançamento (trigger), então mudar regra depois não reescreve o histórico.

**3. Súmula à prova de erro.**
- Evento fora da modalidade é rejeitado (ex.: impedimento no futsal).
- Correção não apaga: `voided_at` anula o evento.
- `client_event_id` torna o reenvio offline idempotente.
- Gol contra credita o adversário (`credits_opponent`).
- Em vôlei, erros (`serve_error`, `attack_error`, `reception_error`) são só estatística; o ponto do adversário é lançado como `opponent_error`, para nunca contar duas vezes.

**4. Placar por view.** `v_match_scoreboard` soma pontos nos esportes de tempo e conta sets vencidos (apenas os encerrados) nos de sets. Cada tempo ou set precisa de uma linha em `match_periods`.

**5. Sessões individuais, validadas no servidor.** O app envia métricas; `fn_validate_session` checa duração mínima e limites plausíveis (por métrica e por modalidade) e `fn_compute_session_score` calcula o score. O cliente nunca define o próprio score. `UNIQUE (user_id, client_session_id)` evita duplicar sessões gravadas offline.

**6. Ranking resistente a "farm".** Soma os **20 melhores** scores válidos da temporada por modalidade (`mv_performance_scores`), filtrável por país, estado e cidade. Atualize com `REFRESH MATERIALIZED VIEW CONCURRENTLY` a cada 5–15 min.

**7. Rastreio por esporte.** GPS só onde funciona bem (campo, society, F7, areia). Em quadra coberta use acelerômetro e giroscópio (saltos, acelerações, carga) mais estatística manual. Posição exata em quadra fica para uma fase futura (beacons ou câmera).

**8. Segurança e LGPD.**
- O token vai no header `Authorization`, nunca como argumento GraphQL.
- RLS: o atleta vê só o que é dele; o treinador vê sessões e métricas dos seus atletas, **mas não a trilha GPS bruta**.
- Consentimentos versionados (`consents`), responsável legal para menores (`guardian_user_id`) e pedido de exclusão de conta.
- Use um papel de aplicação sem `BYPASSRLS` e que não seja dono das tabelas.

## Como adicionar uma modalidade (exemplo: Futevôlei)

```sql
INSERT INTO modalities (sport_id, slug, name_pt, name_en, players_on_court, squad_max,
  court_length_m, court_width_m, surface, period_kind, period_count, period_duration_min,
  scoring_unit, gps_recommended, imu_recommended, min_valid_duration_min, rules, sort_order)
SELECT id, 'footvolley', 'Futevôlei', 'Footvolley', 2, 2, 18, 9, 'sand', 'sets', 3, NULL,
       'point', false, true, 10, '{"best_of":3,"points_to_win":18,"win_by":2}', 13
FROM sports WHERE slug = 'volleyball';  -- ou crie um novo esporte
-- depois: positions, modality_event_types e modality_metrics (mesmo padrão do seed)
```

## Pendências e escolhas suas

- **Preços** em `plans` são exemplos.
- **Conteúdo** de quizzes e aulas (`practices`) está vazio; produza material próprio.
- **GraphQL:** o schema é *schema-first*. Você pode implementar com Apollo Server, Pothos ou NestJS; ou expor o banco com Hasura/PostGraphile e usar este SDL como contrato do app.
- **`@auth`** é uma diretiva declarativa: o gateway ou os resolvers precisam aplicá-la (e o RLS é a segunda barreira).
- **Particionamento:** `session_track_points` e `match_events` crescem rápido; particione por mês quando passar de dezenas de milhões de linhas.
- **Verificação de recibos** de compra (Google Play e App Store) deve ser sempre feita no servidor.

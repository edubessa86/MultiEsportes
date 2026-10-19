-- =====================================================================
-- App multiesporte de performance — esquema PostgreSQL 15+
-- Esportes: futebol, vôlei, basquete, handebol (12 modalidades)
--
-- Princípio: regras de cada modalidade são DADOS (tabelas de catálogo),
-- não código. Adicionar uma modalidade = INSERTs, sem deploy.
--
-- Ordem: este arquivo (estrutura) -> 02_seed_catalog.sql (catálogo).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- e-mail / códigos case-insensitive

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
CREATE TYPE surface_kind        AS ENUM ('grass','synthetic_grass','indoor_court','sand');
CREATE TYPE period_kind         AS ENUM ('time','sets');
CREATE TYPE tracking_source     AS ENUM ('gps','imu','manual','wearable','hr_sensor','derived');
CREATE TYPE auth_provider       AS ENUM ('password','google','apple','facebook','phone');
CREATE TYPE member_role         AS ENUM ('owner','admin','coach','statistician','athlete');
CREATE TYPE member_status       AS ENUM ('pending','active','inactive');
CREATE TYPE activity_kind       AS ENUM ('training','match','tournament','other');
CREATE TYPE rsvp_status         AS ENUM ('invited','confirmed','declined','attended','absent');
CREATE TYPE session_status      AS ENUM ('recording','processing','valid','invalid','disputed');
CREATE TYPE session_outcome     AS ENUM ('win','draw','loss');
CREATE TYPE match_status        AS ENUM ('scheduled','live','finished','cancelled');
CREATE TYPE match_side          AS ENUM ('home','away');
CREATE TYPE event_category      AS ENUM ('scoring','offense','defense','possession','discipline','administrative');
CREATE TYPE practice_kind       AS ENUM ('tactical_quiz','tactical_review','lesson');
CREATE TYPE subscription_status AS ENUM ('active','grace','expired','canceled');
CREATE TYPE payment_status      AS ENUM ('pending','paid','expired','refunded');
CREATE TYPE payment_method      AS ENUM ('pix','boleto','card','google_play','app_store','coupon');
CREATE TYPE report_status       AS ENUM ('pending','ready','failed');
CREATE TYPE consent_kind        AS ENUM ('terms','privacy','background_location','health_data','media_sharing','marketing');
CREATE TYPE dispute_status      AS ENUM ('open','reviewing','accepted','rejected');

-- ---------------------------------------------------------------------
-- UTILITÁRIOS
-- ---------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Id do usuário da requisição (a API faz: SET LOCAL app.user_id = '<uuid>')
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------
-- 1. CATÁLOGO (esportes, modalidades, posições, eventos, métricas)
-- ---------------------------------------------------------------------
CREATE TABLE sports (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name_pt     text NOT NULL,
  name_en     text NOT NULL,
  icon        text,
  sort_order  smallint NOT NULL DEFAULT 0
);

CREATE TABLE modalities (
  id                     smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_id               smallint NOT NULL REFERENCES sports(id),
  slug                   text NOT NULL UNIQUE,
  name_pt                text NOT NULL,
  name_en                text NOT NULL,
  players_on_court       smallint NOT NULL CHECK (players_on_court > 0),
  squad_max              smallint,
  court_length_m         numeric(6,1),               -- NULL = varia por organizador
  court_width_m          numeric(6,1),
  surface                surface_kind NOT NULL,
  period_kind            period_kind  NOT NULL,      -- time = tempos/quartos; sets = sets
  period_count           smallint NOT NULL,          -- nº de tempos ou nº máx. de sets
  period_duration_min    smallint,                   -- NULL em esportes de sets sem relógio
  scoring_unit           text NOT NULL,              -- goal | point
  gps_recommended        boolean NOT NULL DEFAULT false,
  imu_recommended        boolean NOT NULL DEFAULT false,  -- acelerômetro/giroscópio
  manual_stats           boolean NOT NULL DEFAULT true,
  min_valid_duration_min smallint NOT NULL DEFAULT 10,    -- sessão menor que isso é inválida
  rules                  jsonb NOT NULL DEFAULT '{}'::jsonb, -- regras extras editáveis
  is_active              boolean NOT NULL DEFAULT true,
  sort_order             smallint NOT NULL DEFAULT 0,
  CHECK (period_kind = 'sets' OR period_duration_min IS NOT NULL)
);
CREATE INDEX modalities_sport_idx ON modalities(sport_id);

CREATE TABLE positions (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  modality_id smallint NOT NULL REFERENCES modalities(id) ON DELETE CASCADE,
  code        text NOT NULL,
  label_pt    text NOT NULL,
  label_en    text NOT NULL,
  sort_order  smallint NOT NULL DEFAULT 0,
  UNIQUE (modality_id, code)
);

-- Tipos de evento por ESPORTE; modalidades escolhem quais usam (e podem mudar a pontuação)
CREATE TABLE event_types (
  id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_id          smallint NOT NULL REFERENCES sports(id),
  code              text NOT NULL,
  label_pt          text NOT NULL,
  label_en          text NOT NULL,
  category          event_category NOT NULL,
  default_points    smallint NOT NULL DEFAULT 0,
  credits_opponent  boolean NOT NULL DEFAULT false,  -- ex.: gol contra
  UNIQUE (sport_id, code)
);

CREATE TABLE modality_event_types (
  modality_id   smallint NOT NULL REFERENCES modalities(id) ON DELETE CASCADE,
  event_type_id smallint NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  points        smallint,                            -- NULL = usa default_points
  PRIMARY KEY (modality_id, event_type_id)
);

CREATE TABLE metric_definitions (
  id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              text NOT NULL UNIQUE,
  label_pt          text NOT NULL,
  label_en          text NOT NULL,
  unit              text NOT NULL,
  source            tracking_source NOT NULL,
  plausible_min     numeric NOT NULL DEFAULT 0,      -- limites anti-fraude globais
  plausible_max     numeric NOT NULL,
  higher_is_better  boolean NOT NULL DEFAULT true
);

CREATE TABLE modality_metrics (
  modality_id           smallint NOT NULL REFERENCES modalities(id) ON DELETE CASCADE,
  metric_id             smallint NOT NULL REFERENCES metric_definitions(id) ON DELETE CASCADE,
  is_primary            boolean NOT NULL DEFAULT false, -- aparece em destaque no app
  weight                numeric(4,2) NOT NULL DEFAULT 0 CHECK (weight >= 0), -- peso no score (0 = só exibe)
  reference_value       numeric,                        -- valor que equivale a 100% do componente
  plausible_max_override numeric,                       -- sobrescreve o limite global
  PRIMARY KEY (modality_id, metric_id)
);

-- ---------------------------------------------------------------------
-- 2. USUÁRIOS E AUTENTICAÇÃO
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext UNIQUE,
  phone            text UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  full_name        text NOT NULL,
  display_name     text,
  birthdate        date,
  picture_url      text,
  locale           text NOT NULL DEFAULT 'pt-BR',
  location_cc      char(2),            -- país
  location_admin1  text,               -- estado
  location_admin2  text,               -- cidade
  guardian_user_id uuid REFERENCES users(id),  -- responsável legal (menores de 18, LGPD art. 14)
  premium_until    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX users_location_idx ON users(location_cc, location_admin1, location_admin2) WHERE deleted_at IS NULL;

CREATE TABLE auth_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      auth_provider NOT NULL,
  provider_uid  text NOT NULL,          -- e-mail, sub do Google/Apple, telefone...
  password_hash text,                   -- argon2id; só para provider = password
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE phone_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('whatsapp','sms')),
  code_hash   text NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_verifications_phone_idx ON phone_verifications(phone, created_at DESC);

-- Header Authorization (JWT curto) + refresh token rotativo; o token NUNCA vai como argumento GraphQL
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  device_info text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  platform   text NOT NULL CHECK (platform IN ('android','ios')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Perfil multiesporte: um usuário pode praticar várias modalidades
CREATE TABLE user_modalities (
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modality_id          smallint NOT NULL REFERENCES modalities(id),
  primary_position_id  smallint REFERENCES positions(id),
  dominant_side        text CHECK (dominant_side IN ('left','right','both')),
  level                text CHECK (level IN ('beginner','amateur','semi_pro','pro')),
  is_favorite          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, modality_id)
);

-- ---------------------------------------------------------------------
-- 3. ORGANIZAÇÕES, TIMES, LOCAIS, TEMPORADAS
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       citext NOT NULL UNIQUE,
  kind       text NOT NULL DEFAULT 'club' CHECK (kind IN ('club','school','academy','league','other')),
  logo_url   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            member_role NOT NULL DEFAULT 'athlete',
  status          member_status NOT NULL DEFAULT 'pending',
  started_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE venues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  address         text,
  latitude        double precision,
  longitude       double precision,
  surface         surface_kind
);

-- Temporadas globais (organization_id NULL) alimentam o ranking público;
-- temporadas de organização servem a campeonatos internos.
CREATE TABLE seasons (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  CHECK (ends_on > starts_on)
);

CREATE TABLE teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  modality_id     smallint NOT NULL REFERENCES modalities(id),
  name            text NOT NULL,
  invite_code     citext NOT NULL UNIQUE DEFAULT upper(substr(encode(gen_random_bytes(5),'hex'),1,8)),
  logo_url        text,
  color           text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);
CREATE INDEX teams_org_idx ON teams(organization_id);

CREATE TABLE team_members (
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          member_role NOT NULL DEFAULT 'athlete',
  status        member_status NOT NULL DEFAULT 'active',
  jersey_number smallint CHECK (jersey_number BETWEEN 0 AND 99),
  position_id   smallint REFERENCES positions(id),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members(user_id);

-- Períodos letivos/competitivos do time (equivale aos "schedules" do app de referência)
CREATE TABLE team_periods (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name      text NOT NULL,
  starts_on date NOT NULL,
  ends_on   date NOT NULL,
  CHECK (ends_on >= starts_on)
);

CREATE TABLE team_training_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = domingo
  start_time   time NOT NULL,
  duration_min smallint NOT NULL CHECK (duration_min > 0),
  venue_id     uuid REFERENCES venues(id)
);

-- Agenda: treino, jogo, torneio
CREATE TABLE team_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind        activity_kind NOT NULL,
  title       text NOT NULL,
  description text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  venue_id    uuid REFERENCES venues(id),
  created_by  uuid REFERENCES users(id),
  cancelled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX team_activities_team_time_idx ON team_activities(team_id, starts_at DESC);

CREATE TABLE activity_attendance (
  team_activity_id uuid NOT NULL REFERENCES team_activities(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rsvp             rsvp_status NOT NULL DEFAULT 'invited',
  checked_in_at    timestamptz,
  PRIMARY KEY (team_activity_id, user_id)
);

CREATE TABLE activity_media (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_activity_id uuid NOT NULL REFERENCES team_activities(id) ON DELETE CASCADE,
  uploaded_by      uuid REFERENCES users(id),
  url              text NOT NULL,
  width            integer,
  height           integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. PARTIDAS (súmula digital)
-- ---------------------------------------------------------------------
CREATE TABLE matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_activity_id uuid REFERENCES team_activities(id) ON DELETE SET NULL,
  modality_id      smallint NOT NULL REFERENCES modalities(id),
  home_team_id     uuid REFERENCES teams(id),
  away_team_id     uuid REFERENCES teams(id),
  home_name        text NOT NULL,          -- permite adversário sem cadastro
  away_name        text NOT NULL,
  status           match_status NOT NULL DEFAULT 'scheduled',
  scheduled_at     timestamptz,
  started_at       timestamptz,
  ended_at         timestamptz,
  venue_id         uuid REFERENCES venues(id),
  scorekeeper_id   uuid REFERENCES users(id),   -- quem lança a súmula
  final_home_score integer,                     -- preenchido ao finalizar (congelado)
  final_away_score integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matches_home_idx ON matches(home_team_id, scheduled_at DESC);
CREATE INDEX matches_away_idx ON matches(away_team_id, scheduled_at DESC);

-- Um registro por tempo/quarto/set. Para esportes de sets, a pontuação do set vem dos eventos.
CREATE TABLE match_periods (
  match_id   uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  period_no  smallint NOT NULL CHECK (period_no > 0),
  started_at timestamptz,
  ended_at   timestamptz,
  PRIMARY KEY (match_id, period_no)
);

CREATE TABLE match_lineups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side          match_side NOT NULL,
  user_id       uuid REFERENCES users(id),   -- NULL = jogador não cadastrado
  display_name  text NOT NULL,
  jersey_number smallint,
  position_id   smallint REFERENCES positions(id),
  is_starter    boolean NOT NULL DEFAULT false
);
CREATE INDEX match_lineups_match_idx ON match_lineups(match_id);
CREATE INDEX match_lineups_user_idx ON match_lineups(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE match_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id          uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  period_no         smallint NOT NULL,
  side              match_side NOT NULL,
  event_type_id     smallint NOT NULL REFERENCES event_types(id),
  lineup_id         uuid REFERENCES match_lineups(id),
  related_lineup_id uuid REFERENCES match_lineups(id),  -- ex.: quem deu a assistência
  clock_s           integer,                             -- segundos no relógio (esportes de tempo)
  points            smallint,                            -- preenchido por trigger se NULL
  x                 numeric(5,2) CHECK (x BETWEEN 0 AND 100),  -- posição normalizada na quadra
  y                 numeric(5,2) CHECK (y BETWEEN 0 AND 100),
  created_by        uuid REFERENCES users(id),
  client_event_id   uuid,                                -- idempotência para sync offline
  voided_at         timestamptz,                         -- correção sem apagar histórico
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (match_id, period_no) REFERENCES match_periods(match_id, period_no),
  UNIQUE (match_id, client_event_id)
);
CREATE INDEX match_events_match_idx ON match_events(match_id, period_no);
CREATE INDEX match_events_lineup_idx ON match_events(lineup_id);

-- Resolve os pontos do evento a partir da modalidade (override) ou do padrão do tipo
CREATE FUNCTION fn_fill_event_points() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.points IS NULL THEN
    SELECT COALESCE(met.points, et.default_points)
      INTO NEW.points
      FROM event_types et
      JOIN matches m ON m.id = NEW.match_id
      LEFT JOIN modality_event_types met
             ON met.event_type_id = et.id AND met.modality_id = m.modality_id
     WHERE et.id = NEW.event_type_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER match_events_points BEFORE INSERT ON match_events
  FOR EACH ROW EXECUTE FUNCTION fn_fill_event_points();

-- Garante que o evento pertence à modalidade da partida
CREATE FUNCTION fn_check_event_allowed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM matches m
    JOIN modality_event_types met ON met.modality_id = m.modality_id
   WHERE m.id = NEW.match_id AND met.event_type_id = NEW.event_type_id) THEN
    RAISE EXCEPTION 'event_type % is not allowed for this match modality', NEW.event_type_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER match_events_allowed BEFORE INSERT ON match_events
  FOR EACH ROW EXECUTE FUNCTION fn_check_event_allowed();

-- Pontos por lado que pontuou (gol contra credita o adversário)
CREATE VIEW v_match_event_points AS
SELECT e.match_id,
       e.period_no,
       CASE WHEN et.credits_opponent
            THEN (CASE e.side WHEN 'home' THEN 'away'::match_side ELSE 'home'::match_side END)
            ELSE e.side END AS scoring_side,
       e.points
  FROM match_events e
  JOIN event_types et ON et.id = e.event_type_id
 WHERE e.voided_at IS NULL AND e.points > 0;

CREATE VIEW v_match_period_scores AS
SELECT match_id, period_no,
       COALESCE(SUM(points) FILTER (WHERE scoring_side = 'home'), 0)::int AS home_points,
       COALESCE(SUM(points) FILTER (WHERE scoring_side = 'away'), 0)::int AS away_points
  FROM v_match_event_points
 GROUP BY match_id, period_no;

-- Placar: esportes de tempo somam pontos; esportes de sets contam sets vencidos (encerrados)
CREATE VIEW v_match_scoreboard AS
SELECT m.id AS match_id,
       mo.period_kind,
       (CASE WHEN mo.period_kind = 'sets'
             THEN COUNT(*) FILTER (WHERE p.ended_at IS NOT NULL AND ps.home_points > ps.away_points)
             ELSE COALESCE(SUM(ps.home_points), 0) END)::int AS home_score,
       (CASE WHEN mo.period_kind = 'sets'
             THEN COUNT(*) FILTER (WHERE p.ended_at IS NOT NULL AND ps.away_points > ps.home_points)
             ELSE COALESCE(SUM(ps.away_points), 0) END)::int AS away_score
  FROM matches m
  JOIN modalities mo ON mo.id = m.modality_id
  LEFT JOIN match_periods p ON p.match_id = m.id
  LEFT JOIN v_match_period_scores ps ON ps.match_id = p.match_id AND ps.period_no = p.period_no
 GROUP BY m.id, mo.period_kind;

-- Totais por atleta e tipo de evento (base das estatísticas individuais)
CREATE VIEW v_athlete_event_totals AS
SELECT l.user_id, m.modality_id, et.code AS event_code,
       COUNT(*)::int AS occurrences, COALESCE(SUM(e.points), 0)::int AS points
  FROM match_events e
  JOIN match_lineups l ON l.id = e.lineup_id
  JOIN matches m       ON m.id = e.match_id
  JOIN event_types et  ON et.id = e.event_type_id
 WHERE e.voided_at IS NULL AND l.user_id IS NOT NULL
 GROUP BY l.user_id, m.modality_id, et.code;

-- ---------------------------------------------------------------------
-- 5. SESSÕES DE ATIVIDADE (rastreamento individual)
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modality_id      smallint NOT NULL REFERENCES modalities(id),
  team_activity_id uuid REFERENCES team_activities(id) ON DELETE SET NULL,
  match_id         uuid REFERENCES matches(id) ON DELETE SET NULL,
  venue_id         uuid REFERENCES venues(id),
  client_session_id uuid NOT NULL,            -- idempotência: app offline reenvia sem duplicar
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  duration_s       integer GENERATED ALWAYS AS (
                     (EXTRACT(EPOCH FROM (ended_at - started_at)))::integer) STORED,
  source           tracking_source NOT NULL,  -- fonte principal: gps, imu, manual, wearable
  device_kind      text CHECK (device_kind IN ('phone','wear_os','apple_watch','other')),
  status           session_status NOT NULL DEFAULT 'processing',
  invalid_reasons  text[] NOT NULL DEFAULT '{}',
  score            numeric(6,2),
  rpe              smallint CHECK (rpe BETWEEN 1 AND 10),      -- PSE (percepção de esforço)
  feeling          smallint CHECK (feeling BETWEEN 1 AND 5),
  outcome          session_outcome,
  points_for       smallint,
  points_against   smallint,
  heatmap_url      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_session_id),
  CHECK (ended_at IS NULL OR ended_at > started_at)
);
CREATE INDEX sessions_user_time_idx ON sessions(user_id, started_at DESC);
CREATE INDEX sessions_ranking_idx   ON sessions(modality_id, started_at) WHERE status = 'valid';

CREATE TABLE session_metrics (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  metric_id  smallint NOT NULL REFERENCES metric_definitions(id),
  value      numeric NOT NULL,
  PRIMARY KEY (session_id, metric_id)
);

-- Pontos de GPS (futebol de campo/society/F7/areia). Em escala, particione por mês.
CREATE TABLE session_track_points (
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  recorded_at timestamptz NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy_m  real,
  speed_ms    real,
  PRIMARY KEY (session_id, seq)
);

-- Eventos de movimento detectados por sensores (saltos, sprints, acelerações)
CREATE TABLE session_motion_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('jump','sprint','acceleration','deceleration','change_of_direction')),
  occurred_at timestamptz NOT NULL,
  value       numeric,        -- altura (cm), velocidade (km/h) ou intensidade (g)
  duration_ms integer
);
CREATE INDEX session_motion_events_idx ON session_motion_events(session_id, kind);

CREATE TABLE session_disputes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  message    text NOT NULL,
  status     dispute_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Score normalizado (0–150): média ponderada de valor/referência (cada componente limitado a 150%)
CREATE FUNCTION fn_compute_session_score(p_session uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN COALESCE(SUM(mm.weight), 0) = 0 THEN NULL
              ELSE ROUND(100 * SUM(mm.weight * LEAST(sm.value / mm.reference_value, 1.5))
                             / SUM(mm.weight), 2) END
    FROM sessions s
    JOIN session_metrics sm  ON sm.session_id = s.id
    JOIN modality_metrics mm ON mm.modality_id = s.modality_id AND mm.metric_id = sm.metric_id
   WHERE s.id = p_session AND mm.weight > 0 AND mm.reference_value > 0
$$;

-- Validação anti-fraude no servidor: duração mínima e limites plausíveis por métrica/modalidade
CREATE FUNCTION fn_validate_session(p_session uuid) RETURNS session_status
LANGUAGE plpgsql AS $$
DECLARE
  s         sessions%ROWTYPE;
  v_min     smallint;
  v_reasons text[] := '{}';
  r         record;
  v_status  session_status;
BEGIN
  SELECT * INTO s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'session % not found', p_session; END IF;

  SELECT min_valid_duration_min INTO v_min FROM modalities WHERE id = s.modality_id;
  IF s.duration_s IS NULL OR s.duration_s < v_min * 60 THEN
    v_reasons := array_append(v_reasons, 'duration_too_short');
  END IF;

  FOR r IN
    SELECT md.code, sm.value, md.plausible_min,
           COALESCE(mm.plausible_max_override, md.plausible_max) AS pmax
      FROM session_metrics sm
      JOIN metric_definitions md ON md.id = sm.metric_id
      LEFT JOIN modality_metrics mm
             ON mm.modality_id = s.modality_id AND mm.metric_id = sm.metric_id
     WHERE sm.session_id = p_session
  LOOP
    IF r.value < r.plausible_min OR r.value > r.pmax THEN
      v_reasons := array_append(v_reasons, 'implausible_' || r.code);
    END IF;
  END LOOP;
  -- Extensão sugerida: checar saltos de posição/velocidade em session_track_points.

  v_status := CASE WHEN cardinality(v_reasons) = 0 THEN 'valid' ELSE 'invalid' END;
  UPDATE sessions
     SET status = v_status,
         invalid_reasons = v_reasons,
         score = CASE WHEN v_status = 'valid' THEN fn_compute_session_score(p_session) END
   WHERE id = p_session;
  RETURN v_status;
END $$;

-- ---------------------------------------------------------------------
-- 6. GAMIFICAÇÃO: XP, PRÁTICAS (quizzes/aulas), RANKINGS
-- ---------------------------------------------------------------------
CREATE TABLE practices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   practice_kind NOT NULL,
  sport_id               smallint REFERENCES sports(id),       -- NULL = todos
  modality_id            smallint REFERENCES modalities(id),   -- NULL = todo o esporte
  title_pt               text NOT NULL,
  title_en               text,
  card_image_url         text,
  base_xp                integer NOT NULL DEFAULT 10 CHECK (base_xp >= 0),
  requires_premium       boolean NOT NULL DEFAULT false,
  starts_at              timestamptz,
  ends_at                timestamptz,
  unlocks_after_practice uuid REFERENCES practices(id),
  unlock_popup           jsonb,                                 -- {title, message} por idioma
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quiz_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id    uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  position       smallint NOT NULL,
  question_pt     text NOT NULL,
  question_en     text,
  image_url      text,
  options        jsonb NOT NULL,       -- [{"value":"a","label_pt":"...","label_en":"..."}]
  correct_option text NOT NULL,
  explanation_pt text,
  UNIQUE (practice_id, position)
);

CREATE TABLE practice_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  uuid NOT NULL REFERENCES practices(id),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        numeric(5,2),
  answers      jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, user_id)
);

CREATE TABLE xp_entries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      integer NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('practice','session','match','assessment','streak','review','manual')),
  source_ref  uuid,
  modality_id smallint REFERENCES modalities(id),
  season_id   integer REFERENCES seasons(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_kind, source_ref)      -- evita XP duplicado
);
CREATE INDEX xp_entries_user_idx   ON xp_entries(user_id, created_at DESC);
CREATE INDEX xp_entries_season_idx ON xp_entries(season_id, user_id);

-- Ranking de desempenho: soma dos 20 melhores scores válidos do atleta na temporada
-- (limitar a N evita "farmar" volume). Atualize com REFRESH ... CONCURRENTLY (cron a cada 5–15 min).
CREATE MATERIALIZED VIEW mv_performance_scores AS
WITH ranked AS (
  SELECT s.user_id, s.modality_id, se.id AS season_id, s.score,
         row_number() OVER (PARTITION BY s.user_id, s.modality_id, se.id
                            ORDER BY s.score DESC) AS rn
    FROM sessions s
    JOIN seasons se ON se.organization_id IS NULL
                   AND s.started_at >= se.starts_on
                   AND s.started_at <  (se.ends_on + 1)
   WHERE s.status = 'valid' AND s.score IS NOT NULL
)
SELECT user_id, modality_id, season_id,
       SUM(score)::numeric(10,2) AS total_score,
       COUNT(*)::int             AS sessions_counted
  FROM ranked
 WHERE rn <= 20
 GROUP BY user_id, modality_id, season_id;
CREATE UNIQUE INDEX mv_performance_scores_pk ON mv_performance_scores(user_id, modality_id, season_id);

-- Ranking por modalidade/temporada, filtrável por país/estado/cidade
CREATE FUNCTION fn_ranking_performance(
  p_modality smallint, p_season integer,
  p_cc char(2) DEFAULT NULL, p_admin1 text DEFAULT NULL, p_admin2 text DEFAULT NULL,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE (rank_pos bigint, user_id uuid, total_score numeric, sessions_counted integer)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT rank() OVER (ORDER BY mv.total_score DESC) AS rank_pos,
           mv.user_id, mv.total_score, mv.sessions_counted
      FROM mv_performance_scores mv
      JOIN users u ON u.id = mv.user_id AND u.deleted_at IS NULL
     WHERE mv.modality_id = p_modality AND mv.season_id = p_season
       AND (p_cc     IS NULL OR u.location_cc     = p_cc)
       AND (p_admin1 IS NULL OR u.location_admin1 = p_admin1)
       AND (p_admin2 IS NULL OR u.location_admin2 = p_admin2)
  ) t
  ORDER BY rank_pos, user_id
  LIMIT p_limit OFFSET p_offset
$$;

-- Ranking de XP (global ou por temporada)
CREATE FUNCTION fn_ranking_xp(
  p_season integer DEFAULT NULL, p_modality smallint DEFAULT NULL,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE (rank_pos bigint, user_id uuid, total_xp bigint)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT rank() OVER (ORDER BY SUM(x.amount) DESC) AS rank_pos,
           x.user_id, SUM(x.amount)::bigint AS total_xp
      FROM xp_entries x
      JOIN users u ON u.id = x.user_id AND u.deleted_at IS NULL
     WHERE (p_season   IS NULL OR x.season_id   = p_season)
       AND (p_modality IS NULL OR x.modality_id = p_modality)
     GROUP BY x.user_id
  ) t
  ORDER BY rank_pos, user_id
  LIMIT p_limit OFFSET p_offset
$$;

-- ---------------------------------------------------------------------
-- 7. AVALIAÇÕES TÉCNICAS (por treinador, configuráveis por modalidade)
-- ---------------------------------------------------------------------
CREATE TABLE assessment_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,   -- NULL = modelo global
  modality_id smallint NOT NULL REFERENCES modalities(id),
  position_id smallint REFERENCES positions(id),             -- critérios específicos de posição
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assessment_criteria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES assessment_templates(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  smallint NOT NULL DEFAULT 0
);

CREATE TABLE assessment_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criterion_id uuid NOT NULL REFERENCES assessment_criteria(id) ON DELETE CASCADE,
  label        text NOT NULL,
  value        smallint NOT NULL
);

CREATE TABLE assessment_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES assessment_templates(id),
  criterion_id  uuid NOT NULL REFERENCES assessment_criteria(id),
  athlete_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluator_id  uuid NOT NULL REFERENCES users(id),
  option_id     uuid NOT NULL REFERENCES assessment_options(id),
  app_score     numeric(5,2),     -- nota calculada pelo app (dados de sessões)
  coach_score   numeric(5,2),     -- nota do treinador
  evaluated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assessment_results_athlete_idx ON assessment_results(athlete_id, evaluated_at DESC);

-- ---------------------------------------------------------------------
-- 8. RELATÓRIOS E NOTIFICAÇÕES
-- ---------------------------------------------------------------------
CREATE TABLE generated_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES users(id),
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  athlete_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES generated_reports(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('athlete','team','season','match')),
  title       text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      report_status NOT NULL DEFAULT 'pending',
  file_url    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 9. PREMIUM, PAGAMENTOS E CUPONS
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  currency      char(3) NOT NULL DEFAULT 'BRL',
  period_months smallint NOT NULL CHECK (period_months > 0),
  store_product_id text            -- id do produto no Google Play / App Store
);

CREATE TABLE subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     smallint NOT NULL REFERENCES plans(id),
  status      subscription_status NOT NULL,
  method      payment_method NOT NULL,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  external_ref text
);
CREATE INDEX subscriptions_user_idx ON subscriptions(user_id, expires_at DESC);

-- Recibos das lojas (validar SEMPRE no servidor com as APIs do Google/Apple)
CREATE TABLE store_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  store               text NOT NULL CHECK (store IN ('google_play','app_store')),
  product_id          text NOT NULL,
  external_order_id   text NOT NULL,
  purchase_token_hash text NOT NULL,
  raw                 jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store, external_order_id)
);

-- Cobranças Pix/boleto (escolas e responsáveis)
CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id      uuid NOT NULL REFERENCES users(id),
  athlete_id    uuid REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  description   text NOT NULL,
  amount_cents  integer NOT NULL CHECK (amount_cents > 0),
  method        payment_method NOT NULL,
  status        payment_status NOT NULL DEFAULT 'pending',
  expires_at    timestamptz,
  pix_payload   text,            -- "copia e cola"
  boleto_url    text,
  receipt_url   text,
  external_id   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_payer_idx ON payments(payer_id, status);

CREATE TABLE coupons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               citext NOT NULL UNIQUE,
  premium_days       integer NOT NULL CHECK (premium_days > 0),
  max_redemptions    integer,
  redeemed_count     integer NOT NULL DEFAULT 0,
  organization_id    uuid REFERENCES organizations(id),
  expires_at         timestamptz
);

CREATE TABLE coupon_redemptions (
  coupon_id   uuid NOT NULL REFERENCES coupons(id),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, user_id)
);

CREATE FUNCTION fn_is_premium(p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT premium_until > now() FROM users WHERE id = p_user), false)
$$;

-- ---------------------------------------------------------------------
-- 10. CONFORMIDADE (LGPD), SUPORTE E AUDITORIA
-- ---------------------------------------------------------------------
CREATE TABLE consents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       consent_kind NOT NULL,
  version    text NOT NULL,
  granted    boolean NOT NULL,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_idx ON consents(user_id, kind, created_at DESC);

CREATE TABLE data_deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE support_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  email      citext NOT NULL,
  message    text NOT NULL,
  is_premium boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id  uuid,
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text,
  diff      jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY (exemplos; a API usa SET LOCAL app.user_id)
-- Use um papel de aplicação SEM BYPASSRLS e dono diferente das tabelas.
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_is_coach_of_user(p_athlete uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM team_members me
      JOIN team_members ath ON ath.team_id = me.team_id AND ath.user_id = p_athlete
     WHERE me.user_id = app_user_id()
       AND me.role IN ('owner','admin','coach')
       AND me.status = 'active')
$$;

ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_track_points  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents              ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_owner  ON sessions FOR ALL
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY sessions_coach  ON sessions FOR SELECT
  USING (fn_is_coach_of_user(user_id));

CREATE POLICY metrics_owner   ON session_metrics FOR ALL
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_id AND s.user_id = app_user_id()));
CREATE POLICY metrics_coach   ON session_metrics FOR SELECT
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_id AND fn_is_coach_of_user(s.user_id)));

-- Trilha GPS é dado sensível: só o dono (treinador vê o mapa de calor, não a trilha bruta)
CREATE POLICY track_owner     ON session_track_points FOR ALL
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_id AND s.user_id = app_user_id()));

CREATE POLICY notifications_owner ON notifications FOR ALL USING (user_id = app_user_id());
CREATE POLICY consents_owner      ON consents      FOR ALL USING (user_id = app_user_id());

COMMIT;

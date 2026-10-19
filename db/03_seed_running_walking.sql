-- MultiEsportes: catálogo inicial de Corrida e Caminhada.
-- Executar uma vez após db/02_seed_catalog.sql.
-- Idempotente: pode ser executado novamente sem duplicar esportes/modalidades.
-- Organiza Corrida e Caminhada no grupo Livre e mantém ativas as modalidades de futebol aprovadas.
-- Pré-requisito: executar db/03a_add_outdoor_surface.sql em uma transação separada
-- e confirmar o commit antes de executar este arquivo.

BEGIN;

INSERT INTO sports (slug, name_pt, name_en, icon, sort_order)
VALUES
  ('free', 'Livre', 'Outdoor activities', '🏃', 2)
ON CONFLICT (slug) DO UPDATE
SET name_pt = EXCLUDED.name_pt,
    name_en = EXCLUDED.name_en,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order;

-- Corrida e Caminhada são atividades individuais cronometradas.
-- Não há dimensões de quadra; GPS é recomendado, mas o catálogo não exige GPS.
INSERT INTO modalities (
  sport_id, slug, name_pt, name_en, players_on_court, squad_max,
  court_length_m, court_width_m, surface, period_kind, period_count,
  period_duration_min, scoring_unit, gps_recommended, imu_recommended,
  manual_stats, min_valid_duration_min, rules, is_active, sort_order
)
SELECT s.id, v.slug, v.name_pt, v.name_en, 1, 1,
       NULL, NULL, 'outdoor'::surface_kind, 'time'::period_kind, 1,
       1, 'activity', true, true, true, 1, v.rules::jsonb, true, v.sort_order
FROM (VALUES
  ('free', 'running', 'Corrida', 'Running',
   '{"activityType":"running","distanceUnit":"km","paceUnit":"min/km","speedUnit":"km/h","gpsTracking":true,"autoPauseSupported":true,"splitsKm":true,"heartRateOptional":true}', 20),
  ('free', 'walking', 'Caminhada', 'Walking',
   '{"activityType":"walking","distanceUnit":"km","paceUnit":"min/km","speedUnit":"km/h","gpsTracking":true,"autoPauseSupported":true,"splitsKm":true,"heartRateOptional":true}', 21)
) AS v(sport_slug, slug, name_pt, name_en, rules, sort_order)
JOIN sports s ON s.slug = v.sport_slug
ON CONFLICT (slug) DO UPDATE
SET sport_id = EXCLUDED.sport_id,
    name_pt = EXCLUDED.name_pt,
    name_en = EXCLUDED.name_en,
    players_on_court = 1,
    squad_max = 1,
    court_length_m = NULL,
    court_width_m = NULL,
    surface = 'outdoor'::surface_kind,
    period_kind = 'time'::period_kind,
    period_count = 1,
    period_duration_min = 1,
    scoring_unit = 'activity',
    gps_recommended = true,
    imu_recommended = true,
    manual_stats = true,
    min_valid_duration_min = 1,
    rules = EXCLUDED.rules,
    is_active = true,
    sort_order = EXCLUDED.sort_order;

-- Métricas de corrida/caminhada. As médias podem ser calculadas a partir de
-- distância e tempo; o melhor pace exige uma trilha GPS suficientemente boa.
INSERT INTO metric_definitions
  (code, label_pt, label_en, unit, source, plausible_min, plausible_max, higher_is_better)
VALUES
  ('avg_pace_min_km', 'Pace médio', 'Average pace', 'min/km', 'derived', 0, 60, false),
  ('best_pace_min_km', 'Melhor pace por trecho', 'Best split pace', 'min/km', 'gps', 0, 60, false),
  ('elapsed_time_s', 'Duração total', 'Elapsed duration', 's', 'derived', 0, 86400, false)
ON CONFLICT (code) DO UPDATE
SET label_pt = EXCLUDED.label_pt,
    label_en = EXCLUDED.label_en,
    unit = EXCLUDED.unit,
    source = EXCLUDED.source,
    plausible_min = EXCLUDED.plausible_min,
    plausible_max = EXCLUDED.plausible_max,
    higher_is_better = EXCLUDED.higher_is_better;

-- Associa as métricas comuns já existentes e as novas métricas.
-- Peso 0: estas métricas são exibidas e analisadas, mas não distorcem o score
-- genérico de performance, que não é apropriado para corrida/caminhada.
INSERT INTO modality_metrics
  (modality_id, metric_id, is_primary, weight, reference_value, plausible_max_override)
SELECT m.id, md.id,
       md.code IN ('distance_total_m', 'avg_pace_min_km', 'avg_speed_kmh', 'active_time_s'),
       0, NULL, NULL
FROM modalities m
JOIN metric_definitions md ON md.code IN (
  'distance_total_m', 'avg_speed_kmh', 'max_speed_kmh', 'active_time_s',
  'avg_pace_min_km', 'best_pace_min_km', 'elapsed_time_s',
  'heart_rate_avg', 'heart_rate_max'
)
WHERE m.slug IN ('running', 'walking')
ON CONFLICT (modality_id, metric_id) DO UPDATE
SET is_primary = EXCLUDED.is_primary,
    weight = 0,
    reference_value = NULL,
    plausible_max_override = NULL;

-- Mantém ativas as três modalidades de futebol e as duas atividades livres.
UPDATE modalities
SET is_active = (slug IN ('football_field', 'football_society', 'futsal', 'running', 'walking'));

-- Garante que corrida e caminhada sejam exibidas sob o grupo Livre.
UPDATE modalities
SET sport_id = (SELECT id FROM sports WHERE slug = 'free')
WHERE slug IN ('running', 'walking');

COMMIT;

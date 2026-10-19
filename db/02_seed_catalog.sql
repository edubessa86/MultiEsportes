-- =====================================================================
-- Catálogo inicial: 4 esportes, 12 modalidades.
-- IMPORTANTE: medidas, tempos e limites são VALORES PADRÃO EDITÁVEIS.
-- Confirme com a confederação/liga de cada modalidade antes de usar em
-- competição oficial (society, futebol 7 e vôlei 4x4 variam por organizador).
-- Rodar depois de 01_schema.sql.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- ESPORTES
-- ---------------------------------------------------------------------
INSERT INTO sports (slug, name_pt, name_en, icon, sort_order) VALUES
  ('football',   'Futebol',  'Football',   '⚽', 1),
  ('volleyball', 'Vôlei',    'Volleyball', '🏐', 2),
  ('basketball', 'Basquete', 'Basketball', '🏀', 3),
  ('handball',   'Handebol', 'Handball',   '🤾', 4);

-- ---------------------------------------------------------------------
-- MODALIDADES
-- period_kind='time'  -> period_count = nº de tempos/quartos, duration em minutos
-- period_kind='sets'  -> period_count = nº máximo de sets
-- ---------------------------------------------------------------------
INSERT INTO modalities (
  sport_id, slug, name_pt, name_en, players_on_court, squad_max,
  court_length_m, court_width_m, surface, period_kind, period_count,
  period_duration_min, scoring_unit, gps_recommended, imu_recommended,
  manual_stats, min_valid_duration_min, rules, sort_order)
SELECT s.id, v.slug, v.name_pt, v.name_en, v.players, v.squad,
       v.len, v.wid, v.surface::surface_kind, v.pkind::period_kind, v.pcount,
       v.pdur, v.unit, v.gps, v.imu, true, v.mind, v.rules::jsonb, v.ord
FROM (VALUES
  -- ===== FUTEBOL =====
  ('football','football_field',   'Futebol de campo',  'Football (11-a-side)', 11, 23, 105, 68,   'grass',           'time', 2, 45,   'goal', true,  true,  20,
     '{"offside":true,"extra_time":true,"penalty_shootout":true,"substitutions":{"max":5}}', 1),
  ('football','football_society', 'Futebol Society',   'Society football',      7, 12,  50, 30,   'synthetic_grass','time', 2, 25,   'goal', true,  true,  15,
     '{"variant":"configurable","players_range":[6,8],"offside":false,"flying_substitutions":true}', 2),
  ('football','futsal',           'Futsal',            'Futsal',                5, 14,  40, 20,   'indoor_court',   'time', 2, 20,   'goal', false, true,  10,
     '{"clock":"stopped","team_foul_limit":5,"flying_substitutions":true,"goalkeeper_as_field_player":true}', 3),
  ('football','football_7',       'Futebol 7',         'Football 7-a-side',     7, 14,  60, 40,   'synthetic_grass','time', 2, 25,   'goal', true,  true,  15,
     '{"variant":"configurable","flying_substitutions":true}', 4),
  ('football','beach_soccer',     'Futebol de areia',  'Beach soccer',          5, 12,  37, 28,   'sand',           'time', 3, 12,   'goal', true,  true,  10,
     '{"clock":"stopped","flying_substitutions":true,"no_draws":true,"penalty_shootout":true}', 5),

  -- ===== VÔLEI =====
  ('volleyball','volleyball_indoor','Vôlei de quadra', 'Indoor volleyball',     6, 12,  18,  9,   'indoor_court',   'sets', 5, NULL, 'point', false, true,  10,
     '{"best_of":5,"points_to_win":25,"decider_points":15,"win_by":2,"rotation":true,"libero":true}', 6),
  ('volleyball','volleyball_beach', 'Vôlei de praia',  'Beach volleyball',      2,  2,  16,  8,   'sand',           'sets', 3, NULL, 'point', false, true,  10,
     '{"best_of":3,"points_to_win":21,"decider_points":15,"win_by":2,"rotation":false,"libero":false,"side_switch_every_points":7}', 7),
  ('volleyball','volleyball_4x4',   'Vôlei 4x4',       '4-a-side volleyball',   4,  8, NULL, NULL, 'indoor_court',   'sets', 3, NULL, 'point', false, true,  10,
     '{"variant":"configurable","best_of":3,"points_to_win":25,"decider_points":15,"win_by":2}', 8),

  -- ===== BASQUETE =====
  ('basketball','basketball_5x5',   'Basquete tradicional','5-on-5 basketball', 5, 12,  28, 15,   'indoor_court',   'time', 4, 10,   'point', false, true,  10,
     '{"shot_clock_s":24,"player_foul_limit":5,"team_foul_bonus":5,"overtime_min":5}', 9),
  ('basketball','basketball_3x3',   'Basquete 3x3',    '3x3 basketball',        3,  4,  15, 11,   'indoor_court',   'time', 1, 10,   'point', false, true,  5,
     '{"shot_clock_s":12,"target_score":21,"overtime":"first_to_2_points","team_foul_bonus":7,"half_court":true}', 10),

  -- ===== HANDEBOL =====
  ('handball','handball_indoor',    'Handebol de quadra','Indoor handball',     7, 16,  40, 20,   'indoor_court',   'time', 2, 30,   'goal', false, true,  15,
     '{"suspension_min":2,"seven_meter":true,"team_timeouts":3,"extra_time":true}', 11),
  ('handball','handball_beach',     'Beach handball',  'Beach handball',        4, 10,  27, 12,   'sand',           'sets', 2, 10,   'goal', false, true,  10,
     '{"sets":2,"set_duration_min":10,"shootout_if_tied":true,"special_goal_points":2,"goalkeeper_goal_points":2}', 12)
) AS v(sport_slug, slug, name_pt, name_en, players, squad, len, wid, surface, pkind,
       pcount, pdur, unit, gps, imu, mind, rules, ord)
JOIN sports s ON s.slug = v.sport_slug;

-- ---------------------------------------------------------------------
-- POSIÇÕES
-- ---------------------------------------------------------------------
-- Futebol de campo
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('GK','Goleiro','Goalkeeper',1), ('CB','Zagueiro','Centre-back',2),
  ('LB','Lateral esquerdo','Left-back',3), ('RB','Lateral direito','Right-back',4),
  ('DM','Volante','Defensive midfielder',5), ('CM','Meia central','Central midfielder',6),
  ('AM','Meia ofensivo','Attacking midfielder',7), ('LW','Ponta esquerda','Left winger',8),
  ('RW','Ponta direita','Right winger',9), ('ST','Centroavante','Striker',10)
) AS v(code, pt, en, ord) WHERE m.slug = 'football_field';

-- Society (fixo/ala/pivô)
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('GK','Goleiro','Goalkeeper',1), ('DEF','Fixo','Last defender',2),
  ('WNG','Ala','Winger',3), ('FWD','Pivô / Atacante','Forward',4)
) AS v(code, pt, en, ord) WHERE m.slug = 'football_society';

-- Futebol 7
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('GK','Goleiro','Goalkeeper',1), ('DEF','Defensor','Defender',2),
  ('MID','Meia','Midfielder',3), ('FWD','Atacante','Forward',4)
) AS v(code, pt, en, ord) WHERE m.slug = 'football_7';

-- Futsal e futebol de areia
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('GK','Goleiro','Goalkeeper',1), ('FIXO','Fixo','Last defender',2),
  ('ALA','Ala','Winger',3), ('PIVO','Pivô','Pivot',4)
) AS v(code, pt, en, ord) WHERE m.slug IN ('futsal','beach_soccer');

-- Vôlei de quadra
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('SET','Levantador','Setter',1), ('OH','Ponteiro','Outside hitter',2),
  ('OPP','Oposto','Opposite',3), ('MB','Central','Middle blocker',4),
  ('LIB','Líbero','Libero',5)
) AS v(code, pt, en, ord) WHERE m.slug = 'volleyball_indoor';

-- Vôlei de praia
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('BLK','Bloqueador','Blocker',1), ('DEF','Defensor','Defender',2)
) AS v(code, pt, en, ord) WHERE m.slug = 'volleyball_beach';

-- Vôlei 4x4
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('SET','Levantador','Setter',1), ('ATK','Atacante','Attacker',2), ('DEF','Defensor','Defender',3)
) AS v(code, pt, en, ord) WHERE m.slug = 'volleyball_4x4';

-- Basquete tradicional
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('PG','Armador','Point guard',1), ('SG','Ala-armador','Shooting guard',2),
  ('SF','Ala','Small forward',3), ('PF','Ala-pivô','Power forward',4), ('C','Pivô','Center',5)
) AS v(code, pt, en, ord) WHERE m.slug = 'basketball_5x5';

-- Basquete 3x3
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('GRD','Armador','Guard',1), ('FWD','Ala','Forward',2), ('BIG','Pivô','Big',3)
) AS v(code, pt, en, ord) WHERE m.slug = 'basketball_3x3';

-- Handebol de quadra
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('GK','Goleiro','Goalkeeper',1), ('LW','Ponta esquerda','Left wing',2),
  ('LB','Armador esquerdo','Left back',3), ('CB','Armador central','Centre back',4),
  ('RB','Armador direito','Right back',5), ('RW','Ponta direita','Right wing',6),
  ('PV','Pivô','Pivot',7)
) AS v(code, pt, en, ord) WHERE m.slug = 'handball_indoor';

-- Beach handball
INSERT INTO positions (modality_id, code, label_pt, label_en, sort_order)
SELECT m.id, v.code, v.pt, v.en, v.ord FROM modalities m, (VALUES
  ('GK','Goleiro','Goalkeeper',1), ('SPEC','Especialista','Specialist',2),
  ('WNG','Ala','Wing',3), ('PV','Pivô','Pivot',4), ('DEF','Defensor','Defender',5)
) AS v(code, pt, en, ord) WHERE m.slug = 'handball_beach';

-- ---------------------------------------------------------------------
-- TIPOS DE EVENTO (por esporte)
-- Regra de ouro da súmula: estatística de erro (serve_error, attack_error,
-- reception_error) NÃO pontua; o ponto do adversário é lançado à parte
-- (opponent_error), para nunca contar o mesmo ponto duas vezes.
-- ---------------------------------------------------------------------
INSERT INTO event_types (sport_id, code, label_pt, label_en, category, default_points, credits_opponent)
SELECT s.id, v.code, v.pt, v.en, v.cat::event_category, v.pts, v.opp
FROM (VALUES
  -- ===== Futebol (campo, society, futsal, F7, areia) =====
  ('football','goal',            'Gol',                 'Goal',              'scoring',       1, false),
  ('football','own_goal',        'Gol contra',          'Own goal',          'scoring',       1, true),
  ('football','penalty_goal',    'Pênalti convertido',  'Penalty scored',    'scoring',       1, false),
  ('football','penalty_missed',  'Pênalti perdido',     'Penalty missed',    'offense',       0, false),
  ('football','assist',          'Assistência',         'Assist',            'offense',       0, false),
  ('football','shot_on_target',  'Finalização no gol',  'Shot on target',    'offense',       0, false),
  ('football','shot_off_target', 'Finalização para fora','Shot off target',  'offense',       0, false),
  ('football','save',            'Defesa',              'Save',              'defense',       0, false),
  ('football','foul',            'Falta',               'Foul',              'discipline',    0, false),
  ('football','offside',         'Impedimento',         'Offside',           'discipline',    0, false),
  ('football','yellow_card',     'Cartão amarelo',      'Yellow card',       'discipline',    0, false),
  ('football','red_card',        'Cartão vermelho',     'Red card',          'discipline',    0, false),
  ('football','substitution',    'Substituição',        'Substitution',      'administrative',0, false),
  ('football','timeout',         'Pedido de tempo',     'Timeout',           'administrative',0, false),

  -- ===== Vôlei (quadra, praia, 4x4) =====
  ('volleyball','ace',             'Ace',                  'Ace',               'scoring',    1, false),
  ('volleyball','attack_kill',     'Ponto de ataque',      'Attack kill',       'scoring',    1, false),
  ('volleyball','block_point',     'Ponto de bloqueio',    'Block point',       'scoring',    1, false),
  ('volleyball','opponent_error',  'Erro do adversário',   'Opponent error',    'scoring',    1, false),
  ('volleyball','set_assist',      'Passe para ataque',    'Set assist',        'offense',    0, false),
  ('volleyball','dig',             'Defesa (dig)',         'Dig',               'defense',    0, false),
  ('volleyball','serve_error',     'Erro de saque',        'Serve error',       'offense',    0, false),
  ('volleyball','attack_error',    'Erro de ataque',       'Attack error',      'offense',    0, false),
  ('volleyball','reception_error', 'Erro de recepção',     'Reception error',   'defense',    0, false),
  ('volleyball','yellow_card',     'Cartão amarelo',       'Yellow card',       'discipline', 0, false),
  ('volleyball','red_card',        'Cartão vermelho',      'Red card',          'discipline', 0, false),
  ('volleyball','substitution',    'Substituição',         'Substitution',      'administrative', 0, false),
  ('volleyball','timeout',         'Pedido de tempo',      'Timeout',           'administrative', 0, false),

  -- ===== Basquete (5x5 e 3x3) =====
  -- Códigos genéricos: fg_inside vale 2 (5x5) ou 1 (3x3); fg_outside vale 3 (5x5) ou 2 (3x3)
  ('basketball','fg_inside',       'Cesta dentro do arco', 'Field goal inside arc',  'scoring',  2, false),
  ('basketball','fg_outside',      'Cesta de fora do arco','Field goal outside arc', 'scoring',  3, false),
  ('basketball','free_throw',      'Lance livre convertido','Free throw made',       'scoring',  1, false),
  ('basketball','fg_missed',       'Arremesso errado',     'Field goal missed',      'offense',  0, false),
  ('basketball','ft_missed',       'Lance livre errado',   'Free throw missed',      'offense',  0, false),
  ('basketball','rebound_off',     'Rebote ofensivo',      'Offensive rebound',      'possession',0, false),
  ('basketball','rebound_def',     'Rebote defensivo',     'Defensive rebound',      'possession',0, false),
  ('basketball','assist',          'Assistência',          'Assist',                 'offense',  0, false),
  ('basketball','steal',           'Roubo de bola',        'Steal',                  'defense',  0, false),
  ('basketball','block',           'Toco',                 'Block',                  'defense',  0, false),
  ('basketball','turnover',        'Desperdício de posse', 'Turnover',               'possession',0, false),
  ('basketball','foul_personal',   'Falta pessoal',        'Personal foul',          'discipline',0, false),
  ('basketball','foul_technical',  'Falta técnica',        'Technical foul',         'discipline',0, false),
  ('basketball','substitution',    'Substituição',         'Substitution',           'administrative',0, false),
  ('basketball','timeout',         'Pedido de tempo',      'Timeout',                'administrative',0, false),

  -- ===== Handebol (quadra e beach) =====
  ('handball','goal',               'Gol',                      'Goal',                'scoring',    1, false),
  ('handball','seven_meter_goal',   'Gol de 7 metros',          'Seven-metre goal',    'scoring',    1, false),
  ('handball','goal_special',       'Gol especial (beach)',     'Special goal (beach)','scoring',    2, false),
  ('handball','goalkeeper_goal',    'Gol do goleiro (beach)',   'Goalkeeper goal (beach)','scoring', 2, false),
  ('handball','seven_meter_missed', 'Sete metros perdido',      'Seven-metre missed',  'offense',    0, false),
  ('handball','assist',             'Assistência',              'Assist',              'offense',    0, false),
  ('handball','shot_saved',         'Defesa do goleiro',        'Shot saved',          'defense',    0, false),
  ('handball','shot_missed',        'Arremesso errado',         'Shot missed',         'offense',    0, false),
  ('handball','steal',              'Roubo de bola',            'Steal',               'defense',    0, false),
  ('handball','block',              'Bloqueio',                 'Block',               'defense',    0, false),
  ('handball','turnover',           'Desperdício de posse',     'Turnover',            'possession', 0, false),
  ('handball','suspension_2min',    'Suspensão de 2 min',       '2-minute suspension', 'discipline', 0, false),
  ('handball','yellow_card',        'Cartão amarelo',           'Yellow card',         'discipline', 0, false),
  ('handball','red_card',           'Cartão vermelho',          'Red card',            'discipline', 0, false),
  ('handball','substitution',       'Substituição',             'Substitution',        'administrative', 0, false),
  ('handball','timeout',            'Pedido de tempo',          'Timeout',             'administrative', 0, false)
) AS v(sport_slug, code, pt, en, cat, pts, opp)
JOIN sports s ON s.slug = v.sport_slug;

-- Quais eventos cada modalidade usa (padrão: todos do esporte, menos as exceções)
INSERT INTO modality_event_types (modality_id, event_type_id)
SELECT m.id, e.id
  FROM modalities m
  JOIN event_types e ON e.sport_id = m.sport_id
 WHERE NOT (e.code = 'offside'      AND m.slug <> 'football_field')
   AND NOT (e.code = 'timeout'      AND m.slug IN ('football_field','football_society','football_7'))
   AND NOT (e.code IN ('goal_special','goalkeeper_goal') AND m.slug <> 'handball_beach')
   AND NOT (e.code = 'substitution' AND m.slug = 'volleyball_beach')
   AND NOT (e.code IN ('seven_meter_goal','seven_meter_missed') AND m.slug = 'handball_beach');

-- Pontuação diferente no basquete 3x3 (dentro do arco = 1, fora do arco = 2)
UPDATE modality_event_types met
   SET points = CASE e.code WHEN 'fg_inside' THEN 1 WHEN 'fg_outside' THEN 2 END
  FROM modalities m, event_types e
 WHERE met.modality_id = m.id AND m.slug = 'basketball_3x3'
   AND met.event_type_id = e.id AND e.code IN ('fg_inside','fg_outside');

-- ---------------------------------------------------------------------
-- MÉTRICAS
-- ---------------------------------------------------------------------
INSERT INTO metric_definitions (code, label_pt, label_en, unit, source, plausible_min, plausible_max, higher_is_better)
SELECT v.code, v.pt, v.en, v.unit, v.src::tracking_source, v.pmin, v.pmax, true
FROM (VALUES
  ('distance_total_m',          'Distância total',              'Total distance',             'm',     'gps',       0,   20000),
  ('avg_speed_kmh',             'Velocidade média',             'Average speed',              'km/h',  'gps',       0,   15),
  ('max_speed_kmh',             'Velocidade máxima',            'Top speed',                  'km/h',  'gps',       0,   40),
  ('sprint_count',              'Sprints',                      'Sprints',                    'count', 'imu',       0,   150),
  ('high_intensity_distance_m', 'Distância em alta intensidade','High-intensity distance',    'm',     'gps',       0,   5000),
  ('accel_count',               'Acelerações',                  'Accelerations',              'count', 'imu',       0,   400),
  ('decel_count',               'Desacelerações',               'Decelerations',              'count', 'imu',       0,   400),
  ('jump_count',                'Saltos',                       'Jumps',                      'count', 'imu',       0,   500),
  ('jump_height_avg_cm',        'Altura média de salto',        'Average jump height',        'cm',    'imu',       0,   120),
  ('player_load',               'Carga do atleta',              'Player load',                'au',    'imu',       0,   2000),
  ('active_time_s',             'Tempo ativo',                  'Active time',                's',     'derived',   0,   14400),
  ('heart_rate_avg',            'Frequência cardíaca média',    'Average heart rate',         'bpm',   'hr_sensor', 30,  220),
  ('heart_rate_max',            'Frequência cardíaca máxima',   'Max heart rate',             'bpm',   'hr_sensor', 30,  230)
) AS v(code, pt, en, unit, src, pmin, pmax);

-- Métricas por modalidade: (is_primary, peso no score, valor de referência = 100%, limite plausível próprio)
INSERT INTO modality_metrics (modality_id, metric_id, is_primary, weight, reference_value, plausible_max_override)
SELECT m.id, md.id, v.prim, v.w, v.ref, v.pmax
FROM (VALUES
  -- Futebol de campo (GPS)
  ('football_field','distance_total_m',          true,  3.0, 9000, NULL),
  ('football_field','max_speed_kmh',             true,  1.5, 30,   NULL),
  ('football_field','sprint_count',              true,  2.0, 25,   NULL),
  ('football_field','high_intensity_distance_m', false, 1.5, 700,  NULL),
  ('football_field','accel_count',               false, 1.0, 80,   NULL),
  ('football_field','avg_speed_kmh',             false, 0,   NULL, NULL),
  -- Society (GPS)
  ('football_society','distance_total_m',          true,  3.0, 5000, 12000),
  ('football_society','max_speed_kmh',             true,  1.5, 28,   NULL),
  ('football_society','sprint_count',              true,  2.0, 20,   NULL),
  ('football_society','high_intensity_distance_m', false, 1.5, 400,  NULL),
  ('football_society','accel_count',               false, 1.0, 80,   NULL),
  -- Futebol 7 (GPS)
  ('football_7','distance_total_m',          true,  3.0, 6000, 14000),
  ('football_7','max_speed_kmh',             true,  1.5, 28,   NULL),
  ('football_7','sprint_count',              true,  2.0, 20,   NULL),
  ('football_7','high_intensity_distance_m', false, 1.5, 450,  NULL),
  ('football_7','accel_count',               false, 1.0, 80,   NULL),
  -- Futsal (sensores; GPS indoor é pouco confiável -> peso baixo)
  ('futsal','accel_count',      true,  2.0, 120, NULL),
  ('futsal','decel_count',      true,  2.0, 120, NULL),
  ('futsal','sprint_count',     true,  2.0, 25,  80),
  ('futsal','player_load',      true,  2.0, 300, NULL),
  ('futsal','distance_total_m', false, 0.5, 3500, 8000),
  -- Futebol de areia
  ('beach_soccer','distance_total_m', true,  2.0, 3000, 8000),
  ('beach_soccer','sprint_count',     true,  1.5, 15,   60),
  ('beach_soccer','accel_count',      true,  1.5, 80,   NULL),
  ('beach_soccer','player_load',      true,  2.0, 300,  NULL),
  ('beach_soccer','jump_count',       false, 0.5, 20,   NULL),
  -- Vôlei de quadra
  ('volleyball_indoor','jump_count',         true,  3.0, 80,  300),
  ('volleyball_indoor','jump_height_avg_cm', true,  2.0, 45,  NULL),
  ('volleyball_indoor','accel_count',        false, 1.0, 100, NULL),
  ('volleyball_indoor','player_load',        false, 1.5, 250, NULL),
  -- Vôlei de praia
  ('volleyball_beach','jump_count',         true,  3.0, 60,  250),
  ('volleyball_beach','jump_height_avg_cm', true,  2.0, 40,  NULL),
  ('volleyball_beach','accel_count',        false, 1.0, 100, NULL),
  ('volleyball_beach','player_load',        false, 1.5, 250, NULL),
  -- Vôlei 4x4
  ('volleyball_4x4','jump_count',         true,  3.0, 60,  250),
  ('volleyball_4x4','jump_height_avg_cm', true,  2.0, 40,  NULL),
  ('volleyball_4x4','accel_count',        false, 1.0, 100, NULL),
  ('volleyball_4x4','player_load',        false, 1.5, 250, NULL),
  -- Basquete 5x5
  ('basketball_5x5','accel_count',  true,  2.0, 150, NULL),
  ('basketball_5x5','decel_count',  true,  2.0, 150, NULL),
  ('basketball_5x5','player_load',  true,  2.0, 400, NULL),
  ('basketball_5x5','jump_count',   false, 1.5, 40,  NULL),
  ('basketball_5x5','sprint_count', false, 1.5, 30,  80),
  -- Basquete 3x3
  ('basketball_3x3','accel_count',  true,  2.0, 100, NULL),
  ('basketball_3x3','decel_count',  true,  2.0, 100, NULL),
  ('basketball_3x3','player_load',  true,  2.0, 300, NULL),
  ('basketball_3x3','jump_count',   false, 1.5, 30,  NULL),
  ('basketball_3x3','sprint_count', false, 1.5, 25,  80),
  -- Handebol de quadra
  ('handball_indoor','accel_count',  true,  2.0, 150, NULL),
  ('handball_indoor','decel_count',  true,  2.0, 150, NULL),
  ('handball_indoor','player_load',  true,  2.0, 400, NULL),
  ('handball_indoor','jump_count',   false, 1.5, 40,  NULL),
  ('handball_indoor','sprint_count', false, 1.5, 30,  80),
  -- Beach handball
  ('handball_beach','jump_count',   true,  2.0, 40,  NULL),
  ('handball_beach','accel_count',  true,  2.0, 100, NULL),
  ('handball_beach','player_load',  true,  2.0, 300, NULL),
  ('handball_beach','sprint_count', false, 1.5, 20,  60)
) AS v(mslug, mcode, prim, w, ref, pmax)
JOIN modalities m ON m.slug = v.mslug
JOIN metric_definitions md ON md.code = v.mcode;

-- Métricas opcionais (frequência cardíaca, tempo ativo): disponíveis em todas, sem peso no score
INSERT INTO modality_metrics (modality_id, metric_id, is_primary, weight)
SELECT m.id, md.id, false, 0
  FROM modalities m
  CROSS JOIN metric_definitions md
 WHERE md.code IN ('heart_rate_avg','heart_rate_max','active_time_s')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- DADOS INICIAIS DE OPERAÇÃO (exemplos — ajuste preços e datas)
-- ---------------------------------------------------------------------
INSERT INTO seasons (name, starts_on, ends_on) VALUES ('Temporada 2026', '2026-01-01', '2026-12-31');

INSERT INTO plans (code, name, price_cents, currency, period_months) VALUES
  ('premium_monthly', 'Premium mensal (exemplo)', 1490,  'BRL', 1),
  ('premium_annual',  'Premium anual (exemplo)',  14900, 'BRL', 12);

-- ---------------------------------------------------------------------
-- VERIFICAÇÕES: falha a migração se o catálogo estiver incompleto
-- ---------------------------------------------------------------------
DO $$
DECLARE n_sports int; n_mod int; n_noevents int; n_nopos int; n_nometric int;
BEGIN
  SELECT count(*) INTO n_sports FROM sports;
  SELECT count(*) INTO n_mod    FROM modalities;
  IF n_sports <> 4 OR n_mod <> 12 THEN
    RAISE EXCEPTION 'catálogo incompleto: % esportes, % modalidades', n_sports, n_mod;
  END IF;

  SELECT count(*) INTO n_noevents FROM modalities m
   WHERE NOT EXISTS (SELECT 1 FROM modality_event_types x WHERE x.modality_id = m.id);
  SELECT count(*) INTO n_nopos FROM modalities m
   WHERE NOT EXISTS (SELECT 1 FROM positions x WHERE x.modality_id = m.id);
  SELECT count(*) INTO n_nometric FROM modalities m
   WHERE NOT EXISTS (SELECT 1 FROM modality_metrics x WHERE x.modality_id = m.id AND x.weight > 0);
  IF n_noevents + n_nopos + n_nometric > 0 THEN
    RAISE EXCEPTION 'modalidades sem eventos (%), posições (%) ou métricas com peso (%)',
      n_noevents, n_nopos, n_nometric;
  END IF;
END $$;

COMMIT;

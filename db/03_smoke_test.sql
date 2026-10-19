-- =====================================================================
-- Teste de fumaça: roda tudo em UMA transação e faz ROLLBACK no final.
-- Uso: psql -d <db> -v ON_ERROR_STOP=1 -f 03_smoke_test.sql
-- Cobre: catálogo, pontuação por modalidade, súmula (tempo e sets),
-- bloqueio de evento inválido, anti-fraude, ranking, idempotência e RLS.
-- Rode como superusuário/dono do banco (cria um papel temporário).
-- =====================================================================
BEGIN;
\pset format aligned
\echo '--- 1) Catálogo: modalidades ---'
SELECT s.slug sport, m.slug, m.players_on_court p, m.period_kind pk, m.period_count pc, m.period_duration_min dur,
       (SELECT count(*) FROM positions x WHERE x.modality_id=m.id) pos,
       (SELECT count(*) FROM modality_event_types x WHERE x.modality_id=m.id) ev,
       (SELECT count(*) FROM modality_metrics x WHERE x.modality_id=m.id AND weight>0) met
FROM modalities m JOIN sports s ON s.id=m.sport_id ORDER BY m.sort_order;

\echo '--- 2) Pontos resolvidos por modalidade (5x5 vs 3x3) ---'
SELECT m.slug, e.code, COALESCE(met.points,e.default_points) pts
FROM modality_event_types met JOIN modalities m ON m.id=met.modality_id JOIN event_types e ON e.id=met.event_type_id
WHERE m.slug IN ('basketball_5x5','basketball_3x3','handball_beach','handball_indoor') AND e.code IN ('fg_inside','fg_outside','goal','goal_special')
ORDER BY 1,2;

\echo '--- 3) Súmula futsal (tempo) com gol contra ---'
INSERT INTO users(id,full_name,email) VALUES ('00000000-0000-0000-0000-0000000000a1','Atleta Teste','a@x.com');
INSERT INTO matches(id,modality_id,home_name,away_name,status) SELECT '10000000-0000-0000-0000-000000000001',id,'Casa','Fora','live' FROM modalities WHERE slug='futsal';
INSERT INTO match_periods(match_id,period_no,started_at) VALUES ('10000000-0000-0000-0000-000000000001',1,now()),('10000000-0000-0000-0000-000000000001',2,now());
INSERT INTO match_lineups(id,match_id,side,user_id,display_name) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','home','00000000-0000-0000-0000-0000000000a1','Atleta Teste');
INSERT INTO match_events(match_id,period_no,side,event_type_id,lineup_id,clock_s)
SELECT '10000000-0000-0000-0000-000000000001',1,'home',id,'20000000-0000-0000-0000-000000000001',300 FROM event_types e WHERE sport_id=(SELECT id FROM sports WHERE slug='football') AND code='goal';
INSERT INTO match_events(match_id,period_no,side,event_type_id,clock_s)
SELECT '10000000-0000-0000-0000-000000000001',2,'home',id,900 FROM event_types e WHERE sport_id=(SELECT id FROM sports WHERE slug='football') AND code='own_goal';
SELECT home_score, away_score, '(esperado 1 x 1: gol do mandante + gol contra do mandante)' nota FROM v_match_scoreboard WHERE match_id='10000000-0000-0000-0000-000000000001';

\echo '--- 4) Evento proibido para a modalidade deve falhar (impedimento no futsal) ---'
DO $$ BEGIN
  INSERT INTO match_events(match_id,period_no,side,event_type_id)
  SELECT '10000000-0000-0000-0000-000000000001',1,'home',id FROM event_types WHERE code='offside';
  RAISE NOTICE 'ERRO: deveria ter falhado';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK: bloqueado -> %', SQLERRM; END $$;

\echo '--- 5) Súmula vôlei (sets): 2 sets fechados, 1º para casa 25-0, 2º para visitante 25-0 ---'
INSERT INTO matches(id,modality_id,home_name,away_name,status) SELECT '10000000-0000-0000-0000-000000000002',id,'A','B','live' FROM modalities WHERE slug='volleyball_indoor';
INSERT INTO match_periods(match_id,period_no,started_at,ended_at) VALUES ('10000000-0000-0000-0000-000000000002',1,now(),now()),('10000000-0000-0000-0000-000000000002',2,now(),now()),('10000000-0000-0000-0000-000000000002',3,now(),NULL);
INSERT INTO match_events(match_id,period_no,side,event_type_id)
SELECT '10000000-0000-0000-0000-000000000002',1,'home',e.id FROM event_types e, generate_series(1,25) WHERE e.code='ace' AND e.sport_id=(SELECT id FROM sports WHERE slug='volleyball');
INSERT INTO match_events(match_id,period_no,side,event_type_id)
SELECT '10000000-0000-0000-0000-000000000002',2,'away',e.id FROM event_types e, generate_series(1,25) WHERE e.code='attack_kill';
INSERT INTO match_events(match_id,period_no,side,event_type_id)
SELECT '10000000-0000-0000-0000-000000000002',3,'home',e.id FROM event_types e, generate_series(1,5) WHERE e.code='ace' AND e.sport_id=(SELECT id FROM sports WHERE slug='volleyball');
SELECT home_score sets_casa, away_score sets_fora, '(esperado 1 x 1; set 3 em andamento não conta)' nota FROM v_match_scoreboard WHERE match_id='10000000-0000-0000-0000-000000000002';

\echo '--- 6) Basquete 3x3: cesta dentro do arco vale 1, fora vale 2 ---'
INSERT INTO matches(id,modality_id,home_name,away_name) SELECT '10000000-0000-0000-0000-000000000003',id,'A','B' FROM modalities WHERE slug='basketball_3x3';
INSERT INTO match_periods(match_id,period_no) VALUES ('10000000-0000-0000-0000-000000000003',1);
INSERT INTO match_events(match_id,period_no,side,event_type_id) SELECT '10000000-0000-0000-0000-000000000003',1,'home',id FROM event_types WHERE code IN ('fg_inside','fg_outside');
SELECT string_agg(et.code||'='||e.points, ', ') eventos, (SELECT home_score FROM v_match_scoreboard WHERE match_id='10000000-0000-0000-0000-000000000003') placar_casa
FROM match_events e JOIN event_types et ON et.id=e.event_type_id WHERE e.match_id='10000000-0000-0000-0000-000000000003';

\echo '--- 7) Validação anti-fraude + score ---'
INSERT INTO sessions(id,user_id,modality_id,client_session_id,started_at,ended_at,source)
SELECT '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1',id,gen_random_uuid(),'2026-03-10 10:00+00','2026-03-10 11:30+00','gps' FROM modalities WHERE slug='football_field';
INSERT INTO session_metrics SELECT '30000000-0000-0000-0000-000000000001',id,v FROM metric_definitions JOIN (VALUES ('distance_total_m',9000),('max_speed_kmh',30),('sprint_count',25),('high_intensity_distance_m',700),('accel_count',80)) t(c,v) ON c=code;
SELECT fn_validate_session('30000000-0000-0000-0000-000000000001') status;
SELECT status, score, '(esperado valid / 100.00)' nota FROM sessions WHERE id='30000000-0000-0000-0000-000000000001';

INSERT INTO sessions(id,user_id,modality_id,client_session_id,started_at,ended_at,source)
SELECT '30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1',id,gen_random_uuid(),'2026-03-11 10:00+00','2026-03-11 10:05+00','gps' FROM modalities WHERE slug='football_field';
INSERT INTO session_metrics SELECT '30000000-0000-0000-0000-000000000002',id,v FROM metric_definitions JOIN (VALUES ('max_speed_kmh',95),('distance_total_m',30000)) t(c,v) ON c=code;
SELECT fn_validate_session('30000000-0000-0000-0000-000000000002') status;
SELECT status, invalid_reasons, score FROM sessions WHERE id='30000000-0000-0000-0000-000000000002';

\echo '--- 8) Ranking e idempotência do app offline ---'
REFRESH MATERIALIZED VIEW mv_performance_scores;
SELECT * FROM fn_ranking_performance((SELECT id FROM modalities WHERE slug='football_field'), 1);
DO $$ BEGIN
  INSERT INTO sessions(user_id,modality_id,client_session_id,started_at,ended_at,source)
  SELECT '00000000-0000-0000-0000-0000000000a1',modality_id,'11111111-1111-1111-1111-111111111111','2026-04-01 10:00+00','2026-04-01 11:00+00','gps' FROM sessions WHERE id='30000000-0000-0000-0000-000000000001';
  INSERT INTO sessions(user_id,modality_id,client_session_id,started_at,ended_at,source)
  SELECT '00000000-0000-0000-0000-0000000000a1',modality_id,'11111111-1111-1111-1111-111111111111','2026-04-01 10:00+00','2026-04-01 11:00+00','gps' FROM sessions WHERE id='30000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'ERRO: reenvio duplicou';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK: reenvio com mesmo clientSessionId bloqueado'; END $$;

-- ---------- RLS ----------
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
INSERT INTO users(id,full_name,email) VALUES ('00000000-0000-0000-0000-0000000000b2','Outro Atleta','b@x.com'),('00000000-0000-0000-0000-0000000000c3','Treinador','c@x.com') ON CONFLICT DO NOTHING;
INSERT INTO sessions(user_id,modality_id,client_session_id,started_at,ended_at,source)
SELECT '00000000-0000-0000-0000-0000000000b2',id,gen_random_uuid(),'2026-05-01 10:00+00','2026-05-01 11:00+00','gps' FROM modalities WHERE slug='football_field';
-- time: treinador c3 e atleta b2 no mesmo time
INSERT INTO teams(id,modality_id,name) SELECT '40000000-0000-0000-0000-000000000001',id,'Time' FROM modalities WHERE slug='football_field';
INSERT INTO team_members(team_id,user_id,role) VALUES ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2','athlete'),('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c3','coach');
RESET ROLE;
SET ROLE app_rw;
\echo '--- atleta a1 vê só as próprias sessões ---'
SET app.user_id = '00000000-0000-0000-0000-0000000000a1';
SELECT count(*) AS sessoes_visiveis_a1, count(*) FILTER (WHERE user_id='00000000-0000-0000-0000-0000000000a1') AS proprias FROM sessions;
\echo '--- treinador c3 vê sessões do atleta b2 (mesmo time), mas não as de a1 ---'
SET app.user_id = '00000000-0000-0000-0000-0000000000c3';
SELECT count(*) AS visiveis_c3, bool_and(user_id='00000000-0000-0000-0000-0000000000b2') AS so_do_b2 FROM sessions;
\echo '--- trilha GPS: treinador NÃO vê (só o dono) ---'
SELECT count(*) AS trilhas_visiveis_c3 FROM session_track_points;
\echo '--- sem usuário na sessão: nada visível ---'
RESET app.user_id; SET app.user_id = '';
SELECT count(*) AS visiveis_anonimo FROM sessions;

RESET ROLE;
ROLLBACK;

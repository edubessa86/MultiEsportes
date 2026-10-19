-- =====================================================================
-- Papel da aplicação (usado pelo servidor GraphQL).
-- Sem BYPASSRLS e sem ser dono das tabelas => o RLS do 01_schema.sql vale.
-- ATENÇÃO: a senha abaixo é SÓ para desenvolvimento local. Em produção,
-- crie o papel com senha forte, fora do repositório.
-- Rodar depois de 01_schema.sql e 02_seed_catalog.sql.
-- =====================================================================
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN PASSWORD 'app_rw_dev_password' NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_rw;

-- Catálogo é somente leitura para a aplicação (muda por migração, não pela API)
REVOKE INSERT, UPDATE, DELETE ON
  sports, modalities, positions, event_types, modality_event_types,
  metric_definitions, modality_metrics, plans
FROM app_rw;

-- Atualiza o ranking sem dar à aplicação a posse da materialized view
CREATE OR REPLACE FUNCTION fn_refresh_rankings() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_performance_scores;
END $$;
REVOKE ALL ON FUNCTION fn_refresh_rankings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_refresh_rankings() TO app_rw;

COMMIT;

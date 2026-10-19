-- MultiEsportes: ativa Futebol de campo, Society e Salão; agrupa Corrida e Caminhada em Livre.
-- Aplicar uma vez no banco de produção após as migrations de catálogo.
-- Idempotente: pode ser executada novamente com segurança.

BEGIN;

INSERT INTO sports (slug, name_pt, name_en, icon, sort_order)
VALUES ('free', 'Livre', 'Outdoor activities', '🏃', 2)
ON CONFLICT (slug) DO UPDATE
SET name_pt = EXCLUDED.name_pt,
    name_en = EXCLUDED.name_en,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order;

-- Corrida e Caminhada pertencem ao grupo Livre.
UPDATE modalities
SET sport_id = (SELECT id FROM sports WHERE slug = 'free')
WHERE slug IN ('running', 'walking');

-- Ativa somente as modalidades solicitadas nesta etapa.
-- As demais modalidades permanecem inativas.
UPDATE modalities
SET is_active = (slug IN ('football_field', 'football_society', 'futsal', 'running', 'walking'));

COMMIT;

-- Executar e confirmar esta migração separadamente antes de db/03_seed_running_walking.sql.
-- O enum original cobre superfícies de quadra/campo; 'outdoor' representa corrida/caminhada.
ALTER TYPE surface_kind ADD VALUE IF NOT EXISTS 'outdoor';

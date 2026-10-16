import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { GraphQLError, Kind, parse } from 'graphql';
import { createSchema, createYoga } from 'graphql-yoga';
import { config } from './config.js';
import { pool } from './db.js';
import { verifyAccessToken } from './auth.js';
import type { Ctx } from './context.js';
import { catalogResolvers } from './resolvers/catalog.js';
import { accountResolvers } from './resolvers/accounts.js';
import { sessionResolvers } from './resolvers/sessions.js';
import { rankingResolvers } from './resolvers/ranking.js';

console.log("Lendo schema GraphQL...");
const typeDefs = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');
const doc = parse(typeDefs);

// Enums: o SDL usa GPS, WEAR_OS...; o banco usa 'gps', 'wear_os'...
const enums: Record<string, Record<string, string>> = {};
for (const d of doc.definitions) {
  if (d.kind === Kind.ENUM_TYPE_DEFINITION)
    enums[d.name.value] = Object.fromEntries((d.values ?? []).map((v) => [v.name.value, v.name.value.toLowerCase()]));
}
if (enums.Language) {
  enums.Language.PT_BR = 'pt-BR';
  enums.Language.EN = 'en';
}

// Junta os resolvers dos módulos
const modules = [catalogResolvers, accountResolvers, sessionResolvers, rankingResolvers] as Record<string, any>[];
const resolvers: Record<string, any> = { ...enums };
for (const m of modules) for (const [type, fields] of Object.entries(m)) resolvers[type] = { ...(resolvers[type] ?? {}), ...fields };

// Tudo que está no SDL mas ainda não tem resolver responde com um erro claro
const notImplemented = () => {
  throw new GraphQLError('Ainda não implementado no MVP.', { extensions: { code: 'NOT_IMPLEMENTED' } });
};
const pending: string[] = [];
for (const d of doc.definitions) {
  if (d.kind !== Kind.OBJECT_TYPE_DEFINITION || !['Query', 'Mutation'].includes(d.name.value)) continue;
  for (const f of d.fields ?? []) {
    resolvers[d.name.value] ??= {};
    if (!resolvers[d.name.value][f.name.value]) {
      resolvers[d.name.value][f.name.value] = notImplemented;
      pending.push(`${d.name.value}.${f.name.value}`);
    }
  }
}

// Função para garantir que a tabela, o índice único e os desportos existem
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sports (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sort_order INT DEFAULT 0
      );
    `);

    // Garante o índice único na coluna name para o ON CONFLICT funcionar
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS sports_name_idx ON sports (name);
    `);

    await pool.query(`
      INSERT INTO sports (name, sort_order) VALUES 
      ('Futebol Campo', 1),
      ('Futebol Salão', 2),
      ('Futebol Society', 3)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Compatibilidade com o catálogo GraphQL: cria/atualiza o slug dos esportes.
    await pool.query(`
      ALTER TABLE sports ADD COLUMN IF NOT EXISTS slug VARCHAR(120);
      UPDATE sports
         SET slug = CASE
           WHEN name = 'Futebol Campo' THEN 'futebol-campo'
           WHEN name = 'Futebol Salão' THEN 'futebol-salao'
           WHEN name = 'Futebol Society' THEN 'futebol-society'
           ELSE lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
         END
       WHERE slug IS NULL OR slug = '';
      CREATE UNIQUE INDEX IF NOT EXISTS sports_slug_idx ON sports (slug);
    `);

    // A tabela de modalidades não existia no banco hospedado. Esta migração
    // cria a estrutura mínima usada pelo catálogo e semeia as modalidades iniciais.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS modalities (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(120) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        sport_id INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO modalities (slug, name, sport_id, is_active, sort_order)
      SELECT s.slug, s.name, s.id, TRUE, s.sort_order
        FROM sports s
      ON CONFLICT (slug) DO NOTHING;
    `);

    const check = await pool.query('SELECT COUNT(*) FROM sports');
    const modalityCheck = await pool.query('SELECT COUNT(*) FROM modalities');
    console.log(`Diagnóstico Base de Dados -> Total de esportes: ${check.rows[0].count}; modalidades: ${modalityCheck.rows[0].count}`);

  } catch (error) {
    console.error("Erro ao inicializar as tabelas na base de dados:", error);
  }
}

console.log("Criando servidor GraphQL Yoga...");
const yoga = createYoga<{}, Ctx>({
  schema: createSchema({
    typeDefs,
    resolvers,
    resolverValidationOptions: { requireResolversToMatchSchema: 'ignore' },
  }),
  graphiql: !config.isProd,
  cors: true,
  maskedErrors: config.isProd,
  context: async ({ request }): Promise<Ctx> => {
    const h = request.headers.get('authorization') ?? '';
    const m = /^Bearer (.+)$/i.exec(h);
    return { userId: m ? await verifyAccessToken(m[1]) : null };
  },
});

const server = createServer(yoga);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const HOST = '0.0.0.0';

initDb().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`API pronta em http://${HOST}:${PORT}/graphql`);
    console.log(`Implementado: ${Object.keys(resolvers.Query).length - pending.filter((p) => p.startsWith('Query.')).length} queries, ` +
      `${Object.keys(resolvers.Mutation).length - pending.filter((p) => p.startsWith('Mutation.')).length} mutations ` +
      `(${pending.length} operações do schema ainda respondem NOT_IMPLEMENTED).`);
  });
});

const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

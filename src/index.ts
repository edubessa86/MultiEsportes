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

console.log('Lendo schema GraphQL...');

const typeDefs = readFileSync(
  new URL('./schema.graphql', import.meta.url),
  'utf8',
);

const doc = parse(typeDefs);

// O SDL usa enums como GPS e WEAR_OS; o banco usa gps e wear_os.
const enums: Record<string, Record<string, string>> = {};

for (const definition of doc.definitions) {
  if (definition.kind === Kind.ENUM_TYPE_DEFINITION) {
    enums[definition.name.value] = Object.fromEntries(
      (definition.values ?? []).map((value) => [
        value.name.value,
        value.name.value.toLowerCase(),
      ]),
    );
  }
}

if (enums.Language) {
  enums.Language.PT_BR = 'pt-BR';
  enums.Language.EN = 'en';
}

// Combina os resolvers dos módulos.
const modules = [
  catalogResolvers,
  accountResolvers,
  sessionResolvers,
  rankingResolvers,
] as Record<string, any>[];

const resolvers: Record<string, any> = { ...enums };

for (const moduleResolvers of modules) {
  for (const [type, fields] of Object.entries(moduleResolvers)) {
    resolvers[type] = {
      ...(resolvers[type] ?? {}),
      ...fields,
    };
  }
}

// Operações do schema sem resolver retornam NOT_IMPLEMENTED.
const notImplemented = () => {
  throw new GraphQLError('Ainda não implementado no MVP.', {
    extensions: { code: 'NOT_IMPLEMENTED' },
  });
};

const pending: string[] = [];

for (const definition of doc.definitions) {
  if (
    definition.kind !== Kind.OBJECT_TYPE_DEFINITION ||
    !['Query', 'Mutation'].includes(definition.name.value)
  ) {
    continue;
  }

  for (const field of definition.fields ?? []) {
    resolvers[definition.name.value] ??= {};

    if (!resolvers[definition.name.value][field.name.value]) {
      resolvers[definition.name.value][field.name.value] = notImplemented;
      pending.push(`${definition.name.value}.${field.name.value}`);
    }
  }
}

// Garante as tabelas e os dados mínimos do catálogo usados por este servidor.
async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sports (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      sort_order INT DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS sports_name_idx
    ON sports (name);
  `);

  await pool.query(`
    INSERT INTO sports (name, sort_order) VALUES
      ('Futebol Campo', 1),
      ('Futebol Salão', 2),
      ('Futebol Society', 3)
    ON CONFLICT (name) DO NOTHING;
  `);

  await pool.query(`
    ALTER TABLE sports
    ADD COLUMN IF NOT EXISTS slug VARCHAR(120);

    UPDATE sports
    SET slug = CASE
      WHEN name = 'Futebol Campo' THEN 'futebol-campo'
      WHEN name = 'Futebol Salão' THEN 'futebol-salao'
      WHEN name = 'Futebol Society' THEN 'futebol-society'
      ELSE lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
    END
    WHERE slug IS NULL OR slug = '';

    CREATE UNIQUE INDEX IF NOT EXISTS sports_slug_idx
    ON sports (slug);
  `);

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

  const sportsCount = await pool.query(
    'SELECT COUNT(*)::int AS count FROM sports',
  );
  const modalitiesCount = await pool.query(
    'SELECT COUNT(*)::int AS count FROM modalities',
  );

  console.log(
    `Diagnóstico Base de Dados -> Total de esportes: ${sportsCount.rows[0].count}; ` +
      `modalidades: ${modalitiesCount.rows[0].count}`,
  );
}

console.log('Criando servidor GraphQL Yoga...');

const yoga = createYoga<{}, Ctx>({
  schema: createSchema({
    typeDefs,
    resolvers,
    resolverValidationOptions: {
      requireResolversToMatchSchema: 'ignore',
    },
  }),
  graphiql: !config.isProd,
  cors: true,
  maskedErrors: config.isProd,
  context: async ({ request }): Promise<Ctx> => {
    const authorization = request.headers.get('authorization') ?? '';
    const match = /^Bearer (.+)$/i.exec(authorization);

    return {
      userId: match ? await verifyAccessToken(match[1]) : null,
    };
  },
});

const server = createServer(yoga);
const PORT = Number(process.env.PORT ?? 4000);
const HOST = '0.0.0.0';

async function start(): Promise<void> {
  await initDb();

  server.listen(PORT, HOST, () => {
    const queryCount =
      Object.keys(resolvers.Query ?? {}).length -
      pending.filter((operation) => operation.startsWith('Query.')).length;

    const mutationCount =
      Object.keys(resolvers.Mutation ?? {}).length -
      pending.filter((operation) => operation.startsWith('Mutation.')).length;

    console.log(`API pronta em http://${HOST}:${PORT}/graphql`);
    console.log(
      `Implementado: ${queryCount} queries, ${mutationCount} mutations ` +
        `(${pending.length} operações do schema ainda respondem NOT_IMPLEMENTED).`,
    );
  });
}

const shutdown = (): void => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void start().catch((error) => {
  console.error('Falha ao iniciar a API:', error);
  process.exit(1);
});

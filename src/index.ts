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

// O SDL usa enums como GPS e WEAR_OS; internamente, o banco usa gps e wear_os.
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

// Operações declaradas no schema que não têm resolver retornam NOT_IMPLEMENTED.
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
    SELECT s.slug, s.name, s.id

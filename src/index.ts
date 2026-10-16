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

async function startServer(): Promise<void> {
  let server: ReturnType<typeof createServer> | undefined;

  try {
    console.log('Lendo schema GraphQL...');

    const typeDefs = readFileSync(
      new URL('./schema.graphql', import.meta.url),
      'utf8',
    );

    const doc = parse(typeDefs);

    // Converte valores de enums GraphQL para os valores usados no banco.
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

    // Mapeia tipos e campos existentes no schema.
    const objectFields: Record<string, Set<string>> = {};
    const otherTypes = new Set<string>(); // enums, scalars, interfaces, unions

    for (const definition of doc.definitions) {
      if (
        definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
        definition.kind === Kind.OBJECT_TYPE_EXTENSION
      ) {
        const name = definition.name.value;
        objectFields[name] ??= new Set();
        for (const field of definition.fields ?? []) {
          objectFields[name].add(field.name.value);
        }
      } else if (
        definition.kind === Kind.ENUM_TYPE_DEFINITION ||
        definition.kind === Kind.SCALAR_TYPE_DEFINITION ||
        definition.kind === Kind.INTERFACE_TYPE_DEFINITION ||
        definition.kind === Kind.UNION_TYPE_DEFINITION
      ) {
        otherTypes.add(definition.name.value);
      }
    }

    // Remove resolvers que não têm correspondente no schema, para não
    // derrubar a API no boot. Cada remoção é registrada no log.
    const orphans: string[] = [];

    for (const [type, fields] of Object.entries(resolvers)) {
      if (otherTypes.has(type)) continue;

      if (!objectFields[type]) {
        orphans.push(type);
        delete resolvers[type];
        continue;
      }

      for (const field of Object.keys(fields)) {
        if (field.startsWith('__')) continue;
        if (!objectFields[type].has(field)) {
          orphans.push(`${type}.${field}`);
          delete fields[field];
        }
      }
    }

    if (orphans.length > 0) {
      console.warn(
        `Resolvers ignorados (não existem no schema): ${orphans.join(', ')}`,
      );
    }

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

    console.log('Criando servidor GraphQL Yoga...');

    const yoga = createYoga<{}, Ctx>({
      schema: createSchema({ typeDefs, resolvers }),
      graphiql: !config.isProd,
      cors: false,

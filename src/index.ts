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

// O contrato da API está na mesma pasta src/
const typeDefs = readFileSync(
  new URL('./schema.graphql', import.meta.url),
  'utf8',
);

const doc = parse(typeDefs);

// Enums: o SDL usa GPS, WEAR_OS...; o banco usa 'gps', 'wear_os'...
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

// Junta os resolvers dos módulos.
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

// Tudo que está no SDL mas ainda não tem resolver responde com um erro claro.
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

const yoga = createYoga<{}, Ctx>({
  schema: createSchema({ typeDefs, resolvers }),
  graphiql: !config.isProd,
  cors: false,
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

server.listen(config.port, config.host, () => {
  console.log(`API pronta em http://${config.host}:${config.port}/graphql`);

  const queryCount = Object.keys(resolvers.Query ?? {}).length;
  const mutationCount = Object.keys(resolvers.Mutation ?? {}).length;
  const pendingQueries = pending.filter((operation) =>
    operation.startsWith('Query.'),
  ).length;
  const pendingMutations = pending.filter((operation) =>
    operation.startsWith('Mutation.'),
  ).length;

  console.log(
    `Implementado: ${queryCount - pendingQueries} queries, ` +
      `${mutationCount - pendingMutations} mutations ` +
      `(${pending.length} operações do schema ainda respondem NOT_IMPLEMENTED).`,
  );
});

const shutdown = () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

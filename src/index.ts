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
    const document = parse(typeDefs);

    const declaredFields = new Map<string, Set<string>>();
    const enumResolvers: Record<string, Record<string, string>> = {};

    for (const definition of document.definitions) {
      if (
        definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
        definition.kind === Kind.INTERFACE_TYPE_DEFINITION
      ) {
        declaredFields.set(
          definition.name.value,
          new Set((definition.fields ?? []).map((field) => field.name.value)),
        );
      } else if (definition.kind === Kind.ENUM_TYPE_DEFINITION) {
        const values = (definition.values ?? []).map((value) => value.name.value);

        declaredFields.set(definition.name.value, new Set(values));
        enumResolvers[definition.name.value] = Object.fromEntries(
          values.map((value) => [value, value.toLowerCase()]),
        );
      }
    }

    if (enumResolvers.Language) {
      if ('PT_BR' in enumResolvers.Language) {
        enumResolvers.Language.PT_BR = 'pt-BR';
      }
      if ('EN' in enumResolvers.Language) {
        enumResolvers.Language.EN = 'en';
      }
    }

    const modules = [
      catalogResolvers,
      accountResolvers,
      sessionResolvers,
      rankingResolvers,
    ] as Record<string, any>[];

    const mergedResolvers: Record<string, any> = { ...enumResolvers };

    for (const moduleResolvers of modules) {
      for (const [typeName, fields] of Object.entries(moduleResolvers)) {
        mergedResolvers[typeName] = {
          ...(mergedResolvers[typeName] ?? {}),
          ...fields,
        };
      }
    }

    // Descarta resolvers para tipos ou campos ausentes no schema.
    const resolvers: Record<string, any> = {};

    for (const [typeName, typeResolvers] of Object.entries(mergedResolvers)) {
      const fieldsInSchema = declaredFields.get(typeName);
      if (!fieldsInSchema) continue;

      const filtered: Record<string, any> = {};

      for (const [fieldName, resolver] of Object.entries(typeResolvers)) {
        if (fieldsInSchema.has(fieldName)) {
          filtered[fieldName] = resolver;
        }
      }

      resolvers[typeName] = filtered;
    }

    const notImplemented = () => {
      throw new GraphQLError('Ainda não implementado no MVP.', {
        extensions: { code: 'NOT_IMPLEMENTED' },
      });
    };

    const pending: string[] = [];

    for (const definition of document.definitions) {
      if (
        definition.kind !== Kind.OBJECT_TYPE_DEFINITION ||
        !['Query', 'Mutation'].includes(definition.name.value)
      ) {
        continue;
      }

      const typeName = definition.name.value;
      resolvers[typeName] ??= {};

      for (const field of definition.fields ?? []) {
        if (!resolvers[typeName][field.name.value]) {
          resolvers[typeName][field.name.value] = notImplemented;
          pending.push(`${typeName}.${field.name.value}`);
        }
      }
    }

    console.log('Criando servidor GraphQL Yoga...');

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

    server = createServer(yoga);

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(config.port, config.host, () => {
        server!.off('error', reject);
        resolve();
      });
    });

    console.log(
      `API pronta em http://${config.host}:${config.port}/graphql`,
    );

    const queryCount = Object.keys(resolvers.Query ?? {}).length;
    const mutationCount = Object.keys(resolvers.Mutation ?? {}).length;
    const pendingQueries = pending.filter((item) =>
      item.startsWith('Query.'),
    ).length;
    const pendingMutations = pending.filter((item) =>
      item.startsWith('Mutation.'),
    ).length;

    console.log(
      `Implementado: ${queryCount - pendingQueries} queries, ` +
        `${mutationCount - pendingMutations} mutations ` +
        `(${pending.length} operações do schema ainda respondem NOT_IMPLEMENTED).`,
    );

    let shuttingDown = false;

    const shutdown = (signal: string): void => {
      if (shuttingDown || !server) return;
      shuttingDown = true;

      console.log(`Recebido ${signal}; encerrando servidor...`);

      server.close((serverError) => {
        if (serverError) {
          console.error('Erro ao fechar o servidor HTTP:', serverError);
        }

        void pool
          .end()
          .then(() => {
            process.exitCode = serverError ? 1 : 0;
          })
          .catch((poolError: unknown) => {
            console.error('Erro ao fechar a conexão com o banco:', poolError);
            process.exitCode = 1;
          });
      });
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Falha ao iniciar a API:', error);

    if (server?.listening) {
      server.close();
    }

    try {
      await pool.end();
    } catch (poolError) {
      console.error('Falha ao fechar a conexão com o banco:', poolError);
    }

    process.exitCode = 1;
  }
}

void startServer();

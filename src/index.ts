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

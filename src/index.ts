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

console.log("Criando servidor GraphQL Yoga...");
const yoga = createYoga<{}, Ctx>({
  schema: createSchema({
    typeDefs,
    resolvers,
    resolverValidationOptions: { requireResolversToMatchSchema: 'ignore' },
  }),
  graphiql: !config.isProd,
  cors: true, // Ativado para permitir testes em clientes web externos (como o Hoppscotch)
  maskedErrors: config.isProd,
  context: async ({ request }): Promise<Ctx> => {
    const h = request.headers.get('authorization') ?? '';
    const m = /^Bearer (.+)$/i.exec(h);
    return { userId: m ? await verifyAccessToken(m[1]) : null };
  },
});

const server = createServer(yoga);

// Configuração obrigatória para o Render detetar a porta aberta externamente
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`API pronta em http://${HOST}:${PORT}/graphql`);
  console.log(`Implementado: ${Object.keys(resolvers.Query).length - pending.filter((p) => p.startsWith('Query.')).length} queries, ` +
    `${Object.keys(resolvers.Mutation).length - pending.filter((p) => p.startsWith('Mutation.')).length} mutations ` +
    `(${pending.length} operações do schema ainda respondem NOT_IMPLEMENTED).`);
});

const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

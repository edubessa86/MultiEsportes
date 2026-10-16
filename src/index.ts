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

// O contrato da API é o schema.graphql posicionado dentro da pasta src/
const typeDefs = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');
const doc = parse(typeDefs);

// Enums: o SDL usa GPS, WEAR_OS...; o banco usa 'gps', 'wear_os'... (o app só vê o SDL)
const enums: Record<string, Record<string, string>> = {};
for (const d of doc.definitions) {
  if (d.kind === Kind.ENUM_TYPE_DEFINITION)
    enums[d.name.value] = Object.fromEntries((d.values ?? []).map((v) => [v.name.value, v.name.value.toLowerCase()]));
}
enums.Language = { PT_BR: 'pt-BR', EN: 'en' };

// Junta os resolvers dos módulos
const modules = [catalogResolvers, accountResolvers, sessionResolvers, rankingResolvers] as Record<string, any>[];
const resolvers: Record<string, any> = { ...enums };
for (const m of modules) for (const [type, fields] of Object.entries(m)) resolvers[type] = { ...(resolvers[type] ?? {}), ...fields };

// Tudo que está no SDL mas ainda não tem resolver responde com um erro claro (e não com null)
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

const yoga = createYoga<{}, Ctx>({
  schema: createSchema({ typeDefs, resolvers }),
  graphiql: !config.isProd,        // interface de testes em /graphql (só fora de produção)
  cors: false,                    // app nativo não precisa de CORS
  maskedErrors: config.isProd,    // em dev mostra a mensagem real do erro
  context: async ({ request }): Promise<Ctx> => {
    const h = request.headers.get('authorization') ?? '';
    const m = /^Bearer (.+)$/i.exec(h);
    return { userId: m ? await verifyAccessToken(m[1]) : null };
  },
});

const server = createServer(yoga);
server.listen(config.port, config.host, () => {
  console.log(`API pronta em http://${config.host}:${config.port}/graphql`);
  console.log(`Implementado: ${Object.keys(resolvers.Query).length - pending.filter((p) => p.startsWith('Query.')).length} queries, ` +
    `${Object.keys(resolvers.Mutation).length - pending.filter((p) => p.startsWith('Mutation.')).length} mutations ` +
    `(${pending.length} operações do schema ainda respondem NOT_IMPLEMENTED).`);
});

const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

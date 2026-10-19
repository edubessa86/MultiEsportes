import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
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

// O contrato da API é o mesmo SDL entregue em /graphql/schema.graphql.
// Procura em: SCHEMA_PATH, server/schema.graphql, ../graphql/schema.graphql (repositório completo).
function loadTypeDefs(): string {
  const candidates = [
    process.env.SCHEMA_PATH,
    new URL('../schema.graphql', import.meta.url).pathname,
    new URL('../../graphql/schema.graphql', import.meta.url).pathname,
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return readFileSync(p, 'utf8');
  throw new Error(`schema.graphql não encontrado. Procurei em: ${candidates.join(' | ')}. Defina SCHEMA_PATH.`);
}
const typeDefs = loadTypeDefs();
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
  graphiql: !config.isProd,       // interface de testes em /graphql (só fora de produção)
  cors: false,                    // app nativo não precisa de CORS
  maskedErrors: config.isProd,    // em dev mostra a mensagem real do erro
  context: async ({ request }): Promise<Ctx> => {
    const h = request.headers.get('authorization') ?? '';
    const m = /^Bearer (.+)$/i.exec(h);
    return { userId: m ? await verifyAccessToken(m[1]) : null };
  },
});


// Segurança: o isolamento entre usuários depende do RLS do banco, que NÃO vale para superusuário,
// papéis com BYPASSRLS nem para o dono das tabelas. Se o DATABASE_URL usar um desses, o servidor não sobe.
async function assertSafeDatabase(): Promise<void> {
  let r;
  try {
    r = (
      await pool.query(
        `SELECT current_user AS u,
                to_regclass('public.sessions') IS NOT NULL AS schema_ok,
                COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass,
                EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sessions' AND tableowner = current_user) AS owner
           FROM (SELECT 1) x`,
      )
    ).rows[0];
  } catch (e) {
    throw new Error(`Não foi possível conectar ao banco: ${(e as Error).message}. Confira o DATABASE_URL.`);
  }
  if (!r.schema_ok)
    throw new Error('O esquema do banco não está instalado (tabela "sessions" ausente). Rode db/neon_setup.sql no banco.');
  const unsafe = r.bypass || r.owner;
  if (unsafe && process.env.ALLOW_UNSAFE_DB_ROLE !== '1') {
    throw new Error(
      `O DATABASE_URL usa o usuário "${r.u}", que ignora o isolamento entre usuários (RLS). ` +
      'Use o papel "app_rw" (veja NUVEM.md, passo do Neon). Para ignorar isso SÓ em testes locais: ALLOW_UNSAFE_DB_ROLE=1.',
    );
  }
  if (unsafe) console.warn(`ATENÇÃO: conectado como "${r.u}" com ALLOW_UNSAFE_DB_ROLE=1. O isolamento entre usuários (RLS) NÃO está ativo. Nunca use isso em produção.`);
  else console.log(`Banco OK: conectado como "${r.u}" (RLS ativo).`);
}
await assertSafeDatabase();

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

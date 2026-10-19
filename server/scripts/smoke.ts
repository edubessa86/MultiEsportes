/**
 * Teste de fumaça SOMENTE LEITURA contra um servidor no ar (Render): não cria usuários nem sessões.
 *   API_URL=https://multiesportes.onrender.com npx tsx scripts/smoke.ts
 * Sai com código 1 se algo essencial falhar.
 */
const BASE = (process.env.API_URL ?? 'http://127.0.0.1:4000').trim().replace(/\/+$/, '').replace(/\/graphql$/i, '');
const REQUIRED = ['football_field', 'volleyball_beach', 'basketball_3x3'];

let failed = 0, warned = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string, extra?: unknown) => { failed++; console.log(`  ✗ ${m}`, extra !== undefined ? JSON.stringify(extra) : ''); };
const warn = (m: string) => { warned++; console.log(`  ! ${m}`); };

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch(`${BASE}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  return (await r.json()) as { data?: any; errors?: { message: string; extensions?: { code?: string } }[] };
}

async function waitAwake(maxSeconds = 150): Promise<boolean> {
  const t0 = Date.now();
  let tries = 0;
  while ((Date.now() - t0) / 1000 < maxSeconds) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) { console.log(`  servidor respondeu após ${Math.round((Date.now() - t0) / 1000)} s`); return true; }
    } catch { /* ainda acordando */ }
    if (tries++ % 3 === 0) console.log('  aguardando o servidor acordar (plano gratuito do Render)…');
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function main() {
  console.log(`\nAlvo: ${BASE}\n`);

  console.log('1) Servidor');
  if (!(await waitAwake())) { bad('o servidor não respondeu em /health (confira o serviço e os Logs no Render)'); return finish(); }
  ok('/health respondeu 200');

  console.log('\n2) Banco e catálogo');
  const cat = await gql('{ modalities { slug name } sports { slug } seasons { id name startsOn endsOn } }');
  if (cat.errors) { bad('consulta do catálogo falhou (DATABASE_URL/banco?)', cat.errors[0]); return finish(); }
  const slugs: string[] = cat.data.modalities.map((m: any) => m.slug);
  ok(`${slugs.length} modalidade(s) ativa(s): ${slugs.join(', ')}`);
  const missing = REQUIRED.filter((s) => !slugs.includes(s));
  missing.length ? bad(`faltam modalidades usadas nos testes: ${missing.join(', ')} (rode o UPDATE de is_active do neon_setup.sql)`) : ok('as 3 modalidades de teste estão ativas');
  cat.data.sports.length >= 1 ? ok(`${cat.data.sports.length} esporte(s) cadastrado(s)`) : bad('nenhum esporte cadastrado');

  const today = new Date().toISOString().slice(0, 10);
  const season = cat.data.seasons.find((s: any) => s.startsOn <= today && today <= s.endsOn);
  season ? ok(`temporada ativa: ${season.name}`) : warn('nenhuma temporada cobre a data de hoje: ranking e XP por temporada ficam vazios (cadastre uma em "seasons")');

  console.log('\n3) Autenticação e permissões (sem criar dados)');
  const anon = await gql('{ viewer { id } }');
  anon.data?.viewer === null ? ok('viewer sem login = null') : bad('viewer sem login deveria ser null', anon);
  const noAuth = await gql('{ mySessions { totalCount } }');
  noAuth.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED' ? ok('mySessions sem login é recusado (UNAUTHENTICATED)') : bad('mySessions sem login deveria ser recusado', noAuth);
  const wrong = await gql('mutation($i: SignInInput!){ signIn(input:$i){ userErrors{ code } } }', { i: { email: `fumaca-${Date.now()}@exemplo.invalid`, password: 'senha-qualquer-123' } });
  wrong.data?.signIn?.userErrors?.[0]?.code === 'INVALID_CREDENTIALS' ? ok('login com dados inexistentes = INVALID_CREDENTIALS (tabelas de login funcionando)') : bad('signIn inesperado', wrong);

  console.log('\n4) Configuração de produção');
  if (BASE.startsWith('https://')) {
    const html = await (await fetch(`${BASE}/graphql`, { headers: { accept: 'text/html' } })).text();
    /graphiql/i.test(html) ? warn('o GraphiQL está público: defina NODE_ENV=production no Render') : ok('GraphiQL desligado (NODE_ENV=production)');
  } else warn('endereço sem HTTPS: ok só para testes locais');

  finish();
}

function finish() {
  console.log(failed ? `\nRESULTADO: ${failed} falha(s), ${warned} aviso(s)\n` : `\nRESULTADO: tudo certo${warned ? ` (${warned} aviso(s))` : ''}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('Falha inesperada:', e); process.exit(1); });

export {};

/**
 * Teste ponta a ponta contra o servidor rodando (npm run e2e).
 * Cria usuários novos a cada execução (e-mails aleatórios).
 */
const ENDPOINT = `http://${process.env.HOST === '0.0.0.0' ? '127.0.0.1' : (process.env.HOST ?? '127.0.0.1')}:${process.env.PORT ?? 4000}/graphql`;

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function gql(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as { data?: any; errors?: { message: string; extensions?: { code?: string } }[] };
}

const rnd = () => Math.random().toString(36).slice(2, 10);
const iso = (d: Date) => d.toISOString();
const ago = (h: number) => new Date(Date.now() - h * 3_600_000);

const AUTH = `accessToken refreshToken viewer { id fullName } userErrors { code field }`;

async function signUp(email: string, password = 'senha-forte-123') {
  const r = await gql(`mutation($i: SignUpInput!){ signUp(input:$i){ ${AUTH} } }`, { i: { email, password, fullName: 'Atleta Teste' } });
  return r.data.signUp;
}

const SYNC = `mutation($i: SyncSessionInput!){ syncSession(input:$i){ alreadySynced xpEarned userErrors{code message}
  session { id status score invalidReasons durationSeconds xpEarned } } }`;

async function main() {
  console.log(`\nAlvo: ${ENDPOINT}\n`);

  console.log('1) Catálogo (público)');
  const sp = await gql('{ sports { slug name modalities { slug } } }');
  check('4 esportes', sp.data?.sports?.length === 4, sp.errors);
  const mods = await gql('{ modalities { id slug name sport { slug } } }');
  check('12 modalidades', mods.data?.modalities?.length === 12, mods.errors);
  const idOf = (slug: string) => mods.data.modalities.find((m: any) => m.slug === slug).id as number;
  const fm = await gql('{ modality(slug:"football_field", lang: EN){ name positions{code} metrics{ metric{code} isPrimary } eventTypes{ eventType{code} points } } }');
  check('modalidade em inglês + posições/métricas/eventos', fm.data?.modality?.name === 'Football (11-a-side)' && fm.data.modality.positions.length === 10, fm.errors);
  const b3 = await gql('{ modality(slug:"basketball_3x3"){ eventTypes{ eventType{code} points } } }');
  const pts = Object.fromEntries(b3.data.modality.eventTypes.map((e: any) => [e.eventType.code, e.points]));
  check('3x3: cesta de dentro = 1, de fora = 2', pts.fg_inside === 1 && pts.fg_outside === 2, pts);
  const seasons = await gql('{ seasons { id name } }');
  const seasonId = seasons.data.seasons[0].id as number;
  check('temporada global existe', !!seasonId, seasons.errors);

  console.log('\n2) Autenticação');
  const anon = await gql('{ viewer { id } }');
  check('viewer sem token = null', anon.data?.viewer === null, anon);
  const anonSessions = await gql('{ mySessions { totalCount } }');
  check('mySessions sem token = UNAUTHENTICATED', anonSessions.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED', anonSessions.errors);

  const weak = await gql(`mutation($i: SignUpInput!){ signUp(input:$i){ userErrors{code} } }`, { i: { email: `a${rnd()}@teste.com`, password: '123', fullName: 'X Y' } });
  check('senha fraca rejeitada', weak.data.signUp.userErrors[0]?.code === 'WEAK_PASSWORD', weak);
  const minor = await gql(`mutation($i: SignUpInput!){ signUp(input:$i){ userErrors{code} } }`, { i: { email: `m${rnd()}@teste.com`, password: 'senha-forte-123', fullName: 'Jovem Atleta', birthdate: `${new Date().getUTCFullYear() - 15}-01-01` } });
  check('menor de 18 bloqueado (LGPD)', minor.data.signUp.userErrors[0]?.code === 'GUARDIAN_FLOW_NOT_IMPLEMENTED', minor);

  const emailA = `a${rnd()}@teste.com`;
  const A = await signUp(emailA);
  check('cadastro devolve tokens', !!A.accessToken && !!A.refreshToken && A.userErrors.length === 0, A);
  const dup = await signUp(emailA);
  check('e-mail duplicado rejeitado', dup.userErrors[0]?.code === 'EMAIL_TAKEN', dup);
  const bad = await gql(`mutation($i: SignInInput!){ signIn(input:$i){ userErrors{code} } }`, { i: { email: emailA, password: 'errada-errada' } });
  check('senha errada = INVALID_CREDENTIALS', bad.data.signIn.userErrors[0]?.code === 'INVALID_CREDENTIALS', bad);
  const ok = await gql(`mutation($i: SignInInput!){ signIn(input:$i){ ${AUTH} } }`, { i: { email: emailA.toUpperCase(), password: 'senha-forte-123' } });
  check('login (e-mail case-insensitive)', !!ok.data.signIn.accessToken, ok);
  const token: string = ok.data.signIn.accessToken;
  const me = await gql('{ viewer { id fullName isPremium xpTotal } }', {}, token);
  check('viewer autenticado', me.data?.viewer?.fullName === 'Atleta Teste' && me.data.viewer.xpTotal === 0, me);

  console.log('\n3) Sessão válida (futebol de campo, GPS)');
  const clientId = crypto.randomUUID();
  const fieldInput = {
    clientSessionId: clientId, modalityId: idOf('football_field'), startedAt: iso(ago(3)), endedAt: iso(ago(1.5)), source: 'GPS', deviceKind: 'PHONE',
    metrics: [
      { metricCode: 'distance_total_m', value: 9000 }, { metricCode: 'max_speed_kmh', value: 30 }, { metricCode: 'sprint_count', value: 25 },
      { metricCode: 'high_intensity_distance_m', value: 700 }, { metricCode: 'accel_count', value: 80 },
    ],
    trackPoints: [0, 1, 2].map((n) => ({ seq: n, recordedAt: iso(new Date(Date.now() - 3 * 3_600_000 + n * 1000)), lat: -22.9 + n * 1e-5, lng: -43.2, accuracyM: 4, speedMs: 2.5 })),
    rpe: 7, feeling: 4, outcome: 'WIN', pointsFor: 3, pointsAgainst: 1,
  };
  const s1 = await gql(SYNC, { i: fieldInput }, token);
  const r1 = s1.data?.syncSession;
  check('sessão VALID com score 100 e 20 XP', r1?.session?.status === 'VALID' && Number(r1.session.score) === 100 && r1.xpEarned === 20, s1);
  check('duração calculada (90 min)', r1?.session?.durationSeconds === 5400, r1);

  const s1b = await gql(SYNC, { i: fieldInput }, token);
  const r1b = s1b.data?.syncSession;
  check('reenvio idempotente (mesma sessão, sem XP duplicado)', r1b?.alreadySynced === true && r1b.session.id === r1.session.id && r1b.xpEarned === 20, s1b);
  const parallel = await Promise.all([1, 2, 3].map(() => gql(SYNC, { i: { ...fieldInput, clientSessionId: crypto.randomUUID() , startedAt: iso(ago(30)), endedAt: iso(ago(28.5)) } }, token)));
  check('envios paralelos distintos funcionam', parallel.every((p) => p.data?.syncSession?.session?.status === 'VALID'), parallel.map((p) => p.errors));
  const sameParallel = await (async () => { const id = crypto.randomUUID(); const inp = { ...fieldInput, clientSessionId: id, startedAt: iso(ago(60)), endedAt: iso(ago(58.5)) };
    return Promise.all([1, 2, 3].map(() => gql(SYNC, { i: inp }, token))); })();
  const ids = new Set(sameParallel.map((p) => p.data?.syncSession?.session?.id));
  check('mesmo clientSessionId em paralelo = 1 só sessão', ids.size === 1 && !ids.has(undefined), sameParallel.map((p) => p.errors ?? p.data));

  console.log('\n4) Anti-fraude e validação de entrada');
  const fraud = await gql(SYNC, { i: { ...fieldInput, clientSessionId: crypto.randomUUID(), startedAt: iso(ago(5)), endedAt: iso(new Date(ago(5).getTime() + 5 * 60_000)),
    metrics: [{ metricCode: 'max_speed_kmh', value: 95 }, { metricCode: 'distance_total_m', value: 30000 }], trackPoints: [] } }, token);
  const fr = fraud.data?.syncSession?.session;
  check('95 km/h em 5 min = INVALID, sem XP, sem score', fr?.status === 'INVALID' && fr.score === null && fraud.data.syncSession.xpEarned === 0, fraud);
  check('motivos listados', ['duration_too_short', 'implausible_max_speed_kmh', 'implausible_distance_total_m'].every((x) => fr?.invalidReasons.includes(x)), fr);
  const unk = await gql(SYNC, { i: { ...fieldInput, clientSessionId: crypto.randomUUID(), metrics: [{ metricCode: 'inventada', value: 1 }] } }, token);
  check('métrica inexistente = UNKNOWN_METRIC', unk.data?.syncSession?.userErrors[0]?.code === 'UNKNOWN_METRIC', unk);
  const wrongMod = await gql(SYNC, { i: { ...fieldInput, clientSessionId: crypto.randomUUID(), metrics: [{ metricCode: 'jump_count', value: 10 }] } }, token);
  check('métrica de outra modalidade (saltos no futebol) rejeitada', wrongMod.data?.syncSession?.userErrors[0]?.code === 'UNKNOWN_METRIC', wrongMod);
  const inverted = await gql(SYNC, { i: { ...fieldInput, clientSessionId: crypto.randomUUID(), startedAt: iso(ago(1)), endedAt: iso(ago(2)) } }, token);
  check('fim antes do início rejeitado', inverted.data?.syncSession?.userErrors[0]?.code === 'INVALID_TIME_RANGE', inverted);
  const future = await gql(SYNC, { i: { ...fieldInput, clientSessionId: crypto.randomUUID(), startedAt: iso(new Date(Date.now() + 86_400_000)), endedAt: iso(new Date(Date.now() + 90_000_000)) } }, token);
  check('sessão no futuro rejeitada', future.data?.syncSession?.userErrors.some((e: any) => e.code === 'FUTURE_SESSION'), future);

  console.log('\n5) Vôlei de praia (sensores)');
  const vb = await gql(SYNC, { i: { clientSessionId: crypto.randomUUID(), modalityId: idOf('volleyball_beach'), startedAt: iso(ago(48)), endedAt: iso(ago(47)), source: 'IMU', deviceKind: 'WEAR_OS',
    metrics: [{ metricCode: 'jump_count', value: 60 }, { metricCode: 'jump_height_avg_cm', value: 40 }, { metricCode: 'heart_rate_avg', value: 150 }],
    motionEvents: [{ kind: 'JUMP', occurredAt: iso(ago(47.5)), value: 41.2, durationMs: 600 }] } }, token);
  check('vôlei de praia VALID', vb.data?.syncSession?.session?.status === 'VALID', vb);

  console.log('\n6) Listagem, paginação e estatísticas');
  const list = await gql('query($a:String){ mySessions(first:2, after:$a){ totalCount pageInfo{hasNextPage endCursor} edges{ node{ id status modality{slug} } } } }', {}, token);
  const L = list.data?.mySessions;
  check('totalCount e primeira página', L?.totalCount >= 7 && L.edges.length === 2 && L.pageInfo.hasNextPage, list);
  const list2 = await gql('query($a:String){ mySessions(first:50, after:$a){ edges{ node{ id } } pageInfo{hasNextPage} } }', { a: L.pageInfo.endCursor }, token);
  const firstIds = new Set(L.edges.map((e: any) => e.node.id));
  check('página seguinte sem repetir itens', list2.data.mySessions.edges.every((e: any) => !firstIds.has(e.node.id)) && L.totalCount === 2 + list2.data.mySessions.edges.length, list2);
  const onlyInvalid = await gql('{ mySessions(status: INVALID){ totalCount } }', {}, token);
  check('filtro por status', onlyInvalid.data?.mySessions?.totalCount === 1, onlyInvalid);
  const detail = await gql('query($id:UUID!){ session(id:$id){ metrics{ metric{code} value } trackPoints{ seq lat } xpEarned } }', { id: r1.session.id }, token);
  check('detalhe: métricas, trilha GPS e XP', detail.data?.session?.metrics.length === 5 && detail.data.session.trackPoints.length === 3 && detail.data.session.xpEarned === 20, detail);
  const stats = await gql('query($m:Int!){ athleteStatistics(modalityId:$m){ sessionsCount validSessionsCount averageScore metrics{ metric{code} average best } } }', { m: idOf('football_field') }, token);
  const st = stats.data?.athleteStatistics;
  check('estatísticas: 6 sessões (1 inválida), média 100', st?.sessionsCount === 6 && st.validSessionsCount === 5 && Number(st.averageScore) === 100, stats);
  const xp = await gql('{ viewer { xpTotal } }', {}, token);
  check('XP total = 5 válidas de futebol + 1 de vôlei = 120', xp.data?.viewer?.xpTotal === 120, xp);

  console.log('\n7) Ranking (público para logados, sem dados pessoais)');
  await new Promise((r) => setTimeout(r, 500)); // refresh do ranking é assíncrono
  const rk = await gql('query($m:Int!,$s:Int!){ performanceRanking(modalityId:$m, seasonId:$s){ entries{ position totalScore sessionsCounted user{ id displayName } } viewerEntry{ position totalScore } } }', { m: idOf('football_field'), s: seasonId }, token);
  const R = rk.data?.performanceRanking;
  check('usuário aparece no ranking', R?.viewerEntry?.position >= 1 && Number(R.viewerEntry.totalScore) === 500, rk);
  const leak = await gql('{ performanceRanking(modalityId:1, seasonId:1){ entries{ user{ fullName birthdate } } } }', {}, token);
  check('ranking NÃO expõe nome completo/nascimento (campos inexistentes)', !!leak.errors?.length && !leak.data, leak);
  const xr = await gql('{ xpRanking{ entries{ position totalXp } viewerEntry{ totalXp } } }', {}, token);
  check('ranking de XP', xr.data?.xpRanking?.viewerEntry?.totalXp === 120, xr);

  console.log('\n8) Isolamento entre usuários (RLS)');
  const B = await signUp(`b${rnd()}@teste.com`);
  const other = await gql('query($id:UUID!){ session(id:$id){ id } }', { id: r1.session.id }, B.accessToken);
  check('usuário B não enxerga sessão do A', other.data?.session === null, other);
  const otherList = await gql('{ mySessions{ totalCount } }', {}, B.accessToken);
  check('lista do B vazia', otherList.data?.mySessions?.totalCount === 0, otherList);
  const otherUser = await gql('query($id:UUID!){ user(id:$id){ id } }', { id: A.viewer.id }, B.accessToken);
  check('usuário B não lê perfil do A', otherUser.data?.user === null, otherUser);
  const otherStats = await gql('query($u:UUID!,$m:Int!){ athleteStatistics(userId:$u, modalityId:$m){ sessionsCount } }', { u: A.viewer.id, m: 1 }, B.accessToken);
  check('estatísticas de outro = FORBIDDEN', otherStats.errors?.[0]?.extensions?.code === 'FORBIDDEN', otherStats);
  const dispute = await gql('mutation($id:UUID!){ disputeSession(sessionId:$id, message:"Teste de contestação"){ success userErrors{code} } }', { id: r1.session.id }, B.accessToken);
  check('B não consegue contestar sessão do A', dispute.data?.disputeSession?.success === false, dispute);

  console.log('\n9) Refresh token rotativo');
  const rf = await gql(`mutation($t:String!){ refreshSession(refreshToken:$t){ ${AUTH} } }`, { t: ok.data.signIn.refreshToken });
  check('refresh devolve novos tokens', !!rf.data.refreshSession.accessToken && rf.data.refreshSession.refreshToken !== ok.data.signIn.refreshToken, rf);
  const reuse = await gql(`mutation($t:String!){ refreshSession(refreshToken:$t){ userErrors{code} } }`, { t: ok.data.signIn.refreshToken });
  check('reuso do token antigo é recusado', reuse.data.refreshSession.userErrors[0]?.code === 'INVALID_REFRESH_TOKEN', reuse);
  const afterTheft = await gql(`mutation($t:String!){ refreshSession(refreshToken:$t){ userErrors{code} } }`, { t: rf.data.refreshSession.refreshToken });
  check('reuso revoga também o token novo (sinal de roubo)', afterTheft.data.refreshSession.userErrors[0]?.code === 'INVALID_REFRESH_TOKEN', afterTheft);

  console.log('\n10) Perfil, contestação e pendências');
  const prof = await gql('mutation($i:UpdateProfileInput!){ updateProfile(input:$i){ user{ displayName location{ countryCode admin2 } } userErrors{code} } }',
    { i: { displayName: 'Zé', location: { countryCode: 'BR', admin1: 'RJ', admin2: 'Rio de Janeiro' } } }, token);
  check('atualizar perfil + localização', prof.data?.updateProfile?.user?.location?.admin2 === 'Rio de Janeiro', prof);
  const um = await gql('mutation($i:UserModalityInput!){ upsertUserModality(input:$i){ user{ modalities{ modality{slug} primaryPosition{code} isFavorite } } userErrors{code} } }',
    { i: { modalityId: idOf('football_field'), primaryPositionId: fm.data.modality.positions.length ? (await gql('{ modality(slug:"football_field"){ positions{ id code } } }')).data.modality.positions.find((p: any) => p.code === 'ST').id : null, isFavorite: true } }, token);
  check('modalidade favorita com posição (ST)', um.data?.upsertUserModality?.user?.modalities?.[0]?.primaryPosition?.code === 'ST', um);
  const dsp = await gql('mutation($id:UUID!){ disputeSession(sessionId:$id, message:"Foi um problema do GPS"){ success userErrors{code} } }', { id: fr.id }, token);
  check('contestar sessão inválida', dsp.data?.disputeSession?.success === true, dsp);
  const nimpl = await gql('{ teamsOfViewer { team { id } } }', {}, token);
  check('operação futura = NOT_IMPLEMENTED (erro claro)', nimpl.errors?.[0]?.extensions?.code === 'NOT_IMPLEMENTED', nimpl);

  console.log(`\nResultado: ${pass} ok, ${fail} falha(s)\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('Falha inesperada:', e); process.exit(1); });

export {};

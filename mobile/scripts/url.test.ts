import { normalizeServerUrl } from '../src/lib/url';

const cases: [string, string][] = [
  ['multiesportes.onrender.com', 'https://multiesportes.onrender.com'],
  ['https://multiesportes.onrender.com/graphql', 'https://multiesportes.onrender.com'],
  ['https://multiesportes.onrender.com/graphql/', 'https://multiesportes.onrender.com'],
  ['  https://multiesportes.onrender.com/  ', 'https://multiesportes.onrender.com'],
  ['http://multiesportes.onrender.com', 'https://multiesportes.onrender.com'],
  ['192.168.0.10:4000', 'http://192.168.0.10:4000'],
  [' 10.0.0.5:4000/graphql ', 'http://10.0.0.5:4000'],
  ['localhost:4000', 'http://localhost:4000'],
  ['meuservidor.com.br', 'https://meuservidor.com.br'],
  ['', ''],
];
let fail = 0;
for (const [input, expected] of cases) {
  const got = normalizeServerUrl(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} "${input}" -> "${got}"${ok ? '' : `  (esperado "${expected}")`}`);
}
console.log(fail ? `\n${fail} falha(s)` : '\nTodas as verificações passaram');
if (fail) throw new Error('url.test falhou');

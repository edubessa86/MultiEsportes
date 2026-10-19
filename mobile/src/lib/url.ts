/**
 * Normaliza o endereço do servidor digitado pelo usuário.
 *  - "meu-app.onrender.com"            -> https://meu-app.onrender.com
 *  - "https://meu-app.onrender.com/graphql/" -> https://meu-app.onrender.com
 *  - "192.168.0.10:4000" / "localhost:4000"  -> http://... (rede local não tem HTTPS)
 * Endereços *.onrender.com sempre usam https (o Render redireciona http, e o redirecionamento perde o corpo do POST).
 */
export function normalizeServerUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '').replace(/\/graphql$/i, '').replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u) || /\.local(:|\/|$)/i.test(u);
    u = `${local ? 'http' : 'https'}://${u}`;
  }
  return u.replace(/^http:\/\/([^/:]*\.onrender\.com)/i, 'https://$1');
}

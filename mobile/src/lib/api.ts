import { kv, secure } from './storage';
import { normalizeServerUrl } from './url';

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

let serverUrl = '';
let tokens: Tokens | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export const setSessionExpiredHandler = (fn: (() => void) => void) => {
  onSessionExpired = fn;
};

export const getServerUrl = () => serverUrl;

export { normalizeServerUrl } from './url';

export async function loadStored(): Promise<{ hasTokens: boolean }> {
  serverUrl = (await kv.get<string>('serverUrl')) ?? '';

  try {
    const raw = await secure.get('tokens');
    tokens = raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    tokens = null;
  }

  return { hasTokens: !!tokens };
}

export async function setServerUrl(raw: string): Promise<string> {
  serverUrl = normalizeServerUrl(raw);
  await kv.set('serverUrl', serverUrl);
  return serverUrl;
}

export async function saveTokens(t: Tokens | null): Promise<void> {
  tokens = t;

  if (t) {
    await secure.set('tokens', JSON.stringify(t));
  } else {
    await secure.del('tokens');
  }
}

export const getRefreshToken = () => tokens?.refreshToken ?? null;

/** O plano gratuito do Render pode suspender o servidor; a primeira chamada pode demorar. */
const REQUEST_TIMEOUT_MS = 60_000;

type GqlResponse = {
  data?: any;
  errors?: {
    message: string;
    extensions?: { code?: string };
  }[];
};

async function request(
  query: string,
  variables: Record<string, unknown>,
  withAuth: boolean,
): Promise<GqlResponse> {
  if (!serverUrl) {
    throw new ApiError('NO_SERVER', 'Informe o endereço do servidor primeiro.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${serverUrl}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withAuth && tokens
          ? { authorization: `Bearer ${tokens.accessToken}` }
          : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });

    try {
      return (await res.json()) as GqlResponse;
    } catch {
      // Pode ocorrer, por exemplo, se o servidor retornar uma página HTML de erro.
      throw new ApiError(
        'NETWORK',
        `Resposta inesperada do servidor (HTTP ${res.status}). Ele pode estar iniciando; tente novamente em instantes.`,
      );
    }
  } catch (e) {
    if (e instanceof ApiError) {
      throw e;
    }

    if ((e as { name?: string })?.name === 'AbortError') {
      throw new ApiError(
        'NETWORK',
        'O servidor demorou para responder. Se estava inativo, aguarde e tente novamente.',
      );
    }

    throw new ApiError(
      'NETWORK',
      'Sem conexão com o servidor. Confira o endereço e a rede.',
    );
  } finally {
    clearTimeout(timer);
  }
}

const REFRESH = `
  mutation($t: String!) {
    refreshSession(refreshToken: $t) {
      accessToken
      refreshToken
      expiresAt
      userErrors {
        code
      }
    }
  }
`;

/** Renova o token, evitando renovações simultâneas. */
function refreshTokens(): Promise<boolean> {
  if (!tokens) {
    return Promise.resolve(false);
  }

  refreshing ??= (async () => {
    try {
      const r = await request(
        REFRESH,
        { t: tokens!.refreshToken },
        false,
      );

      const p = r.data?.refreshSession;

      if (p?.accessToken) {
        await saveTokens({
          accessToken: p.accessToken,
          refreshToken: p.refreshToken,
          expiresAt: p.expiresAt,
        });
        return true;
      }

      // A renovação foi recusada; encerra a sessão local.
      await saveTokens(null);
      onSessionExpired?.();
      return false;
    } catch {
      // Se não houver rede, mantém os tokens para tentar novamente depois.
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function gql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  opts: { auth?: boolean } = {},
): Promise<T> {
  const withAuth = opts.auth ?? true;

  if (
    withAuth &&
    tokens &&
    new Date(tokens.expiresAt).getTime() - Date.now() < 30_000
  ) {
    await refreshTokens();
  }

  let json = await request(query, variables, withAuth);

  const unauth = (j: GqlResponse) =>
    j.errors?.some(
      (e

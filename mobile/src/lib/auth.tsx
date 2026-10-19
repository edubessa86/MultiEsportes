import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError, getRefreshToken, getServerUrl, gql, loadStored, saveTokens, setServerUrl, setSessionExpiredHandler,
} from './api';
import { kv } from './storage';

export type User = { id: string; fullName: string; displayName?: string | null; xpTotal: number; isPremium: boolean };
type Status = 'loading' | 'signedOut' | 'signedIn';

type AuthCtx = {
  status: Status;
  user: User | null;
  serverUrl: string;
  changeServer: (url: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, fullName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

const VIEWER = 'viewer { id fullName displayName xpTotal isPremium }';
const AUTH_FIELDS = `accessToken refreshToken expiresAt ${VIEWER} userErrors { code message }`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [serverUrl, setServerUrlState] = useState('');

  const applyUser = useCallback(async (u: User | null) => {
    setUser(u);
    if (u) await kv.set('user', u);
    else await kv.del('user');
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const d = await gql<{ viewer: User | null }>(`{ ${VIEWER} }`);
      if (d.viewer) await applyUser(d.viewer);
    } catch {
      /* offline: mantém o usuário em cache */
    }
  }, [applyUser]);

  useEffect(() => {
    setSessionExpiredHandler(() => { setStatus('signedOut'); setUser(null); });
    (async () => {
      const { hasTokens } = await loadStored();
      setServerUrlState(getServerUrl());
      if (hasTokens) {
        setUser(await kv.get<User>('user'));
        setStatus('signedIn');
        refreshUser();
      } else {
        setStatus('signedOut');
      }
    })();
    return () => setSessionExpiredHandler(null);
  }, [refreshUser]);

  const finishAuth = useCallback(async (p: any): Promise<string | null> => {
    if (p?.userErrors?.length) return p.userErrors[0].message as string;
    if (!p?.accessToken) return 'Não foi possível entrar.';
    await saveTokens({ accessToken: p.accessToken, refreshToken: p.refreshToken, expiresAt: p.expiresAt });
    await applyUser(p.viewer);
    setStatus('signedIn');
    return null;
  }, [applyUser]);

  const value = useMemo<AuthCtx>(() => ({
    status, user, serverUrl,
    changeServer: async (url) => { setServerUrlState(await setServerUrl(url)); },
    signIn: async (email, password) => {
      try {
        const d = await gql(`mutation($i: SignInInput!){ signIn(input: $i){ ${AUTH_FIELDS} } }`, { i: { email, password } }, { auth: false });
        return finishAuth(d.signIn);
      } catch (e) { return e instanceof ApiError ? e.message : 'Erro inesperado.'; }
    },
    signUp: async (email, password, fullName) => {
      try {
        const d = await gql(`mutation($i: SignUpInput!){ signUp(input: $i){ ${AUTH_FIELDS} } }`, { i: { email, password, fullName } }, { auth: false });
        return finishAuth(d.signUp);
      } catch (e) { return e instanceof ApiError ? e.message : 'Erro inesperado.'; }
    },
    signOut: async () => {
      const rt = getRefreshToken();
      if (rt) await gql(`mutation($t: String!){ signOut(refreshToken: $t){ success } }`, { t: rt }).catch(() => {});
      await saveTokens(null);
      await applyUser(null);
      setStatus('signedOut');
    },
    refreshUser,
  }), [status, user, serverUrl, finishAuth, applyUser, refreshUser]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}

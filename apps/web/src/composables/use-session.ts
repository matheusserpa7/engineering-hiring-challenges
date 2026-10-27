import { SessionResponseSchema, type SessionUser } from '@aangan/shared';
import { inject, shallowRef, type InjectionKey, type Ref } from 'vue';
import { z } from 'zod';
import { ApiError, getJson, postJson } from '../api';

export type SessionState =
  { status: 'unknown' } | { status: 'anonymous' } | { status: 'signed-in'; user: SessionUser };

export type LoginResult =
  | { ok: true; user: SessionUser }
  // 401: the one message the page shows for a wrong email, a wrong password or a guest.
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'rate_limited'; retryAfter: number | null }
  // Anything else (network, a proxy page, a 5xx): the password was not the problem.
  | { ok: false; reason: 'unavailable' };

export interface Session {
  state: Ref<SessionState>;
  // Asks the API who is signed in, once. Resolves in every case: a failure reads as anonymous.
  ensureLoaded: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  // False when the request never arrived and the session may still be open on the server.
  logout: () => Promise<boolean>;
  // A page saw a 401: the session ended on the server, so the UI forgets it without a request.
  expire: () => void;
}

// The server decides everything; this only remembers what it said. The role shown here moves
// links around, and the API checks it again on every request.
export function createSession(): Session {
  const state = shallowRef<SessionState>({ status: 'unknown' });
  let loading: Promise<void> | null = null;

  function ensureLoaded(): Promise<void> {
    if (state.value.status !== 'unknown') return Promise.resolve();
    loading ??= getJson('/api/auth/me', SessionResponseSchema)
      .then(({ user }) => {
        state.value = { status: 'signed-in', user };
      })
      .catch(() => {
        state.value = { status: 'anonymous' };
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  async function login(email: string, password: string): Promise<LoginResult> {
    try {
      const { user } = await postJson(
        '/api/auth/login',
        { email, password },
        SessionResponseSchema,
      );
      state.value = { status: 'signed-in', user };
      return { ok: true, user };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_credentials') {
        return { ok: false, reason: 'invalid_credentials' };
      }
      if (error instanceof ApiError && error.code === 'rate_limited') {
        return { ok: false, reason: 'rate_limited', retryAfter: error.retryAfter };
      }
      return { ok: false, reason: 'unavailable' };
    }
  }

  async function logout(): Promise<boolean> {
    try {
      await postJson('/api/auth/logout', undefined, z.undefined());
    } catch (error) {
      // 401: the session was already gone, which is what logout wanted.
      if (!(error instanceof ApiError && error.status === 401)) return false;
    }
    state.value = { status: 'anonymous' };
    return true;
  }

  function expire(): void {
    state.value = { status: 'anonymous' };
  }

  return { state, ensureLoaded, login, logout, expire };
}

export const SESSION_KEY: InjectionKey<Session> = Symbol('session');

export function useSession(): Session {
  const session = inject(SESSION_KEY);
  if (!session) throw new Error('useSession needs the session provided by main.ts');
  return session;
}

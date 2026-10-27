import { parse } from 'cookie';
import type { Request, RequestHandler } from 'express';
import type { SessionUser } from '@aangan/shared';
import { findViewerByTokenHash } from '../repositories/sessions.js';
import { SESSION_TOKEN_PATTERN, hashToken, type AuthDeps } from '../services/auth.js';
import { AppError } from './errors.js';

export const SESSION_COOKIE = 'aangan_session';

// What requireSession leaves for the handlers behind it. A WeakMap keyed by the request keeps
// the viewer typed, which res.locals (any) would not.
const sessions = new WeakMap<Request, { viewer: SessionUser; tokenHash: string }>();

// Only reachable without a session if a route forgot requireSession: refuse rather than
// guess who is asking.
function sessionOf(req: Request) {
  const session = sessions.get(req);
  if (!session) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
  return session;
}

export const viewerOf = (req: Request): SessionUser => sessionOf(req).viewer;
export const tokenHashOf = (req: Request): string => sessionOf(req).tokenHash;

export function cookieOptions({ auth }: AuthDeps) {
  return {
    httpOnly: true,
    secure: auth.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
  };
}

function sessionCookieOf(req: Request): string | undefined {
  const header = req.get('Cookie');
  return header === undefined ? undefined : parse(header)[SESSION_COOKIE];
}

// Account data and session state must never be cached by the browser or a proxy.
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

// The role is the one read from the database for this request, so a demoted admin is refused
// at once. 403 only for a role; a row that is not yours is a 404 (see donor-records).
export function requireRole(role: SessionUser['role']): RequestHandler {
  return (req, _res, next) => {
    next(
      viewerOf(req).role === role
        ? undefined
        : new AppError(403, 'forbidden', 'You do not have access to this.'),
    );
  };
}

export function requireSession(deps: AuthDeps): RequestHandler {
  return async (req, res, next) => {
    const cookieValue = sessionCookieOf(req);
    // A value of the wrong shape is no session; it never reaches the database.
    const tokenHash =
      cookieValue !== undefined && SESSION_TOKEN_PATTERN.test(cookieValue)
        ? hashToken(cookieValue)
        : undefined;
    const viewer =
      tokenHash === undefined ? undefined : await findViewerByTokenHash(deps.db, tokenHash);
    if (!viewer || tokenHash === undefined) {
      // A cookie that no longer maps to a session is cleared so the browser stops sending it.
      if (cookieValue !== undefined) res.clearCookie(SESSION_COOKIE, cookieOptions(deps));
      next(new AppError(401, 'unauthenticated', 'Sign in to continue.'));
      return;
    }
    sessions.set(req, { viewer, tokenHash });
    next();
  };
}

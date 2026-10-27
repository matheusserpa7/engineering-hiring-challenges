import { LoginRequestSchema, type SessionResponse } from '@aangan/shared';
import { Router } from 'express';
import { deleteSession } from '../repositories/sessions.js';
import { login, type AuthDeps } from '../services/auth.js';
import { AppError } from './errors.js';
import {
  SESSION_COOKIE,
  cookieOptions,
  noStore,
  requireSession,
  tokenHashOf,
  viewerOf,
} from './session.js';
import { parseInput } from './validate.js';

export function createAuthRouter(deps: AuthDeps): Router {
  const router = Router();
  router.use('/auth', noStore);

  router.post('/auth/login', async (req, res) => {
    const credentials = parseInput(LoginRequestSchema, req.body, 'body');
    const result = await login(deps, credentials);
    if (!result.ok) {
      // The donor id, never the email or the password; one fixed message for every cause.
      req.log.info({ donorId: result.donorId }, 'login failed');
      throw new AppError(401, 'invalid_credentials', 'The email or password is not correct.');
    }

    res.cookie(SESSION_COOKIE, result.token, {
      ...cookieOptions(deps),
      maxAge: deps.auth.sessionTtlHours * 60 * 60 * 1000,
    });
    res.json({ user: result.user } satisfies SessionResponse);
  });

  router.get('/auth/me', requireSession(deps), (req, res) => {
    res.json({ user: viewerOf(req) } satisfies SessionResponse);
  });

  router.post('/auth/logout', requireSession(deps), async (req, res) => {
    await deleteSession(deps.db, tokenHashOf(req));
    res.clearCookie(SESSION_COOKIE, cookieOptions(deps));
    res.status(204).end();
  });

  return router;
}

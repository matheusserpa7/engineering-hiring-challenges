import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { errorBody } from './errors.js';

export interface SecuritySettings {
  allowedOrigins: readonly string[];
  loginRateLimit: number;
}

// With no settings nothing is allowed: a caller that forgets them gets a closed API, not an
// open one. A request with no Origin header still passes (see originCheck).
export const closedSecurity: SecuritySettings = { allowedOrigins: [], loginRateLimit: 20 };

// The API returns JSON and nothing a browser should load, so the policy allows nothing and
// forbids framing. useDefaults is off so the header says exactly this and no more.
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
});

// A fixed list, never `*` and never the request's own Origin echoed back.
export function corsFor(allowedOrigins: readonly string[]): RequestHandler {
  return cors({
    origin: [...allowedOrigins],
    credentials: true,
    // Only what the web app sends, so a preflight does not promise more than the API serves.
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    maxAge: 600,
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// SameSite=Strict does not separate localhost:3000 from localhost:4000 (same site, different
// origins), so a page on another local port could still send the cookie. Every request that
// changes state must therefore come from a listed origin. The literal `null` origin
// (sandboxed frames, file://) is just a string that is not in the list.
// A missing Origin is let through: browsers always send one on a cross-origin POST, and a
// caller without one (curl, CI) has no victim's cookie to abuse (tech spec 005 F5).
export function originCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get('Origin');
    if (SAFE_METHODS.has(req.method) || origin === undefined || allowed.has(origin)) {
      next();
      return;
    }
    res.status(403).json(errorBody('origin_not_allowed', 'This origin may not call the API.'));
  };
}

// Login attempts per client address. It sits ahead of the body parser and the handler, so a
// blocked attempt never reaches scrypt, which is the expensive part. Successes count too: the
// demo passwords are public, so refunding them would let anyone reset the counter with a
// known login between guesses. Per address and not per email on purpose: the email lives in
// the body, and rotating emails would walk past an email-keyed limit while still costing a
// derivation each (tech spec 005 F1).
export function loginLimiter(limit: number): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json(errorBody('rate_limited', 'Too many sign-in attempts. Please try again later.'));
    },
  });
}

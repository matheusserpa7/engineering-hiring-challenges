import type { RequestHandler } from 'express';
import type { AuthDeps } from '../services/auth.js';
import { noStore, requireRole, requireSession } from './session.js';

// Mounted at /api/admin ahead of the body parser: no session is 401 and a donor is 403 before
// a body is read, so a malformed or oversized body from someone who may not call the route
// never gets a 400 or 413 that says it was looked at. The routes join behind the parser.
export function adminGuard(deps: AuthDeps): RequestHandler[] {
  return [noStore, requireSession(deps), requireRole('admin')];
}

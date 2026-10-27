import { Router } from 'express';
import { getDonationFor, listMyDonations } from '../services/donor-records.js';
import type { AuthDeps } from '../services/auth.js';
import { AppError } from './errors.js';
import { noStore, requireSession, viewerOf } from './session.js';

// A donor's own records. Both routes need a session; whose rows they return is decided in SQL.
export function createMeRouter(deps: AuthDeps): Router {
  const router = Router();
  const session = requireSession(deps);

  router.get('/me/donations', noStore, session, async (req, res) => {
    res.json({ data: await listMyDonations(deps.db, viewerOf(req)) });
  });

  router.get('/donations/:id', noStore, session, async (req, res) => {
    const donation = await getDonationFor(deps.db, viewerOf(req), req.params.id);
    if (!donation) throw new AppError(404, 'not_found', 'Donation not found.');
    res.json(donation);
  });

  return router;
}

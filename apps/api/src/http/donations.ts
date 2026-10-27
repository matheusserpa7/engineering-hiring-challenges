import { DonationRequestSchema, IdempotencyKeySchema } from '@aangan/shared';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { submitDonation, type IntakeSettings } from '../services/donations.js';
import { AppError } from './errors.js';
import { parseInput } from './validate.js';

interface DonationRouterDeps extends IntakeSettings {
  db: Kysely<Database>;
  now: () => Date;
}

// Public by design: a guest checks out, so no session is read. The caller cannot choose a
// status, a donor, a currency or a total, because none of them is in the request schema.
export function createDonationRouter(deps: DonationRouterDeps): Router {
  const router = Router();

  router.post('/donations', async (req, res) => {
    // The key is checked before the body: without one there is nothing to make a retry safe.
    const key = IdempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
    if (!key.success) {
      throw new AppError(
        400,
        'idempotency_key_required',
        'An Idempotency-Key header holding a UUID is required.',
      );
    }
    const request = parseInput(DonationRequestSchema, req.body, 'body');

    // req.log carries the request id, so a failure logged inside the service can be traced.
    const { httpStatus, receipt, replayed } = await submitDonation(
      { ...deps, logger: req.log },
      key.data,
      request,
    );
    if (replayed) res.set('Idempotent-Replayed', 'true');
    res.status(httpStatus).json(receipt);
  });

  return router;
}

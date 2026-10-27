import {
  CampaignSlugSchema,
  DEFAULT_RECENT_DONATIONS,
  RecentDonationsQuerySchema,
} from '@aangan/shared';
import { Router } from 'express';
import {
  getPublicCampaign,
  listRecentDonations,
  type CampaignDeps,
} from '../services/campaigns.js';
import { AppError } from './errors.js';
import { parseInput } from './validate.js';

// A slug that is malformed gets the same 404 as one that does not exist, so the response never
// tells a caller which kind of mistake they made.
const campaignNotFound = () => new AppError(404, 'not_found', 'Campaign not found.');

// Public: no session is read. no-cache: the browser may keep a copy but must revalidate it, so
// a new donor sees their gift on the next read, and an unchanged page costs a 304 (Express adds
// the ETag).
export function createCampaignRouter(deps: CampaignDeps): Router {
  const router = Router();

  router.get('/campaigns/:slug', async (req, res) => {
    const slug = CampaignSlugSchema.safeParse(req.params.slug);
    const campaign = slug.success ? await getPublicCampaign(deps, slug.data) : null;
    if (!campaign) throw campaignNotFound();

    res.set('Cache-Control', 'no-cache').json(campaign);
  });

  router.get('/campaigns/:slug/donations', async (req, res) => {
    // The slug is checked first: a caller who got both wrong learns about the slug, and neither
    // check reaches the database.
    const slug = CampaignSlugSchema.safeParse(req.params.slug);
    if (!slug.success) throw campaignNotFound();
    const { limit = DEFAULT_RECENT_DONATIONS } = parseInput(
      RecentDonationsQuerySchema,
      req.query,
      'query',
    );

    const data = await listRecentDonations(deps, slug.data, limit);
    if (!data) throw campaignNotFound();

    res.set('Cache-Control', 'no-cache').json({ data });
  });

  return router;
}

import type { PublicCampaign, PublicDonation } from '@aangan/shared';

// Shaped like the API's JSON, so a component test breaks if the contract drifts.
export function campaign(overrides: Partial<PublicCampaign> = {}): PublicCampaign {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'aangan-courtyard',
    title: 'Aangan courtyard',
    story: 'A shared courtyard for the community.',
    currency: 'USD',
    goalCents: 15_000_000,
    raisedCents: 4_305_800,
    donorCount: 46,
    progressPercent: 28,
    presetCents: [2500, 5000, 10_000],
    minCents: 100,
    maxCents: 2_500_000,
    isActive: true,
    phase: 'open',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T00:00:00.000Z',
    ...overrides,
  };
}

export function donation(overrides: Partial<PublicDonation> = {}): PublicDonation {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Priya Sharma',
    amountCents: 5100,
    dedication: null,
    message: null,
    createdAt: '2026-10-24T12:00:00.000Z',
    ...overrides,
  };
}

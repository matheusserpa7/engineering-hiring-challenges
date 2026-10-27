import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CampaignTotals from '../src/components/campaign-totals.vue';
import { campaign } from './fixtures';

function totals(overrides: Parameters<typeof campaign>[0] = {}): string {
  return mount(CampaignTotals, { props: { campaign: campaign(overrides) } }).text();
}

describe('campaign-totals', () => {
  it('formats the seeded Aangan totals', () => {
    const text = totals();

    expect(text).toContain('$43,058.00');
    expect(text).toContain('$150,000.00');
    expect(text).toContain('46 donors');
    expect(text).toContain('28%');
    expect(text).toContain('Ends Dec 31, 2026');
  });

  it('reads $0.00, 0 donors and 0% for a campaign with no gifts', () => {
    const text = totals({ raisedCents: 0, donorCount: 0, progressPercent: 0 });

    expect(text).toContain('$0.00');
    expect(text).toContain('0 donors');
    expect(text).toContain('0%');
    expect(text).not.toContain('NaN');
  });

  it('says 1 donor, singular', () => {
    const text = totals({ donorCount: 1 });

    expect(text).toContain('1 donor');
    expect(text).not.toContain('1 donors');
  });

  it('has no end line when the campaign has no end date', () => {
    expect(totals({ endsAt: null })).not.toContain('Ends');
  });

  it('has no end line once the campaign is closed', () => {
    expect(totals({ phase: 'closed' })).not.toContain('Ends');
  });
});

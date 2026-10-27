import type { DonationReceipt } from '@aangan/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DonationResult from '../src/components/donation-result.vue';
import type { DonationOutcome } from '../src/composables/use-donation';

function receipt(overrides: Partial<DonationReceipt> = {}): DonationReceipt {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    receiptNumber: 'HCC-2026-000076',
    amountCents: 10_100,
    currency: 'USD',
    status: 'completed',
    createdAt: '2026-10-27T12:00:00.000Z',
    ...overrides,
  };
}

function render(outcome: DonationOutcome) {
  return mount(DonationResult, { props: { outcome }, attachTo: document.body });
}

describe('donation-result', () => {
  it('thanks the donor and shows the receipt for a completed gift', () => {
    const wrapper = render({ kind: 'receipt', receipt: receipt() });

    expect(wrapper.text()).toContain('Thank you');
    expect(wrapper.text()).toContain('$101.00');
    expect(wrapper.text()).toContain('HCC-2026-000076');
  });

  it('says a pending payment is being confirmed and will not be charged twice', () => {
    const wrapper = render({ kind: 'receipt', receipt: receipt({ status: 'pending' }) });

    expect(wrapper.text()).toContain('confirming your payment');
    expect(wrapper.text()).toContain('HCC-2026-000076');
    expect(wrapper.text()).toContain('charged twice');
    expect(wrapper.text()).not.toContain('Thank you');
  });

  it.each([
    ['card_declined', 'declined'],
    ['insufficient_funds', 'insufficient funds'],
  ] as const)('says a %s payment took no money', (code, phrase) => {
    const wrapper = render({ kind: 'declined', code });

    expect(wrapper.text().toLowerCase()).toContain(phrase);
    expect(wrapper.text()).toContain('No money was taken');
    expect(wrapper.text()).toContain('Try again');
  });

  it('says nothing was charged when the provider failed', () => {
    const wrapper = render({ kind: 'provider_error' });

    expect(wrapper.text()).toContain('Nothing was charged');
  });

  it('shows Still processing with a Check again button', async () => {
    const wrapper = render({ kind: 'in_progress' });

    expect(wrapper.text()).toContain('Still processing');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('resubmit')).toHaveLength(1);
  });

  it('tells a rate-limited donor how long to wait', () => {
    const wrapper = render({ kind: 'rate_limited', retryAfter: 120 });

    expect(wrapper.text()).toContain('2 minutes');
  });

  it('promises a retry after a network failure will not charge twice', async () => {
    const wrapper = render({ kind: 'network' });

    expect(wrapper.text()).toContain('We couldn’t reach the server');
    expect(wrapper.text()).toContain('will not charge you twice');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('resubmit')).toHaveLength(1);
  });

  it('lets the donor edit after a decline', async () => {
    const wrapper = render({ kind: 'declined', code: 'card_declined' });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('dismiss')).toHaveLength(1);
    expect(wrapper.emitted('resubmit')).toBeUndefined();
  });

  it('shows the server message for a rejected request', () => {
    const wrapper = render({
      kind: 'rejected',
      code: 'campaign_closed',
      message: 'This campaign is closed.',
      details: undefined,
    });

    expect(wrapper.text()).toContain('This campaign is closed.');
  });

  it('moves focus to the heading', () => {
    const wrapper = render({ kind: 'receipt', receipt: receipt() });

    expect(document.activeElement).toBe(wrapper.get('h2').element);
  });
});

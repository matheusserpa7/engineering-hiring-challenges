import type { DonationDetail } from '@aangan/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { SESSION_KEY, createSession } from '../src/composables/use-session';
import { createAppRouter } from '../src/router';
import MyDonationsPage from '../src/views/my-donations-page.vue';
import { apiError, donorUser, json, stubApi } from './session-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function detail(overrides: Partial<DonationDetail> = {}): DonationDetail {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    receiptNumber: 'HCC-2026-000019',
    campaign: { slug: 'aangan-courtyard', title: 'Aangan courtyard' },
    donorName: 'Test Donor',
    amountCents: 10_100,
    currency: 'USD',
    status: 'completed',
    privacyMode: 'public',
    dedication: null,
    message: null,
    createdAt: '2026-08-02T09:30:00.000Z',
    refundedAt: null,
    ...overrides,
  };
}

const signedIn = () => json({ user: donorUser });

async function open() {
  const session = createSession();
  const router = createAppRouter(createMemoryHistory(), session);
  await router.push('/me');
  const wrapper = mount(MyDonationsPage, {
    global: { plugins: [router], provide: { [SESSION_KEY]: session } },
  });
  await flushPromises();
  return { wrapper, router, session };
}

describe('my donations', () => {
  it('lists each donation with its receipt, campaign and amount', async () => {
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () => json({ data: [detail()] }),
    });
    const { wrapper } = await open();

    const row = wrapper.get('li').text();
    expect(row).toContain('HCC-2026-000019');
    expect(row).toContain('Aangan courtyard');
    expect(row).toContain('$101.00');
    expect(row).toContain('Completed');
  });

  it('labels a refunded donation as refunded', async () => {
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () =>
        json({
          data: [
            detail({
              status: 'refunded',
              refundedAt: '2026-08-03T09:30:00.000Z',
              receiptNumber: 'HCC-2026-000021',
            }),
          ],
        }),
    });
    const { wrapper } = await open();

    expect(wrapper.get('li').text()).toContain('Refunded');
    expect(wrapper.get('li').text()).not.toContain('Completed');
  });

  it('says a pending donation is still being processed', async () => {
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () => json({ data: [detail({ status: 'pending' })] }),
    });
    const { wrapper } = await open();

    expect(wrapper.get('li').text()).toContain('Processing');
  });

  it('shows the donor’s own name and any dedication and message as text', async () => {
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () =>
        json({
          data: [
            detail({
              privacyMode: 'anonymous',
              dedication: { type: 'in_memory_of', name: '<img src=x onerror=alert(1)>' },
              message: '<script>alert(1)</script>',
            }),
          ],
        }),
    });
    const { wrapper } = await open();

    const row = wrapper.get('li');
    expect(row.text()).toContain('In memory of <img src=x onerror=alert(1)>');
    expect(row.text()).toContain('<script>alert(1)</script>');
    expect(row.find('img').exists()).toBe(false);
    expect(row.find('script').exists()).toBe(false);
    expect(row.text()).toContain('Anonymous');
  });

  it('has an empty state with a way to give', async () => {
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () => json({ data: [] }),
    });
    const { wrapper } = await open();

    expect(wrapper.text()).toContain('You have not made a donation yet.');
    expect(wrapper.find('li').exists()).toBe(false);
    expect(wrapper.get('a[href="/"]').text()).toMatch(/donate/i);
  });

  it('sends the person to sign in again when the session has ended (401)', async () => {
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () => apiError('unauthenticated', 'Sign in.', 401),
    });
    const { router, session } = await open();

    expect(session.state.value.status).toBe('anonymous');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.next).toBe('/me');
  });

  it('shows an error with a retry, not an empty list, when the request fails', async () => {
    let fail = true;
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () =>
        fail ? apiError('internal_error', 'x', 500) : json({ data: [detail()] }),
    });
    const { wrapper } = await open();

    expect(wrapper.get('[role="alert"]').text()).toContain('Something went wrong');
    expect(wrapper.text()).not.toContain('You have not made a donation yet.');

    fail = false;
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();

    expect(wrapper.get('li').text()).toContain('HCC-2026-000019');
  });

  it('shows a loading state first', async () => {
    stubApi({
      'GET /api/auth/me': signedIn,
      'GET /api/me/donations': () => new Promise<Response>(() => undefined),
    });
    const { wrapper } = await open();

    expect(wrapper.get('[role="status"]').text()).toContain('Loading');
  });
});

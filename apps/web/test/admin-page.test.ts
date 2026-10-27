import type { AdminDonation, AdminDonationPage } from '@aangan/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import App from '../src/App.vue';
import { SESSION_KEY, createSession } from '../src/composables/use-session';
import { createAppRouter } from '../src/router';
import { adminUser, apiError, donorUser, json } from './session-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function row(overrides: Partial<AdminDonation> = {}): AdminDonation {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    receiptNumber: 'HCC-2026-000003',
    campaign: { slug: 'aangan-courtyard', title: 'Aangan courtyard' },
    donorName: 'Priya Sharma',
    donorEmail: 'priya@example.com',
    amountCents: 2_500_000,
    currency: 'USD',
    status: 'completed',
    privacyMode: 'public',
    dedication: null,
    message: null,
    createdAt: '2026-08-02T09:30:00.000Z',
    refundedAt: null,
    failureCode: null,
    ...overrides,
  };
}

function page(rows: AdminDonation[], extra: Partial<AdminDonationPage> = {}): AdminDonationPage {
  return { data: rows, page: 1, pageSize: 25, total: rows.length, totalPages: 1, ...extra };
}

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

// Only the network is stubbed. Handlers get the parsed call; an unlisted request fails loudly.
function stub(handlers: {
  list?: (call: Call) => Response | Promise<Response>;
  refund?: (call: Call) => Response | Promise<Response>;
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const [path = '', query = ''] = url.split('?');
      const call: Call = {
        method: init?.method ?? 'GET',
        path,
        params: new URLSearchParams(query),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      if (path === '/api/auth/me') return Promise.resolve(json({ user: adminUser }));
      if (path === '/api/admin/donations' && handlers.list)
        return Promise.resolve(handlers.list(call));
      if (/^\/api\/admin\/donations\/[^/]+\/refund$/.test(path) && handlers.refund)
        return Promise.resolve(handlers.refund(call));
      return Promise.reject(new Error(`unexpected request: ${call.method} ${url}`));
    }),
  );
  return calls;
}

async function open(path = '/admin', user = adminUser, attach = false) {
  const session = createSession();
  session.state.value = { status: 'signed-in', user };
  const router = createAppRouter(createMemoryHistory(), session);
  await router.push(path);
  const wrapper = mount(App, {
    global: { plugins: [router], provide: { [SESSION_KEY]: session } },
    ...(attach ? { attachTo: document.body } : {}),
  });
  await flushPromises();
  return { wrapper, router, session };
}

type Wrapper = Awaited<ReturnType<typeof open>>['wrapper'];

const listCalls = (calls: Call[]) => calls.filter((call) => call.path === '/api/admin/donations');

async function search(wrapper: Wrapper, text: string) {
  await wrapper.get('input[name="q"]').setValue(text);
  await wrapper.get('form[role="search"]').trigger('submit');
  await flushPromises();
}

describe('admin page: the list', () => {
  it('shows each donation with the donor, email, amount and status', async () => {
    stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();

    const text = wrapper.get('tbody tr').text();
    expect(text).toContain('HCC-2026-000003');
    expect(text).toContain('Priya Sharma');
    expect(text).toContain('priya@example.com');
    expect(text).toContain('$25,000.00');
    expect(text).toContain('Completed');
  });

  it('asks for the first page, newest first, and nothing else', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    await open();

    const [first] = listCalls(calls);
    expect(Object.fromEntries(first?.params ?? [])).toEqual({
      sort: 'createdAt',
      dir: 'desc',
      page: '1',
      pageSize: '25',
    });
  });

  it('says so when nothing matches', async () => {
    stub({ list: () => json(page([], { total: 0, totalPages: 0 })) });
    const { wrapper } = await open();

    expect(wrapper.text()).toContain('No donations match.');
    expect(wrapper.find('tbody tr').exists()).toBe(false);
  });

  it('shows an error with a retry, not an empty table, when the request fails', async () => {
    let fail = true;
    stub({
      list: () => (fail ? apiError('internal_error', 'x', 500) : json(page([row()]))),
    });
    const { wrapper } = await open();

    expect(wrapper.get('[role="alert"]').text()).toContain('Something went wrong');
    expect(wrapper.text()).not.toContain('No donations match.');

    fail = false;
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.get('tbody tr').text()).toContain('HCC-2026-000003');
  });

  it('sends the person to sign in again when the session has ended (401)', async () => {
    stub({ list: () => apiError('unauthenticated', 'Sign in.', 401) });
    const { router, session } = await open();

    expect(session.state.value.status).toBe('anonymous');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('says the account may not use this page on a 403', async () => {
    stub({ list: () => apiError('forbidden', 'x', 403) });
    const { wrapper } = await open();

    expect(wrapper.get('[role="alert"]').text()).toContain('do not have access');
  });

  // Names, emails and messages are whatever a donor typed.
  it('renders hostile text as text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    stub({
      list: () => json(page([row({ donorName: evil, donorEmail: 'a@b.co', message: evil })])),
    });
    const { wrapper } = await open();

    expect(wrapper.get('tbody').text()).toContain(evil);
    expect(wrapper.find('tbody img').exists()).toBe(false);
  });

  it('shows a pending or failed row without a refund button', async () => {
    stub({
      list: () =>
        json(
          page([
            row({ id: '66666666-6666-4666-8666-666666666666', status: 'pending' }),
            row({ id: '77777777-7777-4777-8777-777777777777', status: 'failed' }),
            row({ id: '88888888-8888-4888-8888-888888888888', status: 'refunded' }),
          ]),
        ),
    });
    const { wrapper } = await open();

    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(wrapper.findAll('button').filter((b) => b.text() === 'Refund')).toHaveLength(0);
  });
});

describe('admin page: search, filter, sort and paging', () => {
  it('searches by the typed text and keeps it out of the address', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { wrapper, router } = await open();

    await search(wrapper, 'priya@example.com');

    expect(listCalls(calls).at(-1)?.params.get('q')).toBe('priya@example.com');
    expect(listCalls(calls).at(-1)?.params.get('page')).toBe('1');
    expect(router.currentRoute.value.fullPath).toBe('/admin');
  });

  // The first search answers last: its rows must not replace the newer search's rows.
  it('keeps the newest search on screen when an older one answers late', async () => {
    let releaseSlow: (response: Response) => void = () => undefined;
    stub({
      list: (call) => {
        const q = call.params.get('q');
        if (q === 'old') {
          return new Promise<Response>((resolve) => {
            releaseSlow = resolve;
          });
        }
        return json(page([row({ donorName: q === 'new' ? 'Newer Result' : 'Initial' })]));
      },
    });
    const { wrapper } = await open();

    await search(wrapper, 'old');
    await search(wrapper, 'new');
    releaseSlow(json(page([row({ donorName: 'Older Result' })])));
    await flushPromises();

    expect(wrapper.get('tbody').text()).toContain('Newer Result');
    expect(wrapper.get('tbody').text()).not.toContain('Older Result');
  });

  it('sends nothing for a blank search', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();

    await search(wrapper, '   ');

    expect(listCalls(calls).at(-1)?.params.has('q')).toBe(false);
  });

  it('filters by status, and “All” sends no status at all', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();

    await wrapper.get('select[name="status"]').setValue('refunded');
    await flushPromises();
    expect(listCalls(calls).at(-1)?.params.get('status')).toBe('refunded');

    await wrapper.get('select[name="status"]').setValue('');
    await flushPromises();
    expect(listCalls(calls).at(-1)?.params.has('status')).toBe(false);
  });

  it('sorts by amount, then flips the direction on a second click', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();
    const amount = () => wrapper.get('th button[data-sort="amountCents"]');

    await amount().trigger('click');
    await flushPromises();
    expect(Object.fromEntries(listCalls(calls).at(-1)?.params ?? [])).toMatchObject({
      sort: 'amountCents',
      dir: 'desc',
    });

    await amount().trigger('click');
    await flushPromises();
    expect(listCalls(calls).at(-1)?.params.get('dir')).toBe('asc');
    expect(wrapper.get('th:has(button[data-sort="amountCents"])').attributes('aria-sort')).toBe(
      'ascending',
    );
  });

  it('moves between pages and goes back to page 1 when the filter changes', async () => {
    const calls = stub({
      list: (call) =>
        json(
          page([row()], {
            page: Number(call.params.get('page')),
            total: 60,
            totalPages: 3,
          }),
        ),
    });
    const { wrapper } = await open();

    expect(wrapper.get('nav[aria-label="Pages"]').text()).toContain('Page 1 of 3');
    expect(wrapper.get('button[data-page="previous"]').attributes('disabled')).toBeDefined();

    await wrapper.get('button[data-page="next"]').trigger('click');
    await flushPromises();
    expect(listCalls(calls).at(-1)?.params.get('page')).toBe('2');
    expect(wrapper.get('nav[aria-label="Pages"]').text()).toContain('Page 2 of 3');

    await wrapper.get('select[name="status"]').setValue('completed');
    await flushPromises();
    expect(listCalls(calls).at(-1)?.params.get('page')).toBe('1');
  });

  it('shows the total', async () => {
    stub({ list: () => json(page([row()], { total: 75, totalPages: 3 })) });
    const { wrapper } = await open();

    expect(wrapper.text()).toContain('75 donations');
  });
});

describe('admin page: refunds', () => {
  const reasonText = 'Duplicate gift, confirmed with the donor';

  async function startRefund(wrapper: Wrapper) {
    await wrapper.get('tbody button[data-action="refund"]').trigger('click');
    await flushPromises();
  }

  it('opens a refund dialog, with a labelled reason field', async () => {
    stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();

    await startRefund(wrapper);

    const label = wrapper.get('form[data-form="refund"] label');
    expect(label.text()).toBe('Reason for the refund');
    expect(wrapper.get(`#${label.attributes('for') ?? ''}`).element.tagName).toBe('TEXTAREA');
  });

  it('opens a labelled dialog that names the donor as text and says what changes', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    stub({ list: () => json(page([row({ donorName: evil })])) });
    const { wrapper } = await open();

    await startRefund(wrapper);

    const dialog = wrapper.get('dialog');
    expect(dialog.attributes('open')).toBeDefined();
    const heading = wrapper.get(`#${dialog.attributes('aria-labelledby') ?? ''}`);
    expect(heading.text()).toBe(`Refund $25,000.00 to ${evil}?`);
    expect(dialog.find('img').exists()).toBe(false);
    expect(dialog.text()).toContain('Aangan courtyard total goes down by $25,000.00.');
  });

  it('ignores Escape while a refund is being sent, and closes on it otherwise', async () => {
    let release: (response: Response) => void = () => undefined;
    stub({
      list: () => json(page([row()])),
      refund: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    const { wrapper } = await open();
    await startRefund(wrapper);
    await wrapper.get('textarea').setValue(reasonText);
    await wrapper.get('form[data-form="refund"]').trigger('submit');

    const busyCancel = new Event('cancel', { cancelable: true });
    wrapper.get('dialog').element.dispatchEvent(busyCancel);
    expect(busyCancel.defaultPrevented).toBe(true);
    expect(wrapper.find('dialog').exists()).toBe(true);

    // The browser may close the dialog anyway (a second Escape cannot be cancelled): reopen it.
    const element = wrapper.get('dialog').element;
    element.removeAttribute('open');
    element.dispatchEvent(new Event('close'));
    expect(element.hasAttribute('open')).toBe(true);

    release(json(row({ status: 'refunded', refundedAt: '2026-10-27T10:00:00.000Z' })));
    await flushPromises();
    expect(wrapper.find('dialog').exists()).toBe(false);

    stub({ list: () => json(page([row()])) });
    const second = await open();
    await startRefund(second.wrapper);
    const idleCancel = new Event('cancel', { cancelable: true });
    second.wrapper.get('dialog').element.dispatchEvent(idleCancel);
    expect(idleCancel.defaultPrevented).toBe(true);
    await flushPromises();
    expect(second.wrapper.find('dialog').exists()).toBe(false);
  });

  it('moves focus to the notice after a refund, because the button is gone', async () => {
    stub({
      list: () => json(page([row()])),
      refund: () => json(row({ status: 'refunded', refundedAt: '2026-10-27T10:00:00.000Z' })),
    });
    const { wrapper } = await open('/admin', adminUser, true);
    await startRefund(wrapper);
    await wrapper.get('textarea').setValue(reasonText);
    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('[role="status"]').element);
    wrapper.unmount();
  });

  it('does not send an empty reason', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();
    await startRefund(wrapper);

    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await flushPromises();

    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(wrapper.get('[data-testid="reason-error"]').text()).toMatch(/reason/i);
  });

  it('counts the reason in code points and refuses more than 500', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();
    await startRefund(wrapper);

    await wrapper.get('textarea').setValue('😀'.repeat(501));
    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await flushPromises();

    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(wrapper.get('[data-testid="reason-error"]').text()).toContain('500');
  });

  it('sends exactly the reason, then shows the row as refunded with no refund button', async () => {
    const donation = row();
    const calls = stub({
      list: () => json(page([donation])),
      refund: () => json(row({ status: 'refunded', refundedAt: '2026-10-27T10:00:00.000Z' })),
    });
    const { wrapper } = await open();
    await startRefund(wrapper);

    await wrapper.get('textarea').setValue(`  ${reasonText}  `);
    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await flushPromises();

    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe(`/api/admin/donations/${donation.id}/refund`);
    expect(post?.body).toEqual({ reason: `  ${reasonText}  ` });
    expect(wrapper.get('tbody tr').text()).toContain('Refunded');
    expect(wrapper.find('tbody button[data-action="refund"]').exists()).toBe(false);
    expect(wrapper.find('form[data-form="refund"]').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('HCC-2026-000003');
  });

  it('sends one request however many times the button is pressed', async () => {
    let release: (response: Response) => void = () => undefined;
    const calls = stub({
      list: () => json(page([row()])),
      refund: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    const { wrapper } = await open();
    await startRefund(wrapper);
    await wrapper.get('textarea').setValue(reasonText);

    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await wrapper.get('form[data-form="refund"]').trigger('submit');
    expect(
      wrapper.get('form[data-form="refund"] button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    release(json(row({ status: 'refunded' })));
    await flushPromises();

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  // The message names the donor, who typed their own name: it must never become markup.
  it('shows the donor’s name in the confirmation as text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    stub({
      list: () => json(page([row({ donorName: evil })])),
      refund: () => json(row({ donorName: evil, status: 'refunded' })),
    });
    const { wrapper } = await open();
    await startRefund(wrapper);
    await wrapper.get('textarea').setValue(reasonText);

    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await flushPromises();

    const status = wrapper.get('[role="status"]');
    expect(status.text()).toContain(evil);
    expect(status.find('img').exists()).toBe(false);
  });

  it('treats “already refunded” as done: says so and reloads the list', async () => {
    let refunded = false;
    const calls = stub({
      list: () => json(page([row({ status: refunded ? 'refunded' : 'completed' })])),
      refund: () => {
        refunded = true;
        return apiError('already_refunded', 'x', 409);
      },
    });
    const { wrapper } = await open();
    await startRefund(wrapper);
    await wrapper.get('textarea').setValue(reasonText);

    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain('already refunded');
    expect(listCalls(calls)).toHaveLength(2);
    expect(wrapper.get('tbody tr').text()).toContain('Refunded');
  });

  it('keeps the form and the typed reason when the request fails', async () => {
    stub({
      list: () => json(page([row()])),
      refund: () => apiError('internal_error', 'x', 500),
    });
    const { wrapper } = await open();
    await startRefund(wrapper);
    await wrapper.get('textarea').setValue(reasonText);

    await wrapper.get('form[data-form="refund"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('form[data-form="refund"] [role="alert"]').text()).toContain('try again');
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(reasonText);
    expect(wrapper.get('tbody tr').text()).toContain('Completed');
  });

  it('can be cancelled without sending anything', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { wrapper } = await open();
    await startRefund(wrapper);

    await wrapper.get('button[data-action="cancel-refund"]').trigger('click');

    expect(wrapper.find('form[data-form="refund"]').exists()).toBe(false);
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });
});

describe('admin route', () => {
  it('sends a signed-in donor away from the page, and the page never asks for the list', async () => {
    const calls = stub({ list: () => json(page([row()])) });
    const { router } = await open('/admin', donorUser);

    expect(router.currentRoute.value.path).toBe('/');
    expect(listCalls(calls)).toEqual([]);
  });
});

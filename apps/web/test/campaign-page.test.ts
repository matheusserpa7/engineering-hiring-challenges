import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import CampaignPage from '../src/views/campaign-page.vue';
import { campaign, donation } from './fixtures';

type Handler = () => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorBody(code: string, message: string): unknown {
  return { error: { code, message } };
}

// The network boundary is the only thing stubbed: the page, the composable, the client and
// the schemas all run for real, and every assertion reads the DOM.
function stubApi(handlers: Record<string, Handler>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const handler = handlers[url];
      if (handler === undefined) throw new Error(`unexpected request: ${url}`);
      return Promise.resolve(handler());
    }),
  );
}

function routes(slug: string, handlers: { campaign: Handler; donations: Handler }) {
  return {
    [`/api/campaigns/${slug}`]: handlers.campaign,
    [`/api/campaigns/${slug}/donations?limit=20`]: handlers.donations,
  };
}

function happy(slug: string, overrides: Parameters<typeof campaign>[0] = {}) {
  return routes(slug, {
    campaign: () => json(campaign({ slug, ...overrides })),
    donations: () => json({ data: [donation({ displayName: 'Priya Sharma' })] }),
  });
}

function mountPage(slug = 'aangan-courtyard') {
  // The not-found state links to "/", which needs a router to resolve.
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  });
  return mount(CampaignPage, { props: { slug }, global: { plugins: [router] } });
}

function deferred(): { promise: Promise<Response>; resolve: (response: Response) => void } {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.title = '';
});

describe('campaign-page', () => {
  it('shows a loading status until the requests resolve', async () => {
    const pending = new Promise<Response>(() => undefined);
    stubApi(routes('aangan-courtyard', { campaign: () => pending, donations: () => pending }));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain('Loading');
    expect(wrapper.find('h1').exists()).toBe(false);
  });

  it('renders the campaign, its totals and its donations', async () => {
    stubApi(happy('aangan-courtyard'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Aangan courtyard');
    expect(wrapper.text()).toContain('A shared courtyard for the community.');
    expect(wrapper.text()).toContain('$43,058.00');
    expect(wrapper.text()).toContain('46 donors');
    expect(wrapper.text()).toContain('Priya Sharma');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('reads 0% and shows the empty state for a campaign with no gifts', async () => {
    stubApi(
      routes('aangan-courtyard', {
        campaign: () => json(campaign({ raisedCents: 0, donorCount: 0, progressPercent: 0 })),
        donations: () => json({ data: [] }),
      }),
    );

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('$0.00');
    expect(wrapper.text()).toContain('0%');
    expect(wrapper.text()).not.toContain('NaN');
    expect(wrapper.text()).toContain('No donations yet. Be the first to give.');
  });

  it('shows an error with a Retry button on a 500, and Retry loads the page', async () => {
    let calls = 0;
    stubApi(
      routes('aangan-courtyard', {
        campaign: () =>
          ++calls === 1
            ? json(errorBody('internal_error', 'Something went wrong.'), 500)
            : json(campaign()),
        donations: () => json({ data: [] }),
      }),
    );

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('Something went wrong');
    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('h1').text()).toBe('Aangan courtyard');
  });

  it('shows the error state for a 200 that is an HTML page', async () => {
    const html = () =>
      new Response('<!doctype html><div id="app"></div>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    stubApi(routes('aangan-courtyard', { campaign: html, donations: html }));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('h1').exists()).toBe(false);
  });

  it('shows the error state when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Failed to fetch');
  });

  it('shows the error state when the API breaks the contract', async () => {
    stubApi(
      routes('aangan-courtyard', {
        campaign: () => json({ ...campaign(), email: 'leak@example.org' }),
        donations: () => json({ data: [] }),
      }),
    );

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('leak@example.org');
  });

  it('shows not found, without Retry, and links back to the main campaign', async () => {
    const notFound = () => json(errorBody('not_found', 'Campaign not found.'), 404);
    stubApi(routes('nope', { campaign: notFound, donations: notFound }));

    const wrapper = mountPage('nope');
    await flushPromises();

    expect(wrapper.text()).toContain('Campaign not found');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.get('a').attributes('href')).toBe('/');
  });

  it('shows the closed notice for a closed campaign', async () => {
    stubApi(happy('aangan-courtyard', { phase: 'closed' }));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('This campaign is closed and no longer accepts donations.');
  });

  it('shows the opening date for an upcoming campaign', async () => {
    stubApi(happy('aangan-courtyard', { phase: 'upcoming', startsAt: '2026-11-01T00:00:00.000Z' }));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Opens Nov 1, 2026');
  });

  it('shows no closed notice for an open campaign', async () => {
    stubApi(happy('aangan-courtyard'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).not.toContain('closed');
  });

  it('sets the document title to the campaign title', async () => {
    stubApi(happy('aangan-courtyard'));

    mountPage();
    await flushPromises();

    expect(document.title).toBe('Aangan courtyard');
  });

  it('encodes the slug into the API path', async () => {
    const notFound = () => json(errorBody('not_found', 'Campaign not found.'), 404);
    stubApi(routes('a%20b', { campaign: notFound, donations: notFound }));

    mountPage('a b');
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/campaigns/a%20b', expect.anything());
  });

  it('ignores a stale response when the slug changes mid-flight', async () => {
    const first = { campaign: deferred(), donations: deferred() };
    stubApi({
      ...routes('first', {
        campaign: () => first.campaign.promise,
        donations: () => first.donations.promise,
      }),
      ...happy('second', { title: 'Second campaign' }),
    });

    const wrapper = mountPage('first');
    await wrapper.setProps({ slug: 'second' });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('Second campaign');

    first.campaign.resolve(json(campaign({ slug: 'first', title: 'First campaign' })));
    first.donations.resolve(json({ data: [] }));
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Second campaign');
    expect(document.title).toBe('Second campaign');
  });
});

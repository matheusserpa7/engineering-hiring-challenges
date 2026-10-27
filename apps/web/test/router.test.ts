import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import App from '../src/App.vue';
import { SESSION_KEY, createSession } from '../src/composables/use-session';
import { createAppRouter } from '../src/router';
import { campaign } from './fixtures';
import { apiError, donorUser, json as sessionJson } from './session-helpers';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function visit(path: string) {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      requested.push(url);
      if (url === '/api/auth/me') return Promise.resolve(apiError('unauthenticated', 'x', 401));
      return Promise.resolve(
        url.endsWith('/donations?limit=20') ? json({ data: [] }) : json(campaign()),
      );
    }),
  );
  const session = createSession();
  const router = createAppRouter(createMemoryHistory(), session);
  await router.push(path);
  const wrapper = mount(App, {
    global: { plugins: [router], provide: { [SESSION_KEY]: session } },
  });
  await flushPromises();
  return { wrapper, requested, router, session };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routes', () => {
  it('serves the Aangan campaign at /', async () => {
    const { requested } = await visit('/');

    expect(requested).toContain('/api/campaigns/aangan-courtyard');
  });

  it('serves any campaign at /campaigns/:slug', async () => {
    const { requested } = await visit('/campaigns/roof-repair-2025');

    expect(requested).toContain('/api/campaigns/roof-repair-2025');
  });

  it('shows not found for any other path, without calling the API', async () => {
    const { wrapper, requested } = await visit('/admin/secret');

    expect(wrapper.text()).toContain('Campaign not found');
    expect(requested.filter((url) => url !== '/api/auth/me')).toEqual([]);
  });
});

describe('protected routes', () => {
  it('sends a visitor with no session to the login page, remembering where they were going', async () => {
    const { router, wrapper } = await visit('/me');

    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.next).toBe('/me');
    expect(wrapper.text()).toContain('Sign in');
    expect(wrapper.text()).not.toContain('My donations');
  });

  it('shows the page to a signed-in donor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(sessionJson({ user: donorUser }))),
    );
    const session = createSession();
    const router = createAppRouter(createMemoryHistory(), session);
    await router.push('/me');
    const wrapper = mount(App, {
      global: { plugins: [router], provide: { [SESSION_KEY]: session } },
    });
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/me');
    expect(wrapper.get('main').text()).toContain('My donations');
  });

  it('leaves public pages open without asking who is signed in first', async () => {
    const { router } = await visit('/');

    expect(router.currentRoute.value.path).toBe('/');
  });
});

describe('navigation', () => {
  it('offers sign in to a visitor and nothing that needs a session', async () => {
    const { wrapper } = await visit('/');

    const nav = wrapper.get('nav').text();
    expect(nav).toContain('Sign in');
    expect(nav).not.toContain('My donations');
    expect(nav).not.toContain('Admin');
    expect(nav).not.toContain('Sign out');
  });

  it('offers a donor their donations and sign out, but not the admin page', async () => {
    const { wrapper, session } = await visit('/');
    session.state.value = { status: 'signed-in', user: donorUser };
    await flushPromises();

    const nav = wrapper.get('nav').text();
    expect(nav).toContain('My donations');
    expect(nav).toContain('Sign out');
    expect(nav).not.toContain('Admin');
    expect(nav).not.toContain('Sign in');
  });

  it('offers an admin the admin page', async () => {
    const { wrapper, session } = await visit('/');
    session.state.value = { status: 'signed-in', user: { ...donorUser, role: 'admin' } };
    await flushPromises();

    expect(wrapper.get('nav').text()).toContain('Admin');
  });

  it('signs out through the API and returns to the main page', async () => {
    const { wrapper, session, router, requested } = await visit('/');
    session.state.value = { status: 'signed-in', user: donorUser };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        requested.push(`${init?.method ?? 'GET'} ${url}`);
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    await flushPromises();

    await wrapper.get('nav button').trigger('click');
    await flushPromises();

    expect(requested).toContain('POST /api/auth/logout');
    expect(session.state.value.status).toBe('anonymous');
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.get('nav').text()).toContain('Sign in');
  });
});

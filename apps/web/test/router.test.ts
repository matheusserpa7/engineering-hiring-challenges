import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import App from '../src/App.vue';
import { createAppRouter } from '../src/router';
import { campaign } from './fixtures';

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
      return Promise.resolve(
        url.endsWith('/donations?limit=20') ? json({ data: [] }) : json(campaign()),
      );
    }),
  );
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  const wrapper = mount(App, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, requested };
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
    expect(requested).toEqual([]);
  });
});

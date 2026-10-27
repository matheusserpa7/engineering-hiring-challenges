import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { SESSION_KEY, createSession } from '../src/composables/use-session';
import { createAppRouter } from '../src/router';
import LoginPage from '../src/views/login-page.vue';
import { adminUser, apiError, donorUser, json, stubApi } from './session-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const anonymous = () => apiError('unauthenticated', 'Sign in.', 401);

async function open(path = '/login') {
  const session = createSession();
  const router = createAppRouter(createMemoryHistory(), session);
  await router.push(path);
  const wrapper = mount(LoginPage, {
    global: { plugins: [router], provide: { [SESSION_KEY]: session } },
  });
  await flushPromises();
  return { wrapper, router, session };
}

type Wrapper = Awaited<ReturnType<typeof open>>['wrapper'];

async function fill(wrapper: Wrapper, password = 'pw') {
  await wrapper.get('input[name="email"]').setValue('donor@himalayacc.example');
  await wrapper.get('input[name="password"]').setValue(password);
}

async function signIn(wrapper: Wrapper, password = 'pw') {
  await fill(wrapper, password);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('login page', () => {
  it('has labelled email and password fields and a submit button', async () => {
    stubApi({ 'GET /api/auth/me': anonymous });
    const { wrapper } = await open();

    const labels = wrapper.findAll('label').map((label) => label.text());
    expect(labels).toEqual(['Email', 'Password']);
    expect(wrapper.get('input[name="email"]').attributes('autocomplete')).toBe('username');
    expect(wrapper.get('input[name="password"]').attributes('type')).toBe('password');
    expect(wrapper.get('input[name="password"]').attributes('autocomplete')).toBe(
      'current-password',
    );
    expect(wrapper.get('button[type="submit"]').text()).toMatch(/sign in/i);
  });

  it('sends a donor to their donations after signing in', async () => {
    stubApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/login': () => json({ user: donorUser }),
    });
    const { wrapper, router } = await open();

    await signIn(wrapper);

    expect(router.currentRoute.value.path).toBe('/me');
  });

  it('sends an admin to the admin page', async () => {
    stubApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/login': () => json({ user: adminUser }),
    });
    const { wrapper, router } = await open();

    await signIn(wrapper);

    expect(router.currentRoute.value.path).toBe('/admin');
  });

  it('returns to the page that asked for the sign-in', async () => {
    stubApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/login': () => json({ user: donorUser }),
    });
    const { wrapper, router } = await open('/login?next=/campaigns/roof-repair-2025');

    await signIn(wrapper);

    expect(router.currentRoute.value.path).toBe('/campaigns/roof-repair-2025');
  });

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'ignores a next of %s, which would leave the site',
    async (next) => {
      stubApi({
        'GET /api/auth/me': anonymous,
        'POST /api/auth/login': () => json({ user: donorUser }),
      });
      const { wrapper, router } = await open(`/login?next=${encodeURIComponent(next)}`);

      await signIn(wrapper);

      expect(router.currentRoute.value.path).toBe('/me');
    },
  );

  it('shows one fixed message for wrong credentials, never the server wording, and clears the password', async () => {
    stubApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/login': () =>
        apiError('invalid_credentials', 'No such user donor@himalayacc.example', 401),
    });
    const { wrapper, router } = await open();

    await signIn(wrapper, 'wrong-password');

    expect(wrapper.get('[role="alert"]').text()).toBe('The email or password is not correct.');
    expect(wrapper.text()).not.toContain('No such user');
    expect((wrapper.get('input[name="password"]').element as HTMLInputElement).value).toBe('');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('tells the person how long to wait after a 429', async () => {
    stubApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/login': () =>
        apiError('rate_limited', 'Too many.', 429, { 'Retry-After': '300' }),
    });
    const { wrapper } = await open();

    await signIn(wrapper);

    expect(wrapper.get('[role="alert"]').text()).toContain('5 minutes');
  });

  it('says the service is unavailable, not that the password is wrong, when the network fails', async () => {
    stubApi({ 'GET /api/auth/me': anonymous });
    const { wrapper } = await open();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );

    await signIn(wrapper);

    const text = wrapper.get('[role="alert"]').text();
    expect(text).not.toContain('not correct');
    expect(text).toMatch(/try again/i);
  });

  it('disables the button while the request is in flight', async () => {
    let release: (response: Response) => void = () => undefined;
    stubApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/login': () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    const { wrapper } = await open();

    await fill(wrapper);
    await wrapper.get('form').trigger('submit');

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    release(json({ user: donorUser }));
    await flushPromises();
  });

  it('asks for both fields before sending anything', async () => {
    const calls = stubApi({ 'GET /api/auth/me': anonymous });
    const { wrapper } = await open();

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([]);
    expect(wrapper.get('[role="alert"]').text()).toMatch(/email and password/i);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '../src/composables/use-session';
import { adminUser, apiError, donorUser, json, stubApi } from './session-helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loading the session', () => {
  it('is signed in when /auth/me answers with a user', async () => {
    stubApi({ 'GET /api/auth/me': () => json({ user: donorUser }) });
    const session = createSession();

    await session.ensureLoaded();

    expect(session.state.value).toEqual({ status: 'signed-in', user: donorUser });
  });

  it('is anonymous on a 401', async () => {
    stubApi({ 'GET /api/auth/me': () => apiError('unauthenticated', 'Sign in.', 401) });
    const session = createSession();

    await session.ensureLoaded();

    expect(session.state.value).toEqual({ status: 'anonymous' });
  });

  it('is anonymous, not stuck loading, when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    const session = createSession();

    await session.ensureLoaded();

    expect(session.state.value).toEqual({ status: 'anonymous' });
  });

  it('asks the API once, however many routes ask', async () => {
    const calls = stubApi({ 'GET /api/auth/me': () => json({ user: donorUser }) });
    const session = createSession();

    await Promise.all([session.ensureLoaded(), session.ensureLoaded()]);
    await session.ensureLoaded();

    expect(calls).toEqual(['GET /api/auth/me']);
  });
});

describe('login', () => {
  const credentials = { email: 'donor@himalayacc.example', password: 'donor12345' };

  it('signs in and sends exactly the email and password', async () => {
    let sent: unknown;
    stubApi({
      'POST /api/auth/login': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '');
        return json({ user: adminUser });
      },
    });
    const session = createSession();

    const result = await session.login(credentials.email, credentials.password);

    expect(result).toEqual({ ok: true, user: adminUser });
    expect(sent).toEqual(credentials);
    expect(session.state.value).toEqual({ status: 'signed-in', user: adminUser });
  });

  it('reports wrong credentials without keeping a user', async () => {
    stubApi({
      'POST /api/auth/login': () => apiError('invalid_credentials', 'Server wording', 401),
    });
    const session = createSession();

    const result = await session.login(credentials.email, 'nope');

    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(session.state.value.status).not.toBe('signed-in');
  });

  it('reports the wait when the limiter answers 429', async () => {
    stubApi({
      'POST /api/auth/login': () =>
        apiError('rate_limited', 'Too many.', 429, { 'Retry-After': '120' }),
    });
    const session = createSession();

    const result = await session.login(credentials.email, 'x');

    expect(result).toEqual({ ok: false, reason: 'rate_limited', retryAfter: 120 });
  });

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
    ['an HTML error page', () => Promise.resolve(new Response('<html>', { status: 502 }))],
  ])('reports %s as a problem that is not the password', async (_label, respond) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const session = createSession();

    const result = await session.login(credentials.email, 'x');

    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('logout', () => {
  it('posts to the API and then forgets the user', async () => {
    const calls = stubApi({
      'GET /api/auth/me': () => json({ user: donorUser }),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const session = createSession();
    await session.ensureLoaded();

    await session.logout();

    expect(calls).toContain('POST /api/auth/logout');
    expect(session.state.value).toEqual({ status: 'anonymous' });
  });

  it('forgets the user when the session had already expired (401)', async () => {
    stubApi({
      'GET /api/auth/me': () => json({ user: donorUser }),
      'POST /api/auth/logout': () => apiError('unauthenticated', 'Sign in.', 401),
    });
    const session = createSession();
    await session.ensureLoaded();

    await session.logout();

    expect(session.state.value).toEqual({ status: 'anonymous' });
  });

  it('stays signed in, and says so, when the request never arrived', async () => {
    stubApi({ 'GET /api/auth/me': () => json({ user: donorUser }) });
    const session = createSession();
    await session.ensureLoaded();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );

    const done = await session.logout();

    expect(done).toBe(false);
    expect(session.state.value.status).toBe('signed-in');
  });
});

describe('expire', () => {
  it('turns a signed-in session into an anonymous one without a request', async () => {
    const calls = stubApi({ 'GET /api/auth/me': () => json({ user: donorUser }) });
    const session = createSession();
    await session.ensureLoaded();

    session.expire();

    expect(session.state.value).toEqual({ status: 'anonymous' });
    expect(calls).toEqual(['GET /api/auth/me']);
  });
});

<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useSession } from './composables/use-session';

const session = useSession();
const router = useRouter();

// Loaded once for the navigation; route guards wait on the same request.
void session.ensureLoaded();

async function signOut(): Promise<void> {
  if (await session.logout()) await router.push('/');
}
</script>

<template>
  <header class="site-header">
    <div class="shell header-row">
      <RouterLink to="/" class="brand">
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
          <rect width="34" height="34" rx="9" fill="var(--brand)" />
          <path
            d="M8 25V14l9-6 9 6v11"
            fill="none"
            stroke="var(--brand-ink)"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
          <path d="M13.5 25v-5a3.5 3.5 0 0 1 7 0v5" fill="var(--marigold)" />
          <path d="M6 25h22" stroke="var(--brand-ink)" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        <span class="brand-name">
          Himalaya Cultural Centre
          <small>Aangan Giving</small>
        </span>
      </RouterLink>
      <nav aria-label="Main">
        <RouterLink to="/">Donate</RouterLink>
        <template v-if="session.state.value.status === 'signed-in'">
          <RouterLink to="/me">My donations</RouterLink>
          <RouterLink v-if="session.state.value.user.role === 'admin'" to="/admin">
            Admin
          </RouterLink>
          <button type="button" class="btn ghost" @click="signOut">Sign out</button>
        </template>
        <RouterLink v-else-if="session.state.value.status === 'anonymous'" to="/login">
          Sign in
        </RouterLink>
      </nav>
    </div>
  </header>
  <main class="shell">
    <RouterView />
  </main>
</template>

<style>
.shell {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding-inline: max(1rem, env(safe-area-inset-left, 0px))
    max(1rem, env(safe-area-inset-right, 0px));
}

main.shell {
  padding-block: 1.5rem 4rem;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}

.header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  padding-block: 0.5rem;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  color: var(--ink);
  font-family: var(--font-display);
  font-weight: 700;
  line-height: 1.15;
  text-decoration: none;
}

.brand-name small {
  display: block;
  font-family: var(--font-body);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.header-row nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.header-row nav a,
.header-row nav button {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  border-radius: 8px;
  color: var(--muted);
  font-weight: 600;
  text-decoration: none;
}

.header-row nav a:hover,
.header-row nav button:hover,
.header-row nav a.router-link-exact-active {
  background: var(--surface-2);
  color: var(--ink);
}
</style>

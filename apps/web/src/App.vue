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
  <nav aria-label="Main">
    <RouterLink to="/">Donate</RouterLink>
    <template v-if="session.state.value.status === 'signed-in'">
      <RouterLink to="/me">My donations</RouterLink>
      <RouterLink v-if="session.state.value.user.role === 'admin'" to="/admin">Admin</RouterLink>
      <button type="button" @click="signOut">Sign out</button>
    </template>
    <RouterLink v-else-if="session.state.value.status === 'anonymous'" to="/login">
      Sign in
    </RouterLink>
  </nav>
  <main>
    <RouterView />
  </main>
</template>

<style>
body {
  margin: 0;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'Noto Sans',
    'Noto Sans Devanagari',
    sans-serif;
  line-height: 1.5;
  color: #111827;
  background: #fff;
}

main {
  box-sizing: border-box;
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem;
}

nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: center;
  box-sizing: border-box;
  max-width: 40rem;
  margin: 0 auto;
  padding: 0.5rem 1rem 0;
}

nav a,
nav button {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  font: inherit;
}

nav button {
  padding: 0 0.75rem;
}
</style>

<script setup lang="ts">
import { ref, useId } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useSession, type LoginResult } from '../composables/use-session';

const session = useSession();
const router = useRouter();
const route = useRoute();
const id = useId();

const email = ref('');
const password = ref('');
const busy = ref(false);
const message = ref<string | null>(null);

// One sentence for every wrong credential: the page never says which of the two was wrong, and
// never shows the server's wording.
const INVALID = 'The email or password is not correct.';

function waitText(seconds: number | null): string {
  if (seconds === null) return 'Please try again later.';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Please try again in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

function failureText(result: Extract<LoginResult, { ok: false }>): string {
  if (result.reason === 'invalid_credentials') return INVALID;
  if (result.reason === 'rate_limited')
    return `Too many sign-in attempts. ${waitText(result.retryAfter)}`;
  return 'Sign-in is unavailable right now. Please try again.';
}

// Only a path on this site: a next of "//evil.example" or "https://…" would turn the login into
// an open redirect.
function safeNext(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : null;
}

async function onSubmit(): Promise<void> {
  if (busy.value) return;
  if (email.value.trim() === '' || password.value === '') {
    message.value = 'Enter your email and password.';
    return;
  }
  busy.value = true;
  message.value = null;
  const result = await session.login(email.value, password.value);
  busy.value = false;

  if (!result.ok) {
    message.value = failureText(result);
    password.value = '';
    return;
  }
  await router.push(
    safeNext(route.query.next) ?? (result.user.role === 'admin' ? '/admin' : '/me'),
  );
}
</script>

<template>
  <section class="card login" aria-labelledby="login-heading">
    <p class="eyebrow">Donors and office staff</p>
    <h1 id="login-heading">Sign in</h1>
    <p class="muted">
      Most donors never need an account. You can <RouterLink to="/">give as a guest</RouterLink>.
    </p>
    <form novalidate class="login-form" @submit.prevent="onSubmit">
      <div class="field">
        <label :for="`${id}-email`">Email</label>
        <input
          :id="`${id}-email`"
          v-model="email"
          class="input"
          type="email"
          name="email"
          autocomplete="username"
        />
      </div>
      <div class="field">
        <label :for="`${id}-password`">Password</label>
        <input
          :id="`${id}-password`"
          v-model="password"
          class="input"
          type="password"
          name="password"
          autocomplete="current-password"
        />
      </div>
      <p v-if="message !== null" role="alert" class="error">{{ message }}</p>
      <button type="submit" class="btn primary lg" :disabled="busy">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.login {
  display: grid;
  gap: 1rem;
  max-width: 26rem;
  margin: 2rem auto;
  padding: 1.75rem;
  box-shadow: var(--shadow);
}

h1 {
  font-size: 1.8rem;
}

.login-form {
  display: grid;
  gap: 1rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

label {
  font-weight: 600;
}

.error {
  margin: 0;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: var(--bad-soft);
  color: var(--bad);
  font-weight: 600;
}
</style>

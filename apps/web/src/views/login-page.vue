<script setup lang="ts">
import { ref, useId } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  <section aria-labelledby="login-heading">
    <h1 id="login-heading">Sign in</h1>
    <form novalidate class="login-form" @submit.prevent="onSubmit">
      <div class="field">
        <label :for="`${id}-email`">Email</label>
        <input
          :id="`${id}-email`"
          v-model="email"
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
          type="password"
          name="password"
          autocomplete="current-password"
        />
      </div>
      <p v-if="message !== null" role="alert" class="error">{{ message }}</p>
      <button type="submit" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
    </form>
  </section>
</template>

<style scoped>
.login-form {
  display: grid;
  gap: 1rem;
  max-width: 24rem;
}

.field {
  display: grid;
  gap: 0.25rem;
}

input {
  box-sizing: border-box;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  font: inherit;
}

button {
  min-height: 2.75rem;
  padding: 0 1.25rem;
  font: inherit;
}

.error {
  margin: 0;
  color: #991b1b;
}
</style>

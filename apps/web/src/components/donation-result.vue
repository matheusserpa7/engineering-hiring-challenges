<script setup lang="ts">
import { formatCents } from '@aangan/shared';
import { onMounted, useTemplateRef } from 'vue';
import type { DonationOutcome } from '../composables/use-donation';

const props = defineProps<{ outcome: DonationOutcome }>();
defineEmits<{
  // Send the same body again: the server may already hold the attempt, and the key is reused.
  resubmit: [];
  // Back to the form to change something or start over.
  dismiss: [];
}>();

const heading = useTemplateRef<HTMLHeadingElement>('heading');

// A screen reader user lands on the outcome, not on a form that no longer says anything.
onMounted(() => heading.value?.focus());

function waitText(seconds: number | null): string {
  if (seconds === null) return 'a few minutes';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}
</script>

<template>
  <section
    class="result"
    data-testid="donation-result"
    aria-live="polite"
    :data-tone="
      props.outcome.kind === 'receipt' && props.outcome.receipt.status !== 'pending'
        ? 'ok'
        : ['receipt', 'in_progress', 'rate_limited'].includes(props.outcome.kind)
          ? 'warn'
          : 'bad'
    "
  >
    <template v-if="props.outcome.kind === 'receipt' && props.outcome.receipt.status !== 'pending'">
      <h2 ref="heading" tabindex="-1">Thank you for your gift</h2>
      <p>
        We received {{ formatCents(props.outcome.receipt.amountCents) }}. Your receipt number is
        <strong>{{ props.outcome.receipt.receiptNumber }}</strong
        >.
      </p>
      <button type="button" class="btn primary" @click="$emit('dismiss')">
        Make another donation
      </button>
    </template>

    <template v-else-if="props.outcome.kind === 'receipt'">
      <h2 ref="heading" tabindex="-1">We’re confirming your payment</h2>
      <p>
        Your reference is <strong>{{ props.outcome.receipt.receiptNumber }}</strong
        >. You won’t be charged twice.
      </p>
      <button type="button" class="btn primary" @click="$emit('dismiss')">
        Make another donation
      </button>
    </template>

    <template v-else-if="props.outcome.kind === 'declined'">
      <h2 ref="heading" tabindex="-1">
        {{
          props.outcome.code === 'insufficient_funds'
            ? 'Your card has insufficient funds'
            : 'Your card was declined'
        }}
      </h2>
      <p>No money was taken. Try another card or check your details.</p>
      <button type="button" class="btn primary" @click="$emit('dismiss')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'provider_error'">
      <h2 ref="heading" tabindex="-1">We couldn’t process your payment</h2>
      <p>Nothing was charged. Please try again in a moment.</p>
      <button type="button" class="btn primary" @click="$emit('dismiss')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'in_progress'">
      <h2 ref="heading" tabindex="-1">Still processing</h2>
      <p>
        Your payment is still being handled. Check again in a moment; you won’t be charged twice.
      </p>
      <button type="button" class="btn primary" @click="$emit('resubmit')">Check again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'rate_limited'">
      <h2 ref="heading" tabindex="-1">Too many attempts</h2>
      <p>Please wait about {{ waitText(props.outcome.retryAfter) }} and try again.</p>
      <button type="button" class="btn primary" @click="$emit('resubmit')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'network'">
      <h2 ref="heading" tabindex="-1">We couldn’t reach the server</h2>
      <p>Trying again will not charge you twice.</p>
      <button type="button" class="btn primary" @click="$emit('resubmit')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'rejected'">
      <h2 ref="heading" tabindex="-1">We couldn’t accept this gift</h2>
      <p>{{ props.outcome.message }}</p>
      <button type="button" class="btn primary" @click="$emit('dismiss')">Back to the form</button>
    </template>

    <template v-else>
      <h2 ref="heading" tabindex="-1">Something went wrong</h2>
      <p>If you try again, you won’t be charged twice.</p>
      <button type="button" class="btn primary" @click="$emit('resubmit')">Try again</button>
    </template>
  </section>
</template>

<style scoped>
.result {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
  padding: 1.25rem;
  border-radius: 12px;
  background: var(--surface-2);
}

.result::before {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  font-size: 1.5rem;
  font-weight: 700;
}

.result[data-tone='ok']::before {
  content: '✓' / '';
  background: var(--ok-soft);
  color: var(--ok);
}

.result[data-tone='warn']::before {
  content: '…' / '';
  background: var(--warn-soft);
  color: var(--warn);
}

.result[data-tone='bad']::before {
  content: '!' / '';
  background: var(--bad-soft);
  color: var(--bad);
}

h2 {
  margin: 0;
}

h2:focus {
  outline: none;
}

strong {
  padding: 0.15rem 0.6rem;
  border-radius: 8px;
  background: var(--surface);
  font-family: var(--font-mono);
  letter-spacing: 0.03em;
}
</style>

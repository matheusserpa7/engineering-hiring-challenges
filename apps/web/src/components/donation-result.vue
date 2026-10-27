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
  <section class="result" data-testid="donation-result" aria-live="polite">
    <template v-if="props.outcome.kind === 'receipt' && props.outcome.receipt.status !== 'pending'">
      <h2 ref="heading" tabindex="-1">Thank you for your gift</h2>
      <p>
        We received {{ formatCents(props.outcome.receipt.amountCents) }}. Your receipt number is
        <strong>{{ props.outcome.receipt.receiptNumber }}</strong
        >.
      </p>
      <button type="button" @click="$emit('dismiss')">Make another donation</button>
    </template>

    <template v-else-if="props.outcome.kind === 'receipt'">
      <h2 ref="heading" tabindex="-1">We’re confirming your payment</h2>
      <p>
        Your reference is <strong>{{ props.outcome.receipt.receiptNumber }}</strong
        >. You won’t be charged twice.
      </p>
      <button type="button" @click="$emit('dismiss')">Make another donation</button>
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
      <button type="button" @click="$emit('dismiss')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'provider_error'">
      <h2 ref="heading" tabindex="-1">We couldn’t process your payment</h2>
      <p>Nothing was charged. Please try again in a moment.</p>
      <button type="button" @click="$emit('dismiss')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'in_progress'">
      <h2 ref="heading" tabindex="-1">Still processing</h2>
      <p>
        Your payment is still being handled. Check again in a moment; you won’t be charged twice.
      </p>
      <button type="button" @click="$emit('resubmit')">Check again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'rate_limited'">
      <h2 ref="heading" tabindex="-1">Too many attempts</h2>
      <p>Please wait about {{ waitText(props.outcome.retryAfter) }} and try again.</p>
      <button type="button" @click="$emit('resubmit')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'network'">
      <h2 ref="heading" tabindex="-1">We couldn’t reach the server</h2>
      <p>Trying again will not charge you twice.</p>
      <button type="button" @click="$emit('resubmit')">Try again</button>
    </template>

    <template v-else-if="props.outcome.kind === 'rejected'">
      <h2 ref="heading" tabindex="-1">We couldn’t accept this gift</h2>
      <p>{{ props.outcome.message }}</p>
      <button type="button" @click="$emit('dismiss')">Back to the form</button>
    </template>

    <template v-else>
      <h2 ref="heading" tabindex="-1">Something went wrong</h2>
      <p>If you try again, you won’t be charged twice.</p>
      <button type="button" @click="$emit('resubmit')">Try again</button>
    </template>
  </section>
</template>

<style scoped>
.result {
  padding: 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
}

h2 {
  margin-top: 0;
}

h2:focus {
  outline: none;
}

button {
  min-height: 2.75rem;
  padding: 0 1.25rem;
  font: inherit;
}
</style>

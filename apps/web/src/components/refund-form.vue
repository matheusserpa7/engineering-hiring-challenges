<script setup lang="ts">
import {
  AdminDonationSchema,
  MAX_REFUND_REASON_CODE_POINTS,
  codePointLength,
  type AdminDonation,
} from '@aangan/shared';
import { ref, useId } from 'vue';
import { ApiError, postJson } from '../api';

const props = defineProps<{ donation: AdminDonation }>();
const emit = defineEmits<{
  refunded: [donation: AdminDonation];
  // The donation is not completed any more (refunded already, or never was): the list is stale.
  stale: [message: string];
  unauthenticated: [];
  cancel: [];
}>();

const id = useId();
const reason = ref('');
const busy = ref(false);
const fieldError = ref<string | null>(null);
const failure = ref<string | null>(null);

function validate(): string | null {
  const text = reason.value.trim();
  if (text === '') return 'Enter a reason for the refund.';
  if (codePointLength(text) > MAX_REFUND_REASON_CODE_POINTS) {
    return `The reason can be at most ${String(MAX_REFUND_REASON_CODE_POINTS)} characters.`;
  }
  return null;
}

async function onSubmit(): Promise<void> {
  if (busy.value) return;
  fieldError.value = validate();
  failure.value = null;
  if (fieldError.value !== null) return;

  busy.value = true;
  try {
    // No Idempotency-Key: completed -> refunded happens once, so a retry gets a 409 (spec 005 F2).
    const refunded = await postJson(
      `/api/admin/donations/${props.donation.id}/refund`,
      { reason: reason.value },
      AdminDonationSchema,
    );
    emit('refunded', refunded);
  } catch (error) {
    handleFailure(error);
  } finally {
    busy.value = false;
  }
}

function handleFailure(error: unknown): void {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      emit('unauthenticated');
    } else if (error.code === 'already_refunded') {
      emit('stale', 'That donation was already refunded.');
    } else if (error.code === 'not_refundable') {
      emit('stale', 'That donation can no longer be refunded.');
    } else if (error.code === 'not_found') {
      emit('stale', 'That donation no longer exists.');
    } else if (error.status === 403) {
      failure.value = 'You do not have access to refund donations.';
    } else if (error.status === 422) {
      fieldError.value = 'The reason could not be accepted. Check it and try again.';
    } else {
      failure.value = 'The refund could not be sent. Please try again.';
    }
    return;
  }
  failure.value = 'The refund could not be sent. Please try again.';
}
</script>

<template>
  <form novalidate data-form="refund" class="refund" @submit.prevent="onSubmit">
    <label :for="`${id}-reason`">Reason for the refund</label>
    <textarea
      :id="`${id}-reason`"
      v-model="reason"
      rows="3"
      :aria-invalid="fieldError !== null"
      :aria-describedby="fieldError === null ? undefined : `${id}-error`"
    />
    <p v-if="fieldError !== null" :id="`${id}-error`" class="error" data-testid="reason-error">
      {{ fieldError }}
    </p>
    <p v-if="failure !== null" role="alert" class="error">{{ failure }}</p>
    <div class="actions">
      <button type="submit" :disabled="busy">{{ busy ? 'Refunding…' : 'Confirm refund' }}</button>
      <button type="button" data-action="cancel-refund" :disabled="busy" @click="emit('cancel')">
        Cancel
      </button>
    </div>
  </form>
</template>

<style scoped>
.refund {
  display: grid;
  gap: 0.5rem;
  max-width: 32rem;
}

textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 0.5rem 0.75rem;
  font: inherit;
}

.actions {
  display: flex;
  gap: 0.75rem;
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

<script setup lang="ts">
import {
  AdminDonationSchema,
  formatCents,
  MAX_REFUND_REASON_CODE_POINTS,
  codePointLength,
  type AdminDonation,
} from '@aangan/shared';
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
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
const dialog = ref<HTMLDialogElement | null>(null);
// The Refund button that opened this. It is gone once the refund succeeds, so only a cancel returns here.
let opener: HTMLElement | null = null;
let unmounting = false;
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

onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // showModal makes the rest of the page inert, which is the focus trap, and focuses the textarea.
  dialog.value?.showModal();
});

onBeforeUnmount(() => {
  unmounting = true;
  dialog.value?.close();
  if (opener?.isConnected === true) opener.focus();
});

// Escape is a cancel event. While the request is in flight it must not close a refund the server
// may already be applying, the same rule as the disabled Cancel button.
function onDialogCancel(event: Event): void {
  event.preventDefault();
  if (!busy.value) emit('cancel');
}

// Chromium does not let a second Escape be cancelled, so the browser can close the dialog while a
// refund is in flight. The component state wins: reopen it while busy, otherwise treat it as Cancel.
function onDialogClose(): void {
  if (unmounting) return;
  if (busy.value) dialog.value?.showModal();
  else emit('cancel');
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
  <dialog
    ref="dialog"
    class="refund-dialog card"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-impact`"
    @cancel="onDialogCancel"
    @close="onDialogClose"
  >
    <h2 :id="`${id}-title`">
      Refund {{ formatCents(donation.amountCents) }} to {{ donation.donorName }}?
    </h2>
    <p :id="`${id}-impact`" class="muted">
      {{ donation.campaign.title }} total goes down by {{ formatCents(donation.amountCents) }}. The
      donor count drops by one if this was their only gift to it.
    </p>
    <form novalidate data-form="refund" class="refund" @submit.prevent="onSubmit">
      <label :for="`${id}-reason`">Reason for the refund</label>
      <textarea
        :id="`${id}-reason`"
        v-model="reason"
        class="input"
        rows="3"
        autofocus
        :aria-invalid="fieldError !== null"
        :aria-describedby="fieldError === null ? undefined : `${id}-error`"
      />
      <p v-if="fieldError !== null" :id="`${id}-error`" class="error" data-testid="reason-error">
        {{ fieldError }}
      </p>
      <p v-if="failure !== null" role="alert" class="error">{{ failure }}</p>
      <div class="actions">
        <button type="submit" class="btn danger" :disabled="busy">
          {{ busy ? 'Refunding…' : 'Confirm refund' }}
        </button>
        <button
          type="button"
          class="btn"
          data-action="cancel-refund"
          :disabled="busy"
          @click="emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.refund-dialog {
  width: min(32rem, calc(100% - 2rem));
  padding: 1.5rem;
  color: var(--ink);
  box-shadow: var(--shadow);
}

/* A literal colour: older engines do not pass custom properties into ::backdrop. */
.refund-dialog::backdrop {
  background: rgba(10, 24, 28, 0.55);
}

.refund-dialog h2 {
  margin-bottom: 0.5rem;
  overflow-wrap: anywhere;
}

.refund {
  display: grid;
  gap: 0.5rem;
  margin-top: 1rem;
}

label {
  font-weight: 600;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.error {
  margin: 0;
  color: var(--bad);
  font-weight: 600;
}
</style>

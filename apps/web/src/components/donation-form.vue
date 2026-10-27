<script setup lang="ts">
import {
  DEDICATION_TYPES,
  DonationRequestSchema,
  MAX_MESSAGE_CODE_POINTS,
  codePointLength,
  formatCents,
  parseDollarsToCents,
  type DedicationType,
  type DonationRequest,
  type PrivacyMode,
  type PublicCampaign,
} from '@aangan/shared';
import { computed, reactive, ref, useId } from 'vue';

const props = defineProps<{ campaign: PublicCampaign; busy?: boolean }>();
const emit = defineEmits<{ submit: [request: DonationRequest] }>();

const id = useId();

const DEDICATION_LABELS: Record<DedicationType, string> = {
  in_honor_of: 'In honor of',
  in_memory_of: 'In memory of',
};

const PRIVACY_OPTIONS: { value: PrivacyMode; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'anonymous', label: 'Anonymous' },
  { value: 'family', label: 'Family only' },
];

// There is no card field: the mock provider decides the outcome from a token, and this select
// is how a reviewer picks each result.
const TEST_CARDS = [
  { value: 'tok_ok', label: 'Succeeds' },
  { value: 'tok_decline', label: 'Declined' },
  { value: 'tok_insufficient', label: 'Insufficient funds' },
  { value: 'tok_timeout', label: 'Times out' },
  { value: 'tok_flaky', label: 'Fails once, then succeeds' },
];

const form = reactive({
  amountChoice: '',
  customAmount: '',
  fullName: '',
  email: '',
  dedicate: false,
  dedicationType: 'in_honor_of',
  dedicationName: '',
  message: '',
  privacyMode: 'public',
  paymentToken: 'tok_ok',
});

const errors = ref<Record<string, string>>({});

// The server counts code points (a 280-emoji message is valid), so a maxlength attribute,
// which counts UTF-16 units, would cut it short.
const messageLength = computed(() => codePointLength(form.message));

const range = computed(
  () => `${formatCents(props.campaign.minCents)} and ${formatCents(props.campaign.maxCents)}`,
);

// Typed amounts are checked here as a convenience; the server's limits are the ones that count.
function amountFromForm(): { cents: number } | { error: string } {
  if (form.amountChoice === '') return { error: 'Choose an amount.' };
  if (form.amountChoice !== 'custom') return { cents: Number(form.amountChoice) };

  const cents = parseDollarsToCents(form.customAmount);
  if (cents === null) {
    return {
      error: form.customAmount.includes(',')
        ? 'Use digits only, like 2500 or 2500.50.'
        : 'Enter an amount like 25 or 25.50.',
    };
  }
  if (cents < props.campaign.minCents || cents > props.campaign.maxCents) {
    return { error: `Enter an amount between ${range.value}.` };
  }
  return { cents };
}

const FIELD_ERRORS: Record<string, (code: string) => string> = {
  'donor.fullName': () => 'Enter your name, up to 100 characters.',
  'donor.email': () => 'Enter a valid email address.',
  dedication: () => 'Enter a name for the dedication, up to 100 characters.',
  message: (code) =>
    code === 'too_big'
      ? `Keep your message to ${String(MAX_MESSAGE_CODE_POINTS)} characters or fewer.`
      : 'Remove the unusual characters from your message.',
};

function onSubmit(): void {
  if (props.busy) return;
  const next: Record<string, string> = {};
  const amount = amountFromForm();
  if ('error' in amount) next.amount = amount.error;

  const parsed = DonationRequestSchema.safeParse({
    campaignSlug: props.campaign.slug,
    // A placeholder when the amount is invalid: its own error is already recorded, and the
    // other fields still deserve theirs.
    amountCents: 'cents' in amount ? amount.cents : props.campaign.minCents,
    donor: { fullName: form.fullName, email: form.email },
    dedication: form.dedicate ? { type: form.dedicationType, name: form.dedicationName } : null,
    message: form.message,
    privacyMode: form.privacyMode,
    isRecurring: false,
    paymentToken: form.paymentToken,
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.slice(0, 2).join('.');
      const key = path.startsWith('dedication') ? 'dedication' : path;
      const describe = FIELD_ERRORS[key];
      if (describe !== undefined) next[key] = next[key] ?? describe(issue.code);
      else next.form = 'Check the form and try again.';
    }
  }

  errors.value = next;
  if (Object.keys(next).length === 0 && parsed.success) emit('submit', parsed.data);
}
</script>

<template>
  <form novalidate class="donation-form" @submit.prevent="onSubmit">
    <fieldset>
      <legend>Amount</legend>
      <div class="options">
        <label v-for="cents in campaign.presetCents" :key="cents" class="option">
          <input v-model="form.amountChoice" type="radio" name="amount" :value="String(cents)" />
          {{ formatCents(cents) }}
        </label>
        <label class="option">
          <input v-model="form.amountChoice" type="radio" name="amount" value="custom" />
          Other amount
        </label>
      </div>
      <template v-if="form.amountChoice === 'custom'">
        <label :for="`${id}-custom`">Amount in dollars</label>
        <input
          :id="`${id}-custom`"
          v-model="form.customAmount"
          type="text"
          name="customAmount"
          inputmode="decimal"
          autocomplete="off"
          :aria-invalid="errors.amount !== undefined"
          :aria-describedby="errors.amount === undefined ? undefined : `${id}-amount-error`"
        />
      </template>
      <p
        v-if="errors.amount !== undefined"
        :id="`${id}-amount-error`"
        class="error"
        data-testid="amount-error"
      >
        {{ errors.amount }}
      </p>
    </fieldset>

    <div class="field">
      <label :for="`${id}-name`">Full name</label>
      <input
        :id="`${id}-name`"
        v-model="form.fullName"
        type="text"
        name="fullName"
        autocomplete="name"
        :aria-invalid="errors['donor.fullName'] !== undefined"
      />
      <p v-if="errors['donor.fullName'] !== undefined" class="error" data-testid="fullName-error">
        {{ errors['donor.fullName'] }}
      </p>
    </div>

    <div class="field">
      <label :for="`${id}-email`">Email</label>
      <input
        :id="`${id}-email`"
        v-model="form.email"
        type="email"
        name="email"
        autocomplete="email"
        :aria-invalid="errors['donor.email'] !== undefined"
      />
      <p v-if="errors['donor.email'] !== undefined" class="error" data-testid="email-error">
        {{ errors['donor.email'] }}
      </p>
    </div>

    <div class="field">
      <label class="option">
        <input v-model="form.dedicate" type="checkbox" name="dedicate" />
        Dedicate this gift
      </label>
      <template v-if="form.dedicate">
        <label :for="`${id}-dtype`">Dedication type</label>
        <select :id="`${id}-dtype`" v-model="form.dedicationType" name="dedicationType">
          <option v-for="type in DEDICATION_TYPES" :key="type" :value="type">
            {{ DEDICATION_LABELS[type] }}
          </option>
        </select>
        <label :for="`${id}-dname`">Name</label>
        <input
          :id="`${id}-dname`"
          v-model="form.dedicationName"
          type="text"
          name="dedicationName"
          :aria-invalid="errors.dedication !== undefined"
        />
        <p v-if="errors.dedication !== undefined" class="error" data-testid="dedication-error">
          {{ errors.dedication }}
        </p>
      </template>
    </div>

    <div class="field">
      <label :for="`${id}-message`">Message (optional)</label>
      <textarea
        :id="`${id}-message`"
        v-model="form.message"
        name="message"
        rows="3"
        :aria-invalid="errors.message !== undefined"
      />
      <p class="counter" data-testid="message-count">
        {{ messageLength }} / {{ MAX_MESSAGE_CODE_POINTS }}
      </p>
      <p v-if="errors.message !== undefined" class="error" data-testid="message-error">
        {{ errors.message }}
      </p>
    </div>

    <fieldset>
      <legend>Who can see your gift</legend>
      <div class="options">
        <label v-for="option in PRIVACY_OPTIONS" :key="option.value" class="option">
          <input v-model="form.privacyMode" type="radio" name="privacyMode" :value="option.value" />
          {{ option.label }}
        </label>
      </div>
      <p data-testid="privacy-explanation">
        Public shows your name and gift on this page; anonymous shows the gift without your name;
        family only keeps your name visible to the organisers but off the public list.
      </p>
    </fieldset>

    <div class="field">
      <label :for="`${id}-card`">Test card</label>
      <select :id="`${id}-card`" v-model="form.paymentToken" name="paymentToken">
        <option v-for="card in TEST_CARDS" :key="card.value" :value="card.value">
          {{ card.label }}
        </option>
      </select>
    </div>

    <p v-if="errors.form !== undefined" class="error" role="alert">{{ errors.form }}</p>
    <button type="submit" :disabled="busy">
      {{ busy ? 'Processing…' : 'Donate' }}
    </button>
  </form>
</template>

<style scoped>
.donation-form {
  display: grid;
  gap: 1rem;
}

fieldset {
  margin: 0;
  padding: 0.75rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
}

.field {
  display: grid;
  gap: 0.25rem;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
}

input[type='text'],
input[type='email'],
select,
textarea,
button {
  box-sizing: border-box;
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  font: inherit;
}

textarea {
  overflow-wrap: anywhere;
}

.counter {
  margin: 0;
  color: #4b5563;
  font-size: 0.875rem;
  text-align: right;
}

.error {
  margin: 0;
  color: #b91c1c;
}
</style>

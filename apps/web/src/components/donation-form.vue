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
    <fieldset class="section">
      <legend>Amount</legend>
      <div class="options chips">
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
          class="input"
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

    <fieldset class="section">
      <legend>Your details</legend>
      <div class="field">
        <label :for="`${id}-name`">Full name</label>
        <input
          :id="`${id}-name`"
          v-model="form.fullName"
          class="input"
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
          class="input"
          type="email"
          name="email"
          autocomplete="email"
          :aria-invalid="errors['donor.email'] !== undefined"
        />
        <p v-if="errors['donor.email'] !== undefined" class="error" data-testid="email-error">
          {{ errors['donor.email'] }}
        </p>
      </div>
    </fieldset>

    <fieldset class="section">
      <legend>Dedication and message</legend>
      <div class="field">
        <label class="option">
          <input v-model="form.dedicate" type="checkbox" name="dedicate" />
          Dedicate this gift
        </label>
        <template v-if="form.dedicate">
          <label :for="`${id}-dtype`">Dedication type</label>
          <select
            :id="`${id}-dtype`"
            v-model="form.dedicationType"
            class="input"
            name="dedicationType"
          >
            <option v-for="type in DEDICATION_TYPES" :key="type" :value="type">
              {{ DEDICATION_LABELS[type] }}
            </option>
          </select>
          <label :for="`${id}-dname`">Name</label>
          <input
            :id="`${id}-dname`"
            v-model="form.dedicationName"
            class="input"
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
          class="input"
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
    </fieldset>

    <fieldset class="section">
      <legend>Who can see your gift</legend>
      <div class="options chips">
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

    <fieldset class="section">
      <legend>Payment</legend>
      <div class="field">
        <label :for="`${id}-card`">Test card <span class="pill">Mock provider</span></label>
        <select :id="`${id}-card`" v-model="form.paymentToken" class="input" name="paymentToken">
          <option v-for="card in TEST_CARDS" :key="card.value" :value="card.value">
            {{ card.label }}
          </option>
        </select>
      </div>
    </fieldset>

    <p v-if="errors.form !== undefined" class="error" role="alert">{{ errors.form }}</p>
    <button type="submit" class="btn primary lg" :disabled="busy">
      {{ busy ? 'Processing…' : 'Donate' }}
    </button>
  </form>
</template>

<style scoped>
.donation-form {
  display: grid;
  gap: 1.25rem;
}

.section {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 1.25rem 0 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.section:first-child {
  padding-top: 0;
  border-top: 0;
}

legend {
  padding: 0;
  font-weight: 700;
  font-family: var(--font-display);
}

.field {
  display: grid;
  gap: 0.35rem;
}

label {
  font-weight: 600;
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

.chips .option {
  position: relative;
  justify-content: center;
  min-width: 5rem;
  padding: 0.5rem 1rem;
  border: 1.5px solid var(--line-strong);
  border-radius: 10px;
  background: var(--surface);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.chips .option input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.chips .option:has(input:checked) {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand-strong);
}

.chips .option:has(input:focus-visible) {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

textarea {
  overflow-wrap: anywhere;
}

.counter {
  margin: 0;
  color: var(--muted);
  font-size: 0.875rem;
  text-align: right;
}

.error {
  margin: 0;
  color: var(--bad);
  font-weight: 600;
}

@media (min-width: 760px) {
  .section:has(input[name='fullName']) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .section:has(input[name='fullName']) > legend {
    grid-column: 1 / -1;
  }
}
</style>

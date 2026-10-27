<script setup lang="ts">
import { DonationDetailListSchema, formatCents, type DonationDetail } from '@aangan/shared';
import { onMounted, shallowRef } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ApiError, getJson } from '../api';
import { useSession } from '../composables/use-session';

type State =
  { status: 'loading' } | { status: 'ready'; donations: DonationDetail[] } | { status: 'error' };

const session = useSession();
const router = useRouter();
const route = useRoute();
const state = shallowRef<State>({ status: 'loading' });

const STATUS_LABELS: Record<DonationDetail['status'], string> = {
  completed: 'Completed',
  refunded: 'Refunded',
  pending: 'Processing',
  failed: 'Failed',
};

const PRIVACY_LABELS: Record<DonationDetail['privacyMode'], string> = {
  public: 'Public',
  anonymous: 'Anonymous',
  family: 'Family only',
};

// The browser's own zone and locale: this is the donor's private record, not a campaign date.
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function load(): Promise<void> {
  state.value = { status: 'loading' };
  try {
    const { data } = await getJson('/api/me/donations', DonationDetailListSchema);
    state.value = { status: 'ready', donations: data };
  } catch (error) {
    // The session ended on the server since the page was allowed in.
    if (error instanceof ApiError && error.status === 401) {
      session.expire();
      await router.push({ path: '/login', query: { next: route.fullPath } });
      return;
    }
    state.value = { status: 'error' };
  }
}

function dedicationLabel(dedication: NonNullable<DonationDetail['dedication']>): string {
  const prefix = dedication.type === 'in_honor_of' ? 'In honor of' : 'In memory of';
  return `${prefix} ${dedication.name}`;
}

onMounted(load);
</script>

<template>
  <section aria-labelledby="mine-heading">
    <h1 id="mine-heading">My donations</h1>

    <p v-if="state.status === 'loading'" role="status">Loading your donations…</p>

    <div v-else-if="state.status === 'error'" role="alert">
      <p>Something went wrong. Please try again.</p>
      <button type="button" @click="load">Retry</button>
    </div>

    <template v-else-if="state.donations.length === 0">
      <p>You have not made a donation yet.</p>
      <p><RouterLink to="/" class="give-link">Donate</RouterLink></p>
    </template>

    <ul v-else class="donations">
      <li v-for="donation in state.donations" :key="donation.id">
        <div class="head">
          <span class="receipt">{{ donation.receiptNumber }}</span>
          <span class="amount">{{ formatCents(donation.amountCents) }}</span>
        </div>
        <p class="campaign">{{ donation.campaign.title }}</p>
        <p class="status" :data-status="donation.status">
          {{ STATUS_LABELS[donation.status] }} · {{ PRIVACY_LABELS[donation.privacyMode] }} ·
          {{ donation.donorName }}
        </p>
        <p v-if="donation.dedication !== null" class="note">
          {{ dedicationLabel(donation.dedication) }}
        </p>
        <p v-if="donation.message !== null" class="note">{{ donation.message }}</p>
        <time :datetime="donation.createdAt">
          {{ dateFormat.format(Date.parse(donation.createdAt)) }}
        </time>
        <time
          v-if="donation.refundedAt !== null"
          :datetime="donation.refundedAt"
          class="refunded-on"
        >
          Refunded {{ dateFormat.format(Date.parse(donation.refundedAt)) }}
        </time>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.donations {
  list-style: none;
  margin: 0;
  padding: 0;
}

li {
  padding: 0.75rem 0;
  border-bottom: 1px solid #e5e7eb;
}

.head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.receipt,
.campaign,
.status,
.note {
  overflow-wrap: anywhere;
}

.amount {
  white-space: nowrap;
  font-weight: 600;
}

.campaign,
.status,
.note {
  margin: 0.25rem 0 0;
}

.status[data-status='refunded'] {
  color: #92400e;
}

.note {
  font-style: italic;
  white-space: pre-line;
}

time {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #4b5563;
}

.give-link,
button {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 1.25rem;
  font: inherit;
}
</style>

<script setup lang="ts">
import type { DonationRequest } from '@aangan/shared';
import { computed, shallowRef, watchEffect } from 'vue';
import CampaignTotals from '../components/campaign-totals.vue';
import DonationForm from '../components/donation-form.vue';
import DonationList from '../components/donation-list.vue';
import DonationResult from '../components/donation-result.vue';
import { useCampaign } from '../composables/use-campaign';
import { useDonation } from '../composables/use-donation';
import { formatCampaignDate } from '../format';
import NotFoundPage from './not-found-page.vue';

const props = defineProps<{ slug: string }>();
const { state, retry, refresh } = useCampaign(() => props.slug);
const donation = useDonation();
// Kept so "Try again" after a network failure sends the identical body, and so the same key.
const lastRequest = shallowRef<DonationRequest | null>(null);

const outcome = computed(() =>
  donation.state.value.status === 'finished' ? donation.state.value.outcome : null,
);
const gaveSuccessfully = computed(() => outcome.value?.kind === 'receipt');

async function give(request: DonationRequest): Promise<void> {
  lastRequest.value = request;
  await donation.submit(request);
  // A 201 moved the total; a 202 added a pending row. Either way the list may have changed.
  if (outcome.value?.kind === 'receipt') refresh();
}

function resubmit(): void {
  if (lastRequest.value !== null) void give(lastRequest.value);
}

watchEffect(() => {
  if (state.value.status === 'ready') document.title = state.value.campaign.title;
});
</script>

<template>
  <p v-if="state.status === 'loading'" role="status">Loading the campaign…</p>

  <div v-else-if="state.status === 'error'" role="alert">
    <p>Something went wrong. Please try again.</p>
    <button type="button" @click="retry">Retry</button>
  </div>

  <NotFoundPage v-else-if="state.status === 'not-found'" />

  <article v-else>
    <h1>{{ state.campaign.title }}</h1>
    <p v-if="state.campaign.story !== null" class="story">{{ state.campaign.story }}</p>

    <p v-if="state.campaign.phase === 'closed'" class="notice">
      This campaign is closed and no longer accepts donations.
    </p>
    <p
      v-else-if="state.campaign.phase === 'upcoming' && state.campaign.startsAt !== null"
      class="notice"
    >
      Opens {{ formatCampaignDate(state.campaign.startsAt) }}
    </p>

    <CampaignTotals :campaign="state.campaign" />

    <p v-if="state.campaign.phase === 'open'">
      <a href="#donate" class="donate-link">Donate</a>
    </p>

    <section v-if="state.campaign.phase === 'open'" id="donate" aria-labelledby="donate-heading">
      <h2 id="donate-heading">Make a donation</h2>
      <DonationResult
        v-if="outcome !== null"
        :outcome="outcome"
        @resubmit="resubmit"
        @dismiss="donation.reset"
      />
      <DonationForm
        v-if="!gaveSuccessfully"
        :campaign="state.campaign"
        :busy="donation.state.value.status === 'submitting'"
        @submit="give"
      />
    </section>

    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recent donations</h2>
      <DonationList :donations="state.donations" />
    </section>
  </article>
</template>

<style scoped>
.story {
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.notice {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: #fef3c7;
  color: #78350f;
}

.donate-link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 1.25rem;
  border-radius: 0.5rem;
  background: #166534;
  color: #fff;
  font-weight: 600;
  text-decoration: none;
}

button {
  min-height: 2.75rem;
  padding: 0 1.25rem;
  font: inherit;
}
</style>

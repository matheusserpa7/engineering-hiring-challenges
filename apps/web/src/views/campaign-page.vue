<script setup lang="ts">
import { watchEffect } from 'vue';
import CampaignTotals from '../components/campaign-totals.vue';
import DonationList from '../components/donation-list.vue';
import { useCampaign } from '../composables/use-campaign';
import { formatCampaignDate } from '../format';
import NotFoundPage from './not-found-page.vue';

const props = defineProps<{ slug: string }>();
const { state, retry } = useCampaign(() => props.slug);

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

button {
  min-height: 2.75rem;
  padding: 0 1.25rem;
  font: inherit;
}
</style>

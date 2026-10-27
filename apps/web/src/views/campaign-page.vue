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

  <article v-else class="campaign">
    <div class="main-col">
      <header class="intro">
        <p class="eyebrow">Himalaya Cultural Centre</p>
        <h1>{{ state.campaign.title }}</h1>
      </header>
      <p v-if="state.campaign.story !== null" class="story">{{ state.campaign.story }}</p>

      <p v-if="state.campaign.phase === 'closed'" class="alert warn">
        This campaign is closed and no longer accepts donations.
      </p>
      <p
        v-else-if="state.campaign.phase === 'upcoming' && state.campaign.startsAt !== null"
        class="alert warn"
      >
        Opens {{ formatCampaignDate(state.campaign.startsAt) }}
      </p>

      <ul class="trust">
        <li>
          <strong>A receipt number for every gift</strong>
          Quote it if you call the office.
        </li>
        <li>
          <strong>You choose how your name appears</strong>
          Public, family or anonymous, applied by our server before anything is shown.
        </li>
        <li>
          <strong>One gift, even if you press twice</strong>
          A repeated request is recognised and never charged again.
        </li>
      </ul>

      <section
        v-if="state.campaign.phase === 'open'"
        id="donate"
        class="card donate"
        aria-labelledby="donate-heading"
      >
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

      <section class="card recent" aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recent donations</h2>
        <DonationList :donations="state.donations" />
      </section>
    </div>

    <aside class="card give-card" aria-label="Campaign progress">
      <CampaignTotals :campaign="state.campaign" />
      <a v-if="state.campaign.phase === 'open'" href="#donate" class="btn primary lg donate-link">
        Donate
      </a>
    </aside>

    <a v-if="state.campaign.phase === 'open'" href="#donate" class="mobile-bar">
      <span class="num">{{ state.campaign.progressPercent }}% of goal</span>
      <span class="btn primary">Donate</span>
    </a>
  </article>
</template>

<style scoped>
.campaign {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 2rem;
  align-items: start;
}

.main-col {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-width: 0;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.story {
  max-width: 64ch;
  font-size: 1.05rem;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.trust {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
  color: var(--muted);
}

.trust strong {
  display: block;
  color: var(--ink);
}

.donate,
.recent {
  padding: 1.25rem;
  scroll-margin-top: 5rem;
}

.give-card {
  position: sticky;
  top: 5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  box-shadow: var(--shadow);
}

.donate-link {
  width: 100%;
}

.mobile-bar {
  display: none;
}

@media (max-width: 980px) {
  .campaign {
    grid-template-columns: minmax(0, 1fr);
  }

  .give-card {
    position: static;
    order: -1;
  }
}

@media (max-width: 760px) {
  .trust {
    grid-template-columns: minmax(0, 1fr);
  }

  .donate-link {
    display: none;
  }

  .mobile-bar {
    position: fixed;
    inset: auto 0 0;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.6rem max(1rem, env(safe-area-inset-right, 0px))
      calc(0.6rem + env(safe-area-inset-bottom, 0px)) max(1rem, env(safe-area-inset-left, 0px));
    background: var(--surface);
    border-top: 1px solid var(--line);
    color: var(--ink);
    font-weight: 600;
    text-decoration: none;
  }
}
</style>

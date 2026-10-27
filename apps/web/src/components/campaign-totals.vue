<script setup lang="ts">
import { formatCents, type PublicCampaign } from '@aangan/shared';
import { donorCountLabel, formatCampaignDate } from '../format';
import ProgressBar from './progress-bar.vue';

defineProps<{ campaign: PublicCampaign }>();
</script>

<template>
  <section class="totals" aria-labelledby="totals-heading">
    <h2 id="totals-heading" class="visually-hidden">Fundraising progress</h2>
    <p class="raised">
      <strong>{{ formatCents(campaign.raisedCents) }}</strong>
      raised of {{ formatCents(campaign.goalCents) }}
    </p>
    <ProgressBar
      :percent="campaign.progressPercent"
      :raised-cents="campaign.raisedCents"
      :goal-cents="campaign.goalCents"
    />
    <p class="meta">
      {{ donorCountLabel(campaign.donorCount) }}
      <template v-if="campaign.phase === 'open' && campaign.endsAt !== null">
        · Ends {{ formatCampaignDate(campaign.endsAt) }}
      </template>
    </p>
  </section>
</template>

<style scoped>
.totals {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.raised {
  margin: 0;
  color: var(--muted);
}

.raised strong {
  display: block;
  margin-bottom: 0.25rem;
  font-family: var(--font-display);
  font-size: 2.4rem;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.meta {
  margin: 0;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>

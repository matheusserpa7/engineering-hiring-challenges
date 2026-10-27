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
.raised {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
}

.raised strong {
  font-size: 1.5rem;
}

.meta {
  margin: 0.5rem 0 0;
  color: #374151;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

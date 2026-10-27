<script setup lang="ts">
import { formatCents, type PublicDonation } from '@aangan/shared';
import { relativeTime } from '../format';

defineProps<{ donations: PublicDonation[] }>();

const exactTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function dedicationLabel(dedication: NonNullable<PublicDonation['dedication']>): string {
  const prefix = dedication.type === 'in_honor_of' ? 'In honor of' : 'In memory of';
  return `${prefix} ${dedication.name}`;
}
</script>

<template>
  <p v-if="donations.length === 0">No donations yet. Be the first to give.</p>
  <ul v-else class="donations">
    <li v-for="donation in donations" :key="donation.id">
      <div class="head">
        <span class="name">{{ donation.displayName }}</span>
        <span class="amount">{{ formatCents(donation.amountCents) }}</span>
      </div>
      <p v-if="donation.dedication !== null" class="dedication">
        {{ dedicationLabel(donation.dedication) }}
      </p>
      <p v-if="donation.message !== null" class="message" data-testid="donation-message">
        {{ donation.message }}
      </p>
      <time
        :datetime="donation.createdAt"
        :title="exactTime.format(Date.parse(donation.createdAt))"
      >
        {{ relativeTime(donation.createdAt) }}
      </time>
    </li>
  </ul>
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

.name,
.dedication,
.message {
  overflow-wrap: anywhere;
}

.amount {
  white-space: nowrap;
  font-weight: 600;
}

.dedication,
.message {
  margin: 0.25rem 0 0;
}

.dedication {
  font-style: italic;
}

time {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #4b5563;
}
</style>

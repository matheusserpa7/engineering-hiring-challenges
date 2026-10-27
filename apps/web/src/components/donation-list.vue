<script setup lang="ts">
import { formatCents, type PublicDonation } from '@aangan/shared';
import { avatarInitial, relativeTime } from '../format';

defineProps<{ donations: PublicDonation[] }>();

const exactTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function dedicationLabel(dedication: NonNullable<PublicDonation['dedication']>): string {
  const prefix = dedication.type === 'in_honor_of' ? 'In honor of' : 'In memory of';
  return `${prefix} ${dedication.name}`;
}
</script>

<template>
  <p v-if="donations.length === 0" class="empty">No donations yet. Be the first to give.</p>
  <ul v-else class="donations">
    <li v-for="donation in donations" :key="donation.id">
      <span class="avatar" aria-hidden="true">{{ avatarInitial(donation.displayName) }}</span>
      <div class="body">
        <span class="name">{{ donation.displayName }}</span>
        <p v-if="donation.dedication !== null" class="dedication">
          {{ dedicationLabel(donation.dedication) }}
        </p>
        <p v-if="donation.message !== null" class="message" data-testid="donation-message">
          {{ donation.message }}
        </p>
      </div>
      <div class="side">
        <span class="amount num">{{ formatCents(donation.amountCents) }}</span>
        <time
          :datetime="donation.createdAt"
          :title="exactTime.format(Date.parse(donation.createdAt))"
        >
          {{ relativeTime(donation.createdAt) }}
        </time>
      </div>
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.75rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--line);
}

li:last-child {
  border-bottom: 0;
}

.avatar {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background: var(--brand-soft);
  color: var(--brand-strong);
  font-weight: 700;
}

.name,
.dedication,
.message {
  overflow-wrap: anywhere;
}

.name {
  font-weight: 600;
}

.dedication,
.message {
  margin: 0.2rem 0 0;
}

.dedication {
  font-size: 0.875rem;
  color: var(--marigold-ink);
}

.message {
  color: var(--muted);
  font-style: italic;
}

.message::before {
  content: '“';
}

.message::after {
  content: '”';
}

.side {
  text-align: right;
}

.amount {
  display: block;
  font-weight: 700;
  white-space: nowrap;
}

time {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
}

.empty {
  color: var(--muted);
}
</style>

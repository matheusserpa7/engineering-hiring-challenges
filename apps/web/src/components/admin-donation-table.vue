<script setup lang="ts">
import { formatCents, type AdminDonation } from '@aangan/shared';
import RefundForm from './refund-form.vue';

type Sort = 'createdAt' | 'amountCents';

defineProps<{
  rows: AdminDonation[];
  sort: Sort;
  dir: 'asc' | 'desc';
  refundingId: string | null;
}>();
const emit = defineEmits<{
  sort: [column: Sort];
  'open-refund': [id: string];
  'cancel-refund': [];
  refunded: [donation: AdminDonation];
  stale: [message: string];
  unauthenticated: [];
}>();

const STATUS_LABELS: Record<AdminDonation['status'], string> = {
  completed: 'Completed',
  refunded: 'Refunded',
  pending: 'Processing',
  failed: 'Failed',
};

// The browser's own zone and locale, like the donor's page: the office reads local times.
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ariaSort(
  active: Sort,
  dir: 'asc' | 'desc',
  column: Sort,
): 'ascending' | 'descending' | undefined {
  if (active !== column) return undefined;
  return dir === 'asc' ? 'ascending' : 'descending';
}
</script>

<template>
  <table class="donations">
    <thead>
      <tr>
        <th scope="col">Receipt</th>
        <th scope="col">Donor</th>
        <th scope="col" :aria-sort="ariaSort(sort, dir, 'createdAt')">
          <button type="button" data-sort="createdAt" @click="emit('sort', 'createdAt')">
            Date
          </button>
        </th>
        <th scope="col" :aria-sort="ariaSort(sort, dir, 'amountCents')">
          <button type="button" data-sort="amountCents" @click="emit('sort', 'amountCents')">
            Amount
          </button>
        </th>
        <th scope="col">Status</th>
        <th scope="col"><span class="visually-hidden">Actions</span></th>
      </tr>
    </thead>
    <tbody>
      <template v-for="row in rows" :key="row.id">
        <tr>
          <td data-label="Receipt">{{ row.receiptNumber }}</td>
          <td data-label="Donor">
            <span class="who">
              <span class="name">{{ row.donorName }}</span>
              <span class="email">{{ row.donorEmail }}</span>
            </span>
          </td>
          <td data-label="Date">
            <time :datetime="row.createdAt">{{
              dateFormat.format(Date.parse(row.createdAt))
            }}</time>
          </td>
          <td data-label="Amount" class="amount">{{ formatCents(row.amountCents) }}</td>
          <td data-label="Status">{{ STATUS_LABELS[row.status] }}</td>
          <td class="actions">
            <button
              v-if="row.status === 'completed' && refundingId !== row.id"
              type="button"
              data-action="refund"
              @click="emit('open-refund', row.id)"
            >
              Refund
            </button>
          </td>
        </tr>
        <tr v-if="refundingId === row.id" class="refund-row">
          <td colspan="6">
            <RefundForm
              :donation="row"
              @refunded="emit('refunded', $event)"
              @stale="emit('stale', $event)"
              @unauthenticated="emit('unauthenticated')"
              @cancel="emit('cancel-refund')"
            />
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>

<style scoped>
.donations {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.name,
.email {
  display: block;
}

.email {
  font-size: 0.875rem;
  color: #4b5563;
}

.amount {
  white-space: nowrap;
  font-weight: 600;
}

button {
  min-height: 2.75rem;
  padding: 0 0.75rem;
  font: inherit;
}

th button {
  padding: 0;
  border: 0;
  background: none;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

th[aria-sort='ascending'] button::after {
  content: ' ▲';
}

th[aria-sort='descending'] button::after {
  content: ' ▼';
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

/* One card per donation on a phone: the labels come from data-label. */
@media (max-width: 40rem) {
  thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .donations,
  tbody,
  tr,
  td {
    display: block;
  }

  tr {
    padding: 0.5rem 0;
    border-bottom: 1px solid #e5e7eb;
  }

  td {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border: 0;
    padding: 0.25rem 0.5rem;
  }

  td[data-label]::before {
    content: attr(data-label);
    flex: none;
    font-weight: 600;
  }

  .who {
    min-width: 0;
    text-align: right;
  }

  .refund-row td {
    display: block;
  }
}
</style>

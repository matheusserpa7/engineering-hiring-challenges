<script setup lang="ts">
import { formatCents, type AdminDonation } from '@aangan/shared';
import { computed } from 'vue';
import RefundForm from './refund-form.vue';

type Sort = 'createdAt' | 'amountCents';

const props = defineProps<{
  rows: AdminDonation[];
  sort: Sort;
  dir: 'asc' | 'desc';
  refundingId: string | null;
}>();
const refundingRow = computed(() => props.rows.find((row) => row.id === props.refundingId));
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
  <div class="table-wrap card">
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
            <td data-label="Receipt" class="mono">{{ row.receiptNumber }}</td>
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
            <td data-label="Amount" class="amount num">{{ formatCents(row.amountCents) }}</td>
            <td data-label="Status">
              <span class="pill" :data-status="row.status">{{ STATUS_LABELS[row.status] }}</span>
            </td>
            <td class="actions">
              <button
                v-if="row.status === 'completed'"
                type="button"
                data-action="refund"
                class="btn"
                @click="emit('open-refund', row.id)"
              >
                Refund
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <RefundForm
      v-if="refundingRow !== undefined"
      :key="refundingRow.id"
      :donation="refundingRow"
      @refunded="emit('refunded', $event)"
      @stale="emit('stale', $event)"
      @unauthenticated="emit('unauthenticated')"
      @cancel="emit('cancel-refund')"
    />
  </div>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}

.donations {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

th {
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

tbody tr:last-child td {
  border-bottom: 0;
}

td.mono {
  white-space: nowrap;
}

.name,
.email {
  display: block;
}

.name {
  font-weight: 600;
}

.email {
  font-size: 0.875rem;
  color: var(--muted);
}

.amount {
  white-space: nowrap;
  font-weight: 700;
  text-align: right;
}

th button {
  min-height: 2.75rem;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 700;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  cursor: pointer;
}

th button:hover {
  color: var(--ink);
}

th[aria-sort='ascending'] button::after {
  content: ' ▲';
}

th[aria-sort='descending'] button::after {
  content: ' ▼';
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
    border-bottom: 1px solid var(--line);
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
}
</style>

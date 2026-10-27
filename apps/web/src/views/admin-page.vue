<script setup lang="ts">
import type { AdminDonation } from '@aangan/shared';
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AdminDonationTable from '../components/admin-donation-table.vue';
import { useAdminDonations } from '../composables/use-admin-donations';
import { useSession } from '../composables/use-session';

const list = useAdminDonations();
const session = useSession();
const router = useRouter();
const route = useRoute();

const refundingId = ref<string | null>(null);
// Plain text in the template: it names a donor, and a donor typed their own name.
const notice = ref<string | null>(null);

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
] as const;

function onRefunded(donation: AdminDonation): void {
  refundingId.value = null;
  list.replaceRow(donation);
  notice.value = `Refunded ${donation.receiptNumber} (${donation.donorName}).`;
}

async function onStale(message: string): Promise<void> {
  refundingId.value = null;
  notice.value = message;
  await list.reload();
}

async function onUnauthenticated(): Promise<void> {
  session.expire();
  await router.push({ path: '/login', query: { next: route.fullPath } });
}

onMounted(list.reload);
</script>

<template>
  <section aria-labelledby="admin-heading">
    <h1 id="admin-heading">Donations</h1>

    <form role="search" class="filters" @submit.prevent="list.search">
      <label for="admin-q">Search by name or email</label>
      <input id="admin-q" v-model="list.q.value" type="search" name="q" autocomplete="off" />
      <button type="submit">Search</button>
      <label for="admin-status">Status</label>
      <select
        id="admin-status"
        name="status"
        :value="list.statusFilter.value"
        @change="list.setStatus(($event.target as HTMLSelectElement).value as never)"
      >
        <option v-for="option in STATUS_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </form>

    <p v-if="notice !== null" role="status" class="notice">{{ notice }}</p>

    <p v-if="list.state.value.status === 'loading'" role="status">Loading donations…</p>

    <div v-else-if="list.state.value.status === 'error'" role="alert">
      <p v-if="list.state.value.forbidden">You do not have access to this page.</p>
      <template v-else>
        <p>Something went wrong. Please try again.</p>
        <button type="button" @click="list.reload">Retry</button>
      </template>
    </div>

    <template v-else>
      <p>
        {{ list.state.value.page.total }}
        {{ list.state.value.page.total === 1 ? 'donation' : 'donations' }}
      </p>
      <p v-if="list.state.value.page.data.length === 0">No donations match.</p>
      <AdminDonationTable
        v-else
        :rows="list.state.value.page.data"
        :sort="list.sort.value"
        :dir="list.dir.value"
        :refunding-id="refundingId"
        @sort="list.toggleSort"
        @open-refund="refundingId = $event"
        @cancel-refund="refundingId = null"
        @refunded="onRefunded"
        @stale="onStale"
        @unauthenticated="onUnauthenticated"
      />
      <nav aria-label="Pages" class="pager">
        <button
          type="button"
          data-page="previous"
          :disabled="list.state.value.page.page <= 1"
          @click="list.goTo(list.state.value.page.page - 1)"
        >
          Previous
        </button>
        <span>
          Page {{ list.state.value.page.page }} of
          {{ Math.max(1, list.state.value.page.totalPages) }}
        </span>
        <button
          type="button"
          data-page="next"
          :disabled="list.state.value.page.page >= list.state.value.page.totalPages"
          @click="list.goTo(list.state.value.page.page + 1)"
        >
          Next
        </button>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  max-width: 28rem;
  margin-bottom: 1rem;
}

input,
select,
button {
  box-sizing: border-box;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  font: inherit;
}

.notice {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: #dcfce7;
  color: #14532d;
  overflow-wrap: anywhere;
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}
</style>

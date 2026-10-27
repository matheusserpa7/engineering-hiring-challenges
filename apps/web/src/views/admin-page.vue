<script setup lang="ts">
import type { AdminDonation } from '@aangan/shared';
import { nextTick, onMounted, ref } from 'vue';
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

const noticeEl = ref<HTMLElement | null>(null);

// The Refund button the dialog would return focus to is gone once the row is refunded, so the
// notice that says what happened takes focus instead.
async function showNotice(message: string): Promise<void> {
  notice.value = message;
  await nextTick();
  noticeEl.value?.focus();
}

function onRefunded(donation: AdminDonation): void {
  refundingId.value = null;
  list.replaceRow(donation);
  void showNotice(`Refunded ${donation.receiptNumber} (${donation.donorName}).`);
}

async function onStale(message: string): Promise<void> {
  refundingId.value = null;
  void showNotice(message);
  await list.reload();
}

async function onUnauthenticated(): Promise<void> {
  session.expire();
  await router.push({ path: '/login', query: { next: route.fullPath } });
}

onMounted(list.reload);
</script>

<template>
  <section class="admin" aria-labelledby="admin-heading">
    <header class="page-head">
      <p class="eyebrow">Office</p>
      <h1 id="admin-heading">Donations</h1>
    </header>

    <form role="search" class="filters card" @submit.prevent="list.search">
      <label for="admin-q">Search by name or email</label>
      <input
        id="admin-q"
        v-model="list.q.value"
        class="input"
        type="search"
        name="q"
        autocomplete="off"
      />
      <button type="submit" class="btn primary">Search</button>
      <label for="admin-status">Status</label>
      <select
        id="admin-status"
        class="input"
        name="status"
        :value="list.statusFilter.value"
        @change="list.setStatus(($event.target as HTMLSelectElement).value as never)"
      >
        <option v-for="option in STATUS_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </form>

    <p v-if="notice !== null" ref="noticeEl" tabindex="-1" role="status" class="alert ok">
      {{ notice }}
    </p>

    <p v-if="list.state.value.status === 'loading'" role="status">Loading donations…</p>

    <div v-else-if="list.state.value.status === 'error'" role="alert">
      <p v-if="list.state.value.forbidden">You do not have access to this page.</p>
      <template v-else>
        <p>Something went wrong. Please try again.</p>
        <button type="button" class="btn" @click="list.reload">Retry</button>
      </template>
    </div>

    <template v-else>
      <p class="count muted num">
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
          class="btn"
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
          class="btn"
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
.admin {
  display: grid;
  gap: 1rem;
}

.page-head {
  display: grid;
  gap: 0.35rem;
}

.filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  padding: 1rem;
}

label {
  font-weight: 600;
}

.count {
  margin: 0;
}

.alert {
  overflow-wrap: anywhere;
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

@media (min-width: 760px) {
  .filters {
    grid-template-columns: auto minmax(12rem, 1fr) auto auto auto;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }
}
</style>

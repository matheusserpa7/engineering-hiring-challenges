import {
  AdminDonationPageSchema,
  DEFAULT_ADMIN_PAGE_SIZE,
  type AdminDonation,
  type AdminDonationPage,
} from '@aangan/shared';
import { shallowRef, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, getJson } from '../api';
import { useSession } from './use-session';

type Status = AdminDonation['status'];
type Sort = 'createdAt' | 'amountCents';

export type AdminListState =
  | { status: 'loading' }
  | { status: 'ready'; page: AdminDonationPage }
  | { status: 'error'; forbidden: boolean };

// The search text and filters live here, not in the address bar: a name or an email in the URL
// would reach nginx's access log and the Referer header (tech spec 005, search text).
export function useAdminDonations(): {
  state: Ref<AdminListState>;
  q: Ref<string>;
  statusFilter: Ref<Status | ''>;
  sort: Ref<Sort>;
  dir: Ref<'asc' | 'desc'>;
  search: () => Promise<void>;
  setStatus: (status: Status | '') => Promise<void>;
  toggleSort: (column: Sort) => Promise<void>;
  goTo: (page: number) => Promise<void>;
  reload: () => Promise<void>;
  replaceRow: (row: AdminDonation) => void;
} {
  const session = useSession();
  const router = useRouter();
  const route = useRoute();

  const state = shallowRef<AdminListState>({ status: 'loading' });
  const q = shallowRef('');
  const statusFilter = shallowRef<Status | ''>('');
  const sort = shallowRef<Sort>('createdAt');
  const dir = shallowRef<'asc' | 'desc'>('desc');
  const pageNumber = shallowRef(1);
  // Only the newest answer may reach the screen: a slow earlier request must not overwrite it.
  let latest = 0;

  function queryString(): string {
    const params = new URLSearchParams();
    const text = q.value.trim();
    if (text !== '') params.set('q', text);
    if (statusFilter.value !== '') params.set('status', statusFilter.value);
    params.set('sort', sort.value);
    params.set('dir', dir.value);
    params.set('page', String(pageNumber.value));
    params.set('pageSize', String(DEFAULT_ADMIN_PAGE_SIZE));
    return params.toString();
  }

  async function load(): Promise<void> {
    const request = ++latest;
    state.value = { status: 'loading' };
    try {
      const page = await getJson(`/api/admin/donations?${queryString()}`, AdminDonationPageSchema);
      if (request === latest) state.value = { status: 'ready', page };
    } catch (error) {
      if (request !== latest) return;
      if (error instanceof ApiError && error.status === 401) {
        session.expire();
        await router.push({ path: '/login', query: { next: route.fullPath } });
        return;
      }
      state.value = {
        status: 'error',
        forbidden: error instanceof ApiError && error.status === 403,
      };
    }
  }

  async function resetToFirstPage(): Promise<void> {
    pageNumber.value = 1;
    await load();
  }

  return {
    state,
    q,
    statusFilter,
    sort,
    dir,
    search: resetToFirstPage,
    setStatus: (status) => {
      statusFilter.value = status;
      return resetToFirstPage();
    },
    toggleSort: (column) => {
      if (sort.value === column) dir.value = dir.value === 'desc' ? 'asc' : 'desc';
      else {
        sort.value = column;
        dir.value = 'desc';
      }
      return resetToFirstPage();
    },
    goTo: (page) => {
      pageNumber.value = page;
      return load();
    },
    reload: load,
    replaceRow: (row) => {
      if (state.value.status !== 'ready') return;
      const { page } = state.value;
      state.value = {
        status: 'ready',
        page: { ...page, data: page.data.map((item) => (item.id === row.id ? row : item)) },
      };
    },
  };
}

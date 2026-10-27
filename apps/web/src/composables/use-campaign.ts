import {
  PublicCampaignSchema,
  PublicDonationListSchema,
  type PublicCampaign,
  type PublicDonation,
} from '@aangan/shared';
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import { ApiError, getJson } from '../api';

export type CampaignState =
  | { status: 'loading' }
  | { status: 'ready'; campaign: PublicCampaign; donations: PublicDonation[] }
  | { status: 'not-found' }
  | { status: 'error' };

const RECENT_LIMIT = 20;

// The campaign and its list are one page: a half-rendered page would need two sets of states
// for no visitor benefit, so they load together and fail together.
export function useCampaign(slug: () => string): {
  state: Ref<CampaignState>;
  retry: () => void;
  refresh: () => void;
} {
  const state = shallowRef<CampaignState>({ status: 'loading' });
  let latest = 0;
  let controller: AbortController | undefined;

  // A silent load keeps the page on screen: after a gift the totals change in place, with no
  // loading state, and a failed refresh leaves the old numbers rather than an error page.
  async function load(silent = false): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    // The counter, not the abort, is what keeps a late response off the screen: an abort only
    // saves bandwidth, and a response can resolve in the same tick it is aborted.
    const request = ++latest;
    if (!silent) state.value = { status: 'loading' };

    const path = `/api/campaigns/${encodeURIComponent(slug())}`;
    try {
      const [campaign, list] = await Promise.all([
        getJson(path, PublicCampaignSchema, { signal }),
        getJson(`${path}/donations?limit=${String(RECENT_LIMIT)}`, PublicDonationListSchema, {
          signal,
        }),
      ]);
      if (request === latest) state.value = { status: 'ready', campaign, donations: list.data };
    } catch (error) {
      if (request !== latest || silent) return;
      state.value =
        error instanceof ApiError && error.code === 'not_found'
          ? { status: 'not-found' }
          : { status: 'error' };
    }
  }

  watch(slug, () => void load(), { immediate: true });
  onScopeDispose(() => {
    latest++;
    controller?.abort();
  });

  return { state, retry: () => void load(), refresh: () => void load(true) };
}

import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import type { Session } from './composables/use-session';
import CampaignPage from './views/campaign-page.vue';
import LoginPage from './views/login-page.vue';
import MyDonationsPage from './views/my-donations-page.vue';
import NotFoundPage from './views/not-found-page.vue';

// The one campaign the site is about; the path form exists so any seeded campaign has a URL.
const MAIN_CAMPAIGN = 'aangan-courtyard';

// History mode: nginx already falls back to index.html for unknown paths.
export function createAppRouter(history: RouterHistory = createWebHistory(), session?: Session) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', component: CampaignPage, props: { slug: MAIN_CAMPAIGN } },
      { path: '/campaigns/:slug', component: CampaignPage, props: true },
      { path: '/login', component: LoginPage },
      { path: '/me', component: MyDonationsPage, meta: { requiresSession: true } },
      { path: '/:pathMatch(.*)*', component: NotFoundPage },
    ],
  });

  // This only decides which page to show. The API refuses a request without a session on its
  // own, so skipping or breaking the guard exposes no data.
  router.beforeEach(async (to) => {
    if (session === undefined || to.meta.requiresSession !== true) return true;
    await session.ensureLoaded();
    if (session.state.value.status === 'signed-in') return true;
    return { path: '/login', query: { next: to.fullPath } };
  });

  return router;
}

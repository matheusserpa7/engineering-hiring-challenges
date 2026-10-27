import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import CampaignPage from './views/campaign-page.vue';
import NotFoundPage from './views/not-found-page.vue';

// The one campaign the site is about; the path form exists so any seeded campaign has a URL.
const MAIN_CAMPAIGN = 'aangan-courtyard';

// History mode: nginx already falls back to index.html for unknown paths.
export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: '/', component: CampaignPage, props: { slug: MAIN_CAMPAIGN } },
      { path: '/campaigns/:slug', component: CampaignPage, props: true },
      { path: '/:pathMatch(.*)*', component: NotFoundPage },
    ],
  });
}

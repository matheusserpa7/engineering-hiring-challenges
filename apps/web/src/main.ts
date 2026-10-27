import { createApp } from 'vue';
import App from './App.vue';
import { SESSION_KEY, createSession } from './composables/use-session';
import { createAppRouter } from './router';

const session = createSession();

createApp(App).provide(SESSION_KEY, session).use(createAppRouter(undefined, session)).mount('#app');

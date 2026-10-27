import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  // Nothing is inlined as a data: URL. The CSP (default-src 'self') blocks those behind nginx
  // while dev allows them, so the first small image would only break in production.
  build: { assetsInlineLimit: 0 },
  server: {
    // Mirrors nginx in Docker: the browser only ever talks to one origin.
    proxy: { '/api': 'http://localhost:4000' },
  },
  // Components render into jsdom. It has no layout engine, so layout is checked by hand.
  test: { environment: 'jsdom' },
});

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  server: {
    // Mirrors nginx in Docker: the browser only ever talks to one origin.
    proxy: { '/api': 'http://localhost:4000' },
  },
  // Components render into jsdom. It has no layout engine, so layout is checked by hand.
  test: { environment: 'jsdom' },
});

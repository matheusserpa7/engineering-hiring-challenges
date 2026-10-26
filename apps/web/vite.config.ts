import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    // Mirrors nginx in Docker: the browser only ever talks to one origin.
    proxy: { '/api': 'http://localhost:4000' },
  },
});

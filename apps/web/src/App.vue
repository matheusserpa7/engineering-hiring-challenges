<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <main>
    <RouterView />
  </main>
</template>

<style>
body {
  margin: 0;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'Noto Sans',
    'Noto Sans Devanagari',
    sans-serif;
  line-height: 1.5;
  color: #111827;
  background: #fff;
}

main {
  box-sizing: border-box;
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem;
}
</style>

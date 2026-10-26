<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getJson } from './api';

const apiStatus = ref<'checking' | 'ok' | 'unavailable'>('checking');

onMounted(async () => {
  try {
    await getJson('/api/health');
    apiStatus.value = 'ok';
  } catch {
    apiStatus.value = 'unavailable';
  }
});
</script>

<template>
  <main>
    <h1>Aangan</h1>
    <p>API: {{ apiStatus }}</p>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { z } from 'zod';
import { getJson } from './api';

const Health = z.strictObject({ status: z.literal('ok') });
const apiStatus = ref<'checking' | 'ok' | 'unavailable'>('checking');

onMounted(async () => {
  try {
    await getJson('/api/health', Health);
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

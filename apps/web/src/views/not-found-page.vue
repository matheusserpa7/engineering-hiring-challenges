<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <section class="not-found">
    <p class="eyebrow">404</p>
    <h1>Campaign not found</h1>
    <p>We could not find that campaign.</p>
    <p><RouterLink to="/" class="btn primary">Go to the main campaign</RouterLink></p>
  </section>
</template>

<style scoped>
.not-found {
  display: grid;
  justify-items: start;
  gap: 0.75rem;
  max-width: 36rem;
  margin: 3rem auto;
}
</style>

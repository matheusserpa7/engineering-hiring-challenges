<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <section>
    <h1>Campaign not found</h1>
    <p>We could not find that campaign.</p>
    <p><RouterLink to="/">Go to the main campaign</RouterLink></p>
  </section>
</template>

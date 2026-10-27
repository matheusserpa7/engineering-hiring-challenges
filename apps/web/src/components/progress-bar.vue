<script setup lang="ts">
import { formatCents } from '@aangan/shared';
import { computed } from 'vue';

const props = defineProps<{ percent: number; raisedCents: number; goalCents: number }>();

// The API floors the percentage and does not cap it, so a campaign past its goal honestly
// reads 115%. Only the drawing is capped.
const fillPercent = computed(() => Math.min(props.percent, 100));
const valueText = computed(
  () =>
    `${String(props.percent)}% of goal: ${formatCents(props.raisedCents)} of ${formatCents(props.goalCents)}`,
);
</script>

<template>
  <div class="progress">
    <div
      class="track"
      role="progressbar"
      aria-label="Progress toward the goal"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="fillPercent"
      :aria-valuetext="valueText"
    >
      <div
        class="fill"
        data-testid="progress-fill"
        :style="{ width: `${String(fillPercent)}%` }"
      ></div>
    </div>
    <span class="label">{{ percent }}%</span>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.track {
  flex: 1;
  height: 0.75rem;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
}

.fill {
  height: 100%;
  background: #166534;
}

.label {
  font-weight: 600;
  min-width: 3ch;
}
</style>

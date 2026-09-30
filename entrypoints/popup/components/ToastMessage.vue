<script setup lang="ts">
import AppIcon from '@/modules/ui/AppIcon.vue';

defineProps<{ toast: { message: string; type: 'success' | 'error' } | null }>();
</script>

<template>
  <div v-if="toast" class="toast" :class="toast.type" role="status">
    <AppIcon :name="toast.type === 'success' ? 'check' : 'alert'" :size="14" />
    <span>{{ toast.message }}</span>
  </div>
</template>

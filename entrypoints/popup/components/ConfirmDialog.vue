<script setup lang="ts">
defineProps<{
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
}>();

defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="$emit('cancel')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <p>{{ text }}</p>
      <div class="modal-actions">
        <button type="button" @click="$emit('cancel')">{{ cancelLabel }}</button>
        <button class="danger-action" type="button" @click="$emit('confirm')">
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

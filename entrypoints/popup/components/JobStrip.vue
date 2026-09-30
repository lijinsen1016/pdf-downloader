<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppIcon from '@/modules/ui/AppIcon.vue';
import type { PdfRecord } from '@/modules/shared/types';
import type { PopupStore } from '../usePopupStore';

const { t } = useI18n();
const props = defineProps<{ store: PopupStore; record: PdfRecord }>();

const ACTIVE_STATUSES = ['queued', 'fetching', 'starting', 'downloading'];

function jobState(): string {
  return props.store.jobForRecord(props.record.id)?.status ?? '';
}

function isJobActive(): boolean {
  return ACTIVE_STATUSES.includes(jobState());
}
</script>

<template>
  <div v-if="jobState()" class="job-strip" :class="jobState()">
    <span>{{ store.statusForRecord(record.id) }}</span>
    <progress
      v-if="jobState() === 'downloading'"
      :value="store.progressForRecord(record.id)"
      max="100"
    ></progress>
    <button
      v-if="isJobActive()"
      class="job-close"
      type="button"
      :aria-label="t('app.cancel')"
      @click="store.cancelForRecord(record.id)"
    >
      <AppIcon name="close" :size="11" />
    </button>
    <button
      v-if="jobState() === 'failed'"
      class="retry"
      type="button"
      @click="store.downloadRecord(record.id)"
    >
      {{ t('app.retry') }}
    </button>
    <span
      v-if="jobState() === 'failed'"
      class="job-error"
      :title="store.errorForRecord(record.id)"
    >
      {{ store.errorTextForRecord(record.id) || t('message.downloadFailed') }}
    </span>
  </div>
</template>

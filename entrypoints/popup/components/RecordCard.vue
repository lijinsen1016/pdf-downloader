<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppIcon from '@/modules/ui/AppIcon.vue';
import type { PdfRecord } from '@/modules/shared/types';
import type { PopupStore } from '../usePopupStore';
import JobStrip from './JobStrip.vue';

const { t } = useI18n();
const props = defineProps<{ store: PopupStore; record: PdfRecord }>();

function isSelected(): boolean {
  return props.store.selectedIds.has(props.record.id);
}
</script>

<template>
  <article
    class="record-card"
    :class="{
      selected: isSelected(),
      'dom-source': record.source === 'dom',
      'auth-source': record.auth.cookie || record.auth.authHeaders.length > 0
    }"
  >
    <label class="check-control">
      <input
        type="checkbox"
        :checked="isSelected()"
        :aria-label="record.fileName"
        @change="store.toggleSelected(record.id)"
      />
      <span class="check-face"><AppIcon name="check" :size="12" /></span>
    </label>

    <div class="file-glyph" aria-hidden="true"><AppIcon name="file" :size="18" /></div>

    <div class="record-body">
      <h3 class="record-title" :title="record.fileName">{{ record.fileName }}</h3>
      <div class="record-subtitle">
        <span class="host" :title="record.url">{{ record.host }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ store.formatTime(record.capturedAt) }}</span>
      </div>
      <div class="record-meta">
        <span v-if="record.size">{{ store.formatSize(record.size) }}</span>
        <span v-if="record.source === 'dom'" class="pill source">{{ t('app.pageLink') }}</span>
        <span v-if="record.method === 'POST'" class="pill post">{{ t('app.methodPost') }}</span>
        <span v-if="record.auth.cookie || record.auth.authHeaders.length" class="pill auth">
          🔒 {{ t('message.loginRequired') }}
        </span>
        <span
          v-if="record.auth.tokenRef || record.auth.bearerTokenRef"
          class="pill session"
          :title="t('message.sessionOnly')"
        >
          {{ t('message.sessionOnly') }}
        </span>
      </div>

      <JobStrip :store="store" :record="record" />
    </div>

    <div class="record-actions">
      <button
        class="row-action download"
        type="button"
        :title="t('app.download')"
        :aria-label="t('app.download')"
        :disabled="Boolean(store.activeJobForRecord(record.id))"
        @click="store.downloadRecord(record.id)"
      >
        <AppIcon name="download" :size="15" />
      </button>
      <button
        class="row-action"
        type="button"
        :title="t('app.openPdf')"
        :aria-label="t('app.openPdf')"
        @click="store.openRecord(record.id)"
      >
        <AppIcon name="open" :size="14" />
      </button>
      <button
        class="row-action"
        type="button"
        :title="t('app.copyUrl')"
        :aria-label="t('app.copyUrl')"
        @click="store.copyUrl(record.url)"
      >
        <AppIcon name="copy" :size="14" />
      </button>
      <button
        class="row-action danger"
        type="button"
        :title="t('app.delete')"
        :aria-label="t('app.delete')"
        @click="store.deleteRecord(record.id)"
      >
        <AppIcon name="delete" :size="14" />
      </button>
    </div>
  </article>
</template>

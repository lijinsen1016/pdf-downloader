<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIcon from '@/modules/ui/AppIcon.vue';
import { isToday } from '@/modules/shared/time';
import type { DownloadHistoryItem } from '@/modules/shared/types';
import type { PopupStore } from '../usePopupStore';

const { t } = useI18n();
const props = defineProps<{ store: PopupStore }>();

interface HistoryGroup {
  key: string;
  label: string;
  items: DownloadHistoryItem[];
}

const historyGroups = computed<HistoryGroup[]>(() => {
  const buckets: HistoryGroup[] = [
    { key: 'today', label: t('time.today'), items: [] },
    { key: 'earlier', label: t('time.earlier'), items: [] }
  ];

  for (const item of props.store.filteredHistory) {
    const bucket = isToday(item.downloadedAt) ? 0 : 1;
    buckets[bucket]?.items.push(item);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
});
</script>

<template>
  <div v-if="!store.settings.historyEnabled" class="empty-state">
    <div class="empty-art"><AppIcon name="history" :size="30" /></div>
    <h2>{{ t('message.historyDisabled') }}</h2>
    <p>{{ t('message.historyHint') }}</p>
    <button class="primary-action" type="button" @click="store.openOptions">
      <AppIcon name="settings" :size="15" />
      <span>{{ t('app.options') }}</span>
    </button>
  </div>

  <div v-else-if="!store.history.length" class="empty-state">
    <div class="empty-art"><AppIcon name="history" :size="30" /></div>
    <h2>{{ t('message.historyEmpty') }}</h2>
    <p>{{ t('message.historyHint') }}</p>
  </div>

  <div v-else-if="!store.filteredHistory.length" class="empty-state">
    <div class="empty-art"><AppIcon name="search" :size="30" /></div>
    <h2>{{ t('message.noMatch') }}</h2>
    <button class="primary-action" type="button" @click="store.clearSearch">
      <AppIcon name="close" :size="14" />
      <span>{{ t('app.clearSearch') }}</span>
    </button>
  </div>

  <template v-else>
    <section v-for="group in historyGroups" :key="group.key">
      <div class="group-label">
        <span>{{ group.label }}</span>
        <span>{{ group.items.length }}</span>
      </div>

      <article v-for="item in group.items" :key="item.id" class="record-card history-row">
        <div class="file-glyph" aria-hidden="true"><AppIcon name="file" :size="18" /></div>
        <div class="record-body">
          <h3 class="record-title" :title="item.fileName">{{ item.fileName }}</h3>
          <div class="record-subtitle">
            <span class="host" :title="item.url">{{ item.host }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ store.formatHistoryTime(item.downloadedAt) }}</span>
          </div>
          <div class="record-meta">
            <span v-if="item.size">{{ store.formatSize(item.size) }}</span>
          </div>
        </div>
        <div class="record-actions">
          <button
            class="row-action"
            type="button"
            :title="t('app.openPdf')"
            :aria-label="t('app.openPdf')"
            @click="store.openHistoryUrl(item.url)"
          >
            <AppIcon name="open" :size="14" />
          </button>
          <button
            class="row-action"
            type="button"
            :title="t('app.copyUrl')"
            :aria-label="t('app.copyUrl')"
            @click="store.copyUrl(item.url)"
          >
            <AppIcon name="copy" :size="14" />
          </button>
          <button
            class="row-action danger"
            type="button"
            :title="t('app.delete')"
            :aria-label="t('app.delete')"
            @click="store.deleteHistoryItem(item.id)"
          >
            <AppIcon name="delete" :size="14" />
          </button>
        </div>
      </article>
    </section>

    <button class="clear-all-link" type="button" @click="store.clearHistory">
      {{ t('options.clearHistory') }}
    </button>
  </template>
</template>

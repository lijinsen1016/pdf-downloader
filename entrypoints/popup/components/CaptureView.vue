<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIcon from '@/modules/ui/AppIcon.vue';
import { isRecent, isToday } from '@/modules/shared/time';
import type { PdfRecord } from '@/modules/shared/types';
import type { PopupStore } from '../usePopupStore';
import RecordCard from './RecordCard.vue';

const { t } = useI18n();
const props = defineProps<{ store: PopupStore }>();

interface RecordGroup {
  key: string;
  label: string;
  items: PdfRecord[];
}

const RECENT_WINDOW_MS = 10 * 60 * 1000;

const recordGroups = computed<RecordGroup[]>(() => {
  const buckets: RecordGroup[] = [
    { key: 'now', label: t('time.now'), items: [] },
    { key: 'today', label: t('time.today'), items: [] },
    { key: 'earlier', label: t('time.earlier'), items: [] }
  ];

  for (const record of props.store.filteredRecords) {
    if (isRecent(record.capturedAt, RECENT_WINDOW_MS)) {
      buckets[0]?.items.push(record);
    } else if (isToday(record.capturedAt)) {
      buckets[1]?.items.push(record);
    } else {
      buckets[2]?.items.push(record);
    }
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
});
</script>

<template>
  <div v-if="store.loading && !store.records.length" class="skeleton-list" aria-hidden="true">
    <div v-for="index in 4" :key="index" class="skeleton-item"></div>
  </div>

  <div v-else-if="!store.records.length" class="empty-state">
    <div class="empty-art"><AppIcon name="file" :size="30" /></div>
    <h2>{{ t('message.noRecords') }}</h2>
    <p>{{ t('message.emptyHint') }}</p>
    <button class="primary-action" type="button" @click="store.scanActivePage">
      <AppIcon name="scan" :size="15" />
      <span>{{ t('app.scan') }}</span>
    </button>
  </div>

  <div v-else-if="!store.filteredRecords.length" class="empty-state">
    <div class="empty-art"><AppIcon name="search" :size="30" /></div>
    <h2>{{ t('message.noMatch') }}</h2>
    <p>{{ t('message.noMatchHint') }}</p>
    <button class="primary-action" type="button" @click="store.clearSearch">
      <AppIcon name="close" :size="14" />
      <span>{{ t('app.clearSearch') }}</span>
    </button>
  </div>

  <template v-else>
    <section v-for="group in recordGroups" :key="group.key">
      <div class="group-label">
        <span>{{ group.label }}</span>
        <span>{{ group.items.length }}</span>
      </div>

      <RecordCard
        v-for="record in group.items"
        :key="record.id"
        :store="store"
        :record="record"
      />
    </section>

    <button class="clear-all-link" type="button" @click="store.requestClear">
      {{ t('app.clear') }}
    </button>
  </template>
</template>

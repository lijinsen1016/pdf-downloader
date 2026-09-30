<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIcon from '@/modules/ui/AppIcon.vue';
import { usePopupStore } from './usePopupStore';
import type { DownloadHistoryItem, DownloadJob, PdfRecord } from '@/modules/shared/types';

const { t } = useI18n();
const store = usePopupStore();

const selectedCount = computed(() => store.selectedVisibleIds.length);

interface RecordGroup {
  key: string;
  label: string;
  items: PdfRecord[];
}

interface HistoryGroup {
  key: string;
  label: string;
  items: DownloadHistoryItem[];
}

const recordGroups = computed<RecordGroup[]>(() => {
  const now = Date.now();
  const today = new Date().toDateString();
  const buckets: RecordGroup[] = [
    { key: 'now', label: t('time.now'), items: [] },
    { key: 'today', label: t('time.today'), items: [] },
    { key: 'earlier', label: t('time.earlier'), items: [] }
  ];

  for (const record of store.filteredRecords) {
    const date = new Date(record.capturedAt);
    if (now - record.capturedAt < 10 * 60 * 1000) {
      buckets[0]?.items.push(record);
    } else if (date.toDateString() === today) {
      buckets[1]?.items.push(record);
    } else {
      buckets[2]?.items.push(record);
    }
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
});

const historyGroups = computed<HistoryGroup[]>(() => {
  const today = new Date().toDateString();
  const buckets: HistoryGroup[] = [
    { key: 'today', label: t('time.today'), items: [] },
    { key: 'earlier', label: t('time.earlier'), items: [] }
  ];

  for (const item of store.filteredHistory) {
    const bucket = new Date(item.downloadedAt).toDateString() === today ? 0 : 1;
    buckets[bucket]?.items.push(item);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
});

function jobState(job: DownloadJob | undefined): DownloadJob['status'] | '' {
  return job?.status ?? '';
}

function isJobActive(status: DownloadJob['status'] | ''): boolean {
  return ['queued', 'fetching', 'starting', 'downloading'].includes(status);
}

function openItemUrl(url: string): void {
  void store.openHistoryUrl(url);
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-seal" aria-hidden="true"><span>PDF</span></div>
        <div class="brand-copy">
          <h1>{{ t('app.title') }}</h1>
          <div class="capture-state">
            <span class="state-dot" :class="{ on: store.settings.captureEnabled }"></span>
            <span>{{ store.settings.captureEnabled ? t('status.capturing') : t('status.paused') }}</span>
          </div>
        </div>
      </div>

      <div class="top-actions">
        <button class="icon-button" type="button" :aria-label="t('app.scan')" :title="t('app.scan')" @click="store.scanActivePage">
          <AppIcon name="scan" :size="17" />
        </button>
        <button class="icon-button" type="button" :aria-label="t('app.options')" :title="t('app.options')" @click="store.openOptions">
          <AppIcon name="settings" :size="17" />
        </button>
      </div>
    </header>

    <nav class="view-switch" role="tablist" :aria-label="t('app.filter')">
      <button
        type="button"
        role="tab"
        :aria-selected="store.view === 'capture'"
        :class="{ active: store.view === 'capture' }"
        @click="store.view = 'capture'"
      >
        <AppIcon name="file" :size="14" />
        <span>{{ t('app.captured') }}</span>
        <b>{{ store.records.length }}</b>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="store.view === 'history'"
        :class="{ active: store.view === 'history' }"
        @click="store.view = 'history'"
      >
        <AppIcon name="history" :size="14" />
        <span>{{ t('app.history') }}</span>
        <b>{{ store.history.length }}</b>
      </button>
    </nav>

    <div class="search-row">
      <label class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="store.searchText" type="search" :placeholder="t('app.search')" />
      </label>
      <button
        class="capture-button"
        :class="{ on: store.settings.captureEnabled }"
        type="button"
        :title="store.settings.captureEnabled ? t('status.capturing') : t('status.paused')"
        @click="store.toggleCapture"
      >
        <AppIcon name="capture" :size="14" />
        <span>{{ store.settings.captureEnabled ? t('app.captureOn') : t('app.captureOff') }}</span>
      </button>
    </div>

    <div v-if="store.view === 'capture'" class="filter-chips">
      <button
        v-for="item in store.filterOptions"
        :key="item.value"
        type="button"
        :class="{ active: store.filter === item.value }"
        @click="store.filter = item.value"
      >
        <span>{{ item.label }}</span>
        <b>{{ item.count }}</b>
      </button>
      <button
        v-if="store.filteredRecords.length"
        class="download-all-chip"
        type="button"
        :disabled="store.activeJobCount >= 6"
        @click="store.downloadSelected"
      >
        <AppIcon name="download" :size="13" />
        <span>{{ t('app.downloadCurrent') }}</span>
      </button>
    </div>

    <section class="content" :aria-busy="store.loading">
      <!-- ============ Capture view ============ -->
      <template v-if="store.view === 'capture'">
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

            <article
              v-for="record in group.items"
              :key="record.id"
              class="record-card"
              :class="{
                selected: store.selectedIds.has(record.id),
                'dom-source': record.source === 'dom',
                'auth-source': record.auth.cookie || record.auth.authHeaders.length > 0
              }"
            >
              <label class="check-control">
                <input
                  type="checkbox"
                  :checked="store.selectedIds.has(record.id)"
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
                  <span v-if="record.auth.tokenRef || record.auth.bearerTokenRef" class="pill session" :title="t('message.sessionOnly')">
                    {{ t('message.sessionOnly') }}
                  </span>
                </div>

                <div
                  v-if="jobState(store.jobForRecord(record.id))"
                  class="job-strip"
                  :class="jobState(store.jobForRecord(record.id))"
                >
                  <span>{{ store.statusForRecord(record.id) }}</span>
                  <progress
                    v-if="jobState(store.jobForRecord(record.id)) === 'downloading'"
                    :value="store.progressForRecord(record.id)"
                    max="100"
                  ></progress>
                  <button
                    v-if="isJobActive(jobState(store.jobForRecord(record.id)))"
                    class="job-close"
                    type="button"
                    :aria-label="t('app.cancel')"
                    @click="store.cancelForRecord(record.id)"
                  >
                    <AppIcon name="close" :size="11" />
                  </button>
                  <button
                    v-if="jobState(store.jobForRecord(record.id)) === 'failed'"
                    class="retry"
                    type="button"
                    @click="store.downloadRecord(record.id)"
                  >
                    {{ t('app.retry') }}
                  </button>
                  <span v-if="jobState(store.jobForRecord(record.id)) === 'failed'" class="job-error">
                    {{ store.errorForRecord(record.id) || t('message.downloadFailed') }}
                  </span>
                </div>
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
                <button class="row-action" type="button" :title="t('app.openPdf')" :aria-label="t('app.openPdf')" @click="store.openRecord(record.id)">
                  <AppIcon name="open" :size="14" />
                </button>
                <button class="row-action" type="button" :title="t('app.copyUrl')" :aria-label="t('app.copyUrl')" @click="store.copyUrl(record.url)">
                  <AppIcon name="copy" :size="14" />
                </button>
                <button class="row-action danger" type="button" :title="t('app.delete')" :aria-label="t('app.delete')" @click="store.deleteRecord(record.id)">
                  <AppIcon name="delete" :size="14" />
                </button>
              </div>
            </article>
          </section>

          <button class="clear-all-link" type="button" @click="store.showConfirm = true">
            {{ t('app.clear') }}
          </button>
        </template>
      </template>

      <!-- ============ History view ============ -->
      <template v-else>
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
                <button class="row-action" type="button" :title="t('app.openPdf')" :aria-label="t('app.openPdf')" @click="openItemUrl(item.url)">
                  <AppIcon name="open" :size="14" />
                </button>
                <button class="row-action" type="button" :title="t('app.copyUrl')" :aria-label="t('app.copyUrl')" @click="store.copyUrl(item.url)">
                  <AppIcon name="copy" :size="14" />
                </button>
                <button class="row-action danger" type="button" :title="t('app.delete')" :aria-label="t('app.delete')" @click="store.deleteHistoryItem(item.id)">
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
    </section>

    <div v-if="store.view === 'capture' && selectedCount > 0" class="batch-bar">
      <span class="count">{{ t('status.selected', { count: selectedCount }) }}</span>
      <span class="spacer"></span>
      <button class="clear-selection" type="button" @click="store.clearSelection">{{ t('app.clearSelection') }}</button>
      <button class="download-selection" type="button" @click="store.downloadSelected">
        <AppIcon name="download" :size="13" />
        <span>{{ t('app.downloadSelected') }}</span>
      </button>
    </div>

    <footer v-else class="footnote">
      <span v-if="!store.settings.captureEnabled">{{ t('message.captureOff') }}</span>
      <span v-else>{{ t('options.privacyNote') }}</span>
    </footer>

    <div v-if="store.showConfirm" class="modal-backdrop" role="presentation" @click.self="store.showConfirm = false">
      <div class="modal" role="dialog" :aria-label="t('app.confirmClearTitle')">
        <h2>{{ t('app.confirmClearTitle') }}</h2>
        <p>{{ t('app.confirmClearText') }}</p>
        <div class="modal-actions">
          <button type="button" @click="store.showConfirm = false">{{ t('app.cancel') }}</button>
          <button class="danger-action" type="button" @click="store.clearAll">{{ t('app.confirm') }}</button>
        </div>
      </div>
    </div>

    <div v-if="store.toast" class="toast" :class="store.toast.type" role="status">
      <AppIcon :name="store.toast.type === 'success' ? 'check' : 'alert'" :size="14" />
      <span>{{ store.toast.message }}</span>
    </div>
  </main>
</template>

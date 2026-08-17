<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePopupStore } from './usePopupStore';

const { t } = useI18n();
const store = usePopupStore();

const allVisibleSelected = computed(() => {
  if (!store.filteredRecords.length) return false;
  return store.filteredRecords.every((record) => store.selectedIds.has(record.id));
});

const hasVisibleSelection = computed(() => store.selectedVisibleIds.length > 0);
</script>

<template>
  <main class="shell">
    <header class="header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">PDF</div>
        <div class="brand-copy">
          <h1>{{ t('app.title') }}</h1>
          <p>{{ t('app.subtitle') }}</p>
        </div>
      </div>
      <div class="header-actions">
        <button
          class="switch"
          type="button"
          role="switch"
          :aria-checked="store.settings.captureEnabled"
          :title="t('app.capture')"
          @click="store.toggleCapture"
        >
          <span :class="{ on: store.settings.captureEnabled }"></span>
        </button>
        <button class="icon-button" type="button" :aria-label="t('app.options')" :title="t('app.options')" @click="store.openOptions">
          ⚙
        </button>
      </div>
    </header>

    <section class="hero">
      <div>
        <span class="eyebrow">{{ t('status.kept', { count: store.records.length }) }}</span>
        <strong>{{ t('status.showing', { count: store.filteredRecords.length }) }}</strong>
      </div>
      <button
        class="primary-action"
        type="button"
        :disabled="!store.filteredRecords.length || store.activeJobCount >= 6"
        @click="store.downloadSelected"
      >
        <span>↓</span>
        <span>{{ hasVisibleSelection ? t('app.downloadAll') : t('app.downloadAll') }}</span>
        <b v-if="store.activeJobCount">{{ store.activeJobCount }}</b>
      </button>
    </section>

    <section class="toolbar">
      <label class="search-box">
        <span aria-hidden="true">⌕</span>
        <input v-model="store.searchText" type="search" :placeholder="t('app.search')" />
      </label>
      <div class="filters">
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
      </div>
    </section>

    <section class="list" :aria-busy="store.loading">
      <div v-if="store.loading && !store.records.length" class="skeleton-list" aria-hidden="true">
        <div v-for="index in 4" :key="index" class="skeleton-item"></div>
      </div>

      <div v-else-if="!store.records.length" class="empty-state">
        <div class="empty-icon" aria-hidden="true">PDF</div>
        <h2>{{ t('message.noRecords') }}</h2>
        <p>{{ t('message.emptyHint') }}</p>
      </div>

      <div v-else-if="!store.filteredRecords.length" class="empty-state">
        <div class="empty-icon" aria-hidden="true">⌕</div>
        <h2>{{ t('message.noMatch') }}</h2>
        <p>{{ t('message.emptyHint') }}</p>
      </div>

      <template v-else>
        <label class="select-all">
          <input type="checkbox" :checked="allVisibleSelected" @change="store.toggleSelectAll" />
          <span>{{ t('status.showing', { count: store.filteredRecords.length }) }}</span>
          <button class="link-button" type="button" @click="store.showConfirm = true">
            {{ t('app.clear') }}
          </button>
        </label>

        <article v-for="record in store.filteredRecords" :key="record.id" class="record-item">
          <input
            class="record-check"
            type="checkbox"
            :checked="store.selectedIds.has(record.id)"
            :aria-label="record.fileName"
            @change="store.toggleSelected(record.id)"
          />

          <div class="file-badge" aria-hidden="true">PDF</div>

          <div class="record-body">
            <div class="record-title" :title="record.fileName">{{ record.fileName }}</div>
            <div class="record-host" :title="record.url">
              <span>{{ record.host }}</span>
            </div>
            <div class="record-meta">
              <span>{{ store.formatTime(record.capturedAt) }}</span>
              <span v-if="record.size">{{ store.formatSize(record.size) }}</span>
              <span v-if="record.auth.cookie || record.auth.bearerScheme" class="auth-pill">
                🔒 {{ t('message.loginRequired') }}
              </span>
              <span v-if="record.auth.bearerTokenRef" class="session-pill" :title="t('message.sessionOnly')">
                {{ t('message.sessionOnly') }}
              </span>
            </div>

            <div v-if="store.jobForRecord(record.id)" class="job-status" :class="store.jobForRecord(record.id)?.status">
              <div class="job-row">
                <span>{{ store.statusForRecord(record.id) }}</span>
                <button
                  v-if="['queued', 'fetching', 'starting', 'downloading'].includes(store.jobForRecord(record.id)?.status ?? '')"
                  class="mini-button"
                  type="button"
                  @click="store.cancelForRecord(record.id)"
                >
                  ✕
                </button>
              </div>
              <progress
                v-if="store.jobForRecord(record.id)?.status === 'downloading'"
                :value="store.jobProgress(store.jobForRecord(record.id)!)"
                max="100"
              ></progress>
              <span v-if="store.jobForRecord(record.id)?.status === 'failed'" class="job-error">
                {{ store.jobForRecord(record.id)?.errorDetail || t('message.downloadFailed') }}
              </span>
            </div>
          </div>

          <div class="row-actions">
            <button type="button" :title="t('app.copyUrl')" :aria-label="t('app.copyUrl')" @click="store.copyUrl(record.url)">⧉</button>
            <button type="button" :title="t('app.openPdf')" :aria-label="t('app.openPdf')" @click="store.openRecord(record.id)">👁</button>
            <button
              class="download-button"
              type="button"
              :title="t('app.download')"
              :aria-label="t('app.download')"
              :disabled="Boolean(store.activeJobForRecord(record.id))"
              @click="store.downloadRecord(record.id)"
            >
              ↓
            </button>
            <button class="danger-button" type="button" :title="t('app.delete')" :aria-label="t('app.delete')" @click="store.deleteRecord(record.id)">🗑</button>
          </div>
        </article>
      </template>
    </section>

    <footer class="footer">
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
      <span>{{ store.toast.message }}</span>
    </div>
  </main>
</template>

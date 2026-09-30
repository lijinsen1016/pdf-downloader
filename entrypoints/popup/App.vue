<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIcon from '@/modules/ui/AppIcon.vue';
import CaptureView from './components/CaptureView.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import HistoryView from './components/HistoryView.vue';
import ToastMessage from './components/ToastMessage.vue';
import { usePopupStore } from './usePopupStore';

const { t } = useI18n();
const store = usePopupStore();

const selectedCount = computed(() => store.selectedVisibleIds.length);
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
        <button
          class="icon-button"
          type="button"
          :aria-label="t('app.scan')"
          :title="t('app.scan')"
          @click="store.scanActivePage"
        >
          <AppIcon name="scan" :size="17" />
        </button>
        <button
          class="icon-button"
          type="button"
          :aria-label="t('app.options')"
          :title="t('app.options')"
          @click="store.openOptions"
        >
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
        :disabled="!store.canStartMoreJobs"
        @click="store.downloadSelected"
      >
        <AppIcon name="download" :size="13" />
        <span>{{ t('app.downloadCurrent') }}</span>
      </button>
    </div>

    <section class="content" :aria-busy="store.loading">
      <CaptureView v-if="store.view === 'capture'" :store="store" />
      <HistoryView v-else :store="store" />
    </section>

    <div v-if="store.view === 'capture' && selectedCount > 0" class="batch-bar">
      <span class="count">{{ t('status.selected', { count: selectedCount }) }}</span>
      <span class="spacer"></span>
      <button class="clear-selection" type="button" @click="store.clearSelection">
        {{ t('app.clearSelection') }}
      </button>
      <button class="download-selection" type="button" @click="store.downloadSelected">
        <AppIcon name="download" :size="13" />
        <span>{{ t('app.downloadSelected') }}</span>
      </button>
    </div>

    <footer v-else class="footnote">
      <span v-if="!store.settings.captureEnabled">{{ t('message.captureOff') }}</span>
      <span v-else>{{ t('options.privacyNote') }}</span>
    </footer>

    <ConfirmDialog
      v-if="store.showConfirm"
      :title="t('app.confirmClearTitle')"
      :text="t('app.confirmClearText')"
      :confirm-label="t('app.confirm')"
      :cancel-label="t('app.cancel')"
      @confirm="store.clearAll"
      @cancel="store.dismissClear"
    />

    <ToastMessage :toast="store.toast" />
  </main>
</template>

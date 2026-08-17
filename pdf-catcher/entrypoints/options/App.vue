<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { browser } from 'wxt/browser';
import type { PopupToBackground } from '@/modules/protocol/schemas';
import { DEFAULT_SETTINGS, type Settings } from '@/modules/shared/types';
import { setLanguage } from '@/modules/i18n';

const { t } = useI18n();

const form = ref<Settings>({ ...DEFAULT_SETTINGS });
const ignoredHostsText = ref('');
const saving = ref(false);
const saved = ref(false);
const clearing = ref(false);

async function send(message: PopupToBackground): Promise<{ ok?: boolean } & Record<string, unknown>> {
  return browser.runtime.sendMessage(message) as Promise<{ ok?: boolean } & Record<string, unknown>>;
}

async function load(): Promise<void> {
  try {
    const response = await send({ type: 'settings/get' });
    if (response.ok && response.settings) {
      form.value = response.settings as Settings;
      ignoredHostsText.value = form.value.ignoredHosts.join('\n');
      setLanguage(form.value.language);
    }
  } catch {
    // 首次打开时使用默认值
  }
}

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  try {
    const patch: Partial<Settings> = {
      captureEnabled: form.value.captureEnabled,
      language: form.value.language,
      retentionMinutes: Number(form.value.retentionMinutes),
      maxRecords: Number(form.value.maxRecords),
      reuseAuthorization: form.value.reuseAuthorization,
      historyEnabled: form.value.historyEnabled,
      ignoredHosts: ignoredHostsText.value
        .split('\n')
        .map((host) => host.trim())
        .filter(Boolean)
    };
    const response = await send({ type: 'settings/update', patch });
    if (response.ok && response.settings) {
      form.value = response.settings as Settings;
      setLanguage(form.value.language);
      saved.value = true;
      window.setTimeout(() => {
        saved.value = false;
      }, 2000);
    }
  } finally {
    saving.value = false;
  }
}

async function clearAll(): Promise<void> {
  if (!window.confirm(t('app.confirmClearText'))) return;
  clearing.value = true;
  try {
    await send({ type: 'download/cancelAll' });
    await send({ type: 'records/clear' });
  } finally {
    clearing.value = false;
  }
}

async function clearHistory(): Promise<void> {
  if (!window.confirm(t('options.clearHistoryHint'))) return;
  try {
    await send({ type: 'history/clear' });
  } finally {
    // 列表由 popup 自行刷新
  }
}

onMounted(load);
</script>

<template>
  <main class="page">
    <header class="page-header">
      <div class="brand-mark" aria-hidden="true">PDF</div>
      <div>
        <h1>{{ t('options.title') }}</h1>
        <p>{{ t('app.subtitle') }}</p>
      </div>
    </header>

    <section class="card">
      <h2>{{ t('options.captureSection') }}</h2>

      <label class="row">
        <div>
          <strong>{{ t('options.captureEnabled') }}</strong>
          <p>{{ t('options.captureEnabledHint') }}</p>
        </div>
        <input v-model="form.captureEnabled" type="checkbox" />
      </label>

      <label class="field">
        <span>{{ t('options.retention') }}</span>
        <input v-model.number="form.retentionMinutes" type="number" min="1" max="43200" />
        <small>{{ t('options.retentionHint') }}</small>
      </label>

      <label class="field">
        <span>{{ t('options.maxRecords') }}</span>
        <input v-model.number="form.maxRecords" type="number" min="10" max="2000" />
        <small>{{ t('options.maxRecordsHint') }}</small>
      </label>
    </section>

    <section class="card">
      <h2>{{ t('options.privacySection') }}</h2>

      <label class="field">
        <span>{{ t('app.language') }}</span>
        <select v-model="form.language">
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
      </label>

      <label class="row">
        <div>
          <strong>{{ t('options.reuseAuthorization') }}</strong>
          <p>{{ t('options.reuseAuthorizationHint') }}</p>
        </div>
        <input v-model="form.reuseAuthorization" type="checkbox" />
      </label>

      <label class="row">
        <div>
          <strong>{{ t('options.historyEnabled') }}</strong>
          <p>{{ t('options.historyEnabledHint') }}</p>
        </div>
        <input v-model="form.historyEnabled" type="checkbox" />
      </label>

      <label class="field">
        <span>{{ t('options.ignoredHosts') }}</span>
        <textarea v-model="ignoredHostsText" rows="4" :placeholder="'example.com\n*.example.com'"></textarea>
        <small>{{ t('options.ignoredHostsHint') }}</small>
      </label>
    </section>

    <section class="card">
      <h2>{{ t('options.dataSection') }}</h2>
      <div class="row">
        <div>
          <strong>{{ t('options.clearAll') }}</strong>
          <p>{{ t('options.clearAllHint') }}</p>
        </div>
        <button class="danger-button" type="button" :disabled="clearing" @click="clearAll">
          {{ t('app.clear') }}
        </button>
      </div>
      <p class="privacy-note">🛡 {{ t('options.privacyNote') }}</p>
    </section>

    <section class="card">
      <h2>{{ t('app.history') }}</h2>
      <div class="row">
        <div>
          <strong>{{ t('options.clearHistory') }}</strong>
          <p>{{ t('options.clearHistoryHint') }}</p>
        </div>
        <button class="danger-button" type="button" @click="clearHistory">
          {{ t('options.clearHistory') }}
        </button>
      </div>
    </section>

    <footer class="page-footer">
      <button class="primary-action" type="button" :disabled="saving" @click="save">
        {{ saved ? t('options.saved') : t('options.save') }}
      </button>
    </footer>
  </main>
</template>

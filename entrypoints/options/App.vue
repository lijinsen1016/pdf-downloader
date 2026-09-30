<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { request } from '@/modules/protocol/client';
import { describeError } from '@/modules/protocol/errors';
import { DEFAULT_SETTINGS, type Settings } from '@/modules/shared/types';
import { setLanguage } from '@/modules/i18n';

const { t } = useI18n();

const form = ref<Settings>({ ...DEFAULT_SETTINGS });
const ignoredHostsText = ref('');
const reusableHeadersText = ref('');
const saving = ref(false);
const saved = ref(false);
const clearing = ref(false);

function notifyError(error: unknown): void {
  window.alert(describeError(error, t));
}

async function load(): Promise<void> {
  try {
    const response = await request({ type: 'settings/get' });
    form.value = response.settings;
    ignoredHostsText.value = response.settings.ignoredHosts.join('\n');
    reusableHeadersText.value = response.settings.reusableHeaders.join('\n');
    setLanguage(response.settings.language);
  } catch {
    // 首次打开时使用默认值
  }
}

function buildPatch(): Partial<Settings> {
  return {
    captureEnabled: form.value.captureEnabled,
    language: form.value.language,
    retentionMinutes: Number(form.value.retentionMinutes),
    maxRecords: Number(form.value.maxRecords),
    reuseAuthorization: form.value.reuseAuthorization,
    historyEnabled: form.value.historyEnabled,
    capturePostPdf: form.value.capturePostPdf,
    reusableHeaders: reusableHeadersText.value
      .split('\n')
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean),
    ignoredHosts: ignoredHostsText.value
      .split('\n')
      .map((host) => host.trim())
      .filter(Boolean)
  };
}

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  try {
    const response = await request({ type: 'settings/update', patch: buildPatch() });
    form.value = response.settings;
    reusableHeadersText.value = response.settings.reusableHeaders.join('\n');
    setLanguage(response.settings.language);
    saved.value = true;
    window.setTimeout(() => {
      saved.value = false;
    }, 2000);
  } catch (error) {
    notifyError(error);
  } finally {
    saving.value = false;
  }
}

async function clearAll(): Promise<void> {
  if (!window.confirm(t('app.confirmClearText'))) return;
  clearing.value = true;
  try {
    // background 会在清空记录时一并取消并清理关联的下载任务
    await request({ type: 'records/clear' });
  } catch (error) {
    notifyError(error);
  } finally {
    clearing.value = false;
  }
}

async function clearHistory(): Promise<void> {
  if (!window.confirm(t('options.clearHistoryHint'))) return;
  try {
    await request({ type: 'history/clear' });
  } catch (error) {
    notifyError(error);
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

      <label class="row">
        <div>
          <strong>{{ t('options.capturePostPdf') }}</strong>
          <p>{{ t('options.capturePostPdfHint') }}</p>
        </div>
        <input v-model="form.capturePostPdf" type="checkbox" />
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

      <label class="field">
        <span>{{ t('options.reusableHeaders') }}</span>
        <textarea
          v-model="reusableHeadersText"
          rows="5"
          placeholder="authorization&#10;x-api-key&#10;x-auth-token"
        ></textarea>
        <small>{{ t('options.reusableHeadersHint') }}</small>
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

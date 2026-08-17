import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { browser, type Browser } from 'wxt/browser';
import { setLanguage } from '@/modules/i18n';
import type { PortEvent, PopupToBackground } from '@/modules/protocol/schemas';
import {
  DEFAULT_SETTINGS,
  type DownloadJob,
  type PdfRecord,
  type Settings
} from '@/modules/shared/types';
import { getHost } from '@/modules/shared/url';

export type RecordFilter = 'all' | 'auth' | 'today';

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

export function usePopupStore() {
  const { t } = useI18n();

  const records = ref<PdfRecord[]>([]);
  const jobs = ref<DownloadJob[]>([]);
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  const loading = ref(true);
  const searchText = ref('');
  const filter = ref<RecordFilter>('all');
  const selectedIds = ref<Set<string>>(new Set());
  const toast = ref<ToastState | null>(null);
  const showConfirm = ref(false);

  let port: Browser.runtime.Port | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const filteredRecords = computed(() => {
    const keyword = searchText.value.trim().toLowerCase();
    return records.value.filter((record) => {
      const matchesKeyword =
        !keyword ||
        record.fileName.toLowerCase().includes(keyword) ||
        record.url.toLowerCase().includes(keyword) ||
        getHost(record.url).toLowerCase().includes(keyword);
      if (!matchesKeyword) return false;

      if (filter.value === 'auth') return record.auth.cookie || Boolean(record.auth.bearerScheme);
      if (filter.value === 'today') return isToday(record.capturedAt);
      return true;
    });
  });

  const selectedVisibleIds = computed(() => {
    const filteredIds = new Set(filteredRecords.value.map((record) => record.id));
    return [...selectedIds.value].filter((id) => filteredIds.has(id));
  });

  const downloadTargetIds = computed(() => {
    if (selectedVisibleIds.value.length > 0) return selectedVisibleIds.value;
    return filteredRecords.value.map((record) => record.id);
  });

  const activeJobCount = computed(
    () =>
      jobs.value.filter((job) =>
        ['queued', 'fetching', 'starting', 'downloading'].includes(job.status)
      ).length
  );

  const filterOptions = computed(() => [
    { value: 'all' as const, label: t('filter.all'), count: records.value.length },
    {
      value: 'auth' as const,
      label: t('filter.auth'),
      count: records.value.filter((record) => record.auth.cookie || Boolean(record.auth.bearerScheme)).length
    },
    {
      value: 'today' as const,
      label: t('filter.today'),
      count: records.value.filter((record) => isToday(record.capturedAt)).length
    }
  ]);

  function showToast(message: string, type: ToastState['type'] = 'success'): void {
    if (toastTimer) clearTimeout(toastTimer);
    toast.value = { message, type };
    toastTimer = setTimeout(() => {
      toast.value = null;
    }, 2600);
  }

  function connectPort(): void {
    port = browser.runtime.connect({ name: 'popup' });
    port.onMessage.addListener((event: unknown) => {
      handlePortEvent(event as PortEvent);
    });
  }

  function handlePortEvent(event: PortEvent): void {
    switch (event.type) {
      case 'records/changed':
        records.value = event.records;
        break;
      case 'jobs/changed':
        jobs.value = event.jobs;
        break;
      case 'settings/changed':
        applySettings(event.settings);
        break;
      case 'error':
        showToast(`${t(event.errorKey)}${event.detail ? `: ${event.detail}` : ''}`, 'error');
        break;
    }
  }

  function applySettings(next: Settings): void {
    settings.value = next;
    setLanguage(next.language);
  }

  async function send(message: PopupToBackground): Promise<{ ok?: boolean } & Record<string, unknown>> {
    return browser.runtime.sendMessage(message) as Promise<{ ok?: boolean } & Record<string, unknown>>;
  }

  async function loadState(): Promise<void> {
    loading.value = true;
    try {
      const response = await send({ type: 'state/get' });
      if (response.ok) {
        records.value = (response.records as PdfRecord[]) ?? [];
        jobs.value = (response.jobs as DownloadJob[]) ?? [];
        applySettings((response.settings as Settings) ?? settings.value);
      }
    } catch {
      showToast(t('message.requestFailed'), 'error');
    } finally {
      loading.value = false;
    }
  }

  async function toggleCapture(): Promise<void> {
    try {
      const response = await send({
        type: 'settings/update',
        patch: { captureEnabled: !settings.value.captureEnabled }
      });
      if (response.ok) applySettings(response.settings as Settings);
    } catch {
      showToast(t('message.requestFailed'), 'error');
    }
  }

  async function downloadRecord(id: string): Promise<void> {
    try {
      const response = await send({ type: 'download/start', ids: [id] });
      if (response.ok) showToast(t('message.downloadSuccess'));
      else showToast(t('message.downloadFailed'), 'error');
    } catch {
      showToast(t('message.downloadFailed'), 'error');
    }
  }

  async function downloadSelected(): Promise<void> {
    const ids = downloadTargetIds.value;
    if (!ids.length) {
      showToast(t('message.noSelection'), 'error');
      return;
    }
    try {
      const response = await send({ type: 'download/start', ids });
      if (response.ok) showToast(t('message.batchStarted', { count: ids.length }));
      else showToast(t('message.downloadFailed'), 'error');
    } catch {
      showToast(t('message.downloadFailed'), 'error');
    }
  }

  async function openRecord(id: string): Promise<void> {
    try {
      const response = await send({ type: 'records/open', id });
      if (response.ok) showToast(t('message.openedPdf'));
      else showToast(t('message.openFailed'), 'error');
    } catch {
      showToast(t('message.openFailed'), 'error');
    }
  }

  async function copyUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('message.urlCopied'));
    } catch {
      showToast(t('message.copyFailed'), 'error');
    }
  }

  async function deleteRecord(id: string): Promise<void> {
    try {
      const response = await send({ type: 'records/delete', id });
      if (response.ok) {
        records.value = (response.records as PdfRecord[]) ?? [];
        removeSelected(id);
        showToast(t('message.listCleared'));
      }
    } catch {
      showToast(t('message.requestFailed'), 'error');
    }
  }

  async function clearAll(): Promise<void> {
    showConfirm.value = false;
    try {
      const response = await send({ type: 'records/clear' });
      if (response.ok) {
        records.value = (response.records as PdfRecord[]) ?? [];
        selectedIds.value = new Set();
        showToast(t('message.listCleared'));
      }
    } catch {
      showToast(t('message.requestFailed'), 'error');
    }
  }

  async function cancelJob(jobId: string): Promise<void> {
    try {
      await send({ type: 'download/cancel', jobId });
    } catch {
      showToast(t('message.requestFailed'), 'error');
    }
  }

  function toggleSelected(id: string): void {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  }

  function toggleSelectAll(): void {
    const allSelected = filteredRecords.value.every((record) => selectedIds.value.has(record.id));
    const next = new Set(selectedIds.value);
    if (allSelected) {
      for (const record of filteredRecords.value) next.delete(record.id);
    } else {
      for (const record of filteredRecords.value) next.add(record.id);
    }
    selectedIds.value = next;
  }

  function removeSelected(id: string): void {
    const next = new Set(selectedIds.value);
    next.delete(id);
    selectedIds.value = next;
  }

  function activeJobForRecord(recordId: string): DownloadJob | undefined {
    return jobs.value.find(
      (job) => job.recordId === recordId && ['queued', 'fetching', 'starting', 'downloading'].includes(job.status)
    );
  }

  function jobForRecord(recordId: string): DownloadJob | undefined {
    const active = activeJobForRecord(recordId);
    if (active) return active;
    return jobs.value.find((job) => job.recordId === recordId && job.status !== 'done');
  }

  function formatTime(timestamp: number): string {
    const locale = settings.value.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    return new Date(timestamp).toLocaleString(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  function statusLabel(job: DownloadJob): string {
    return t(`status.${job.status}`);
  }

  function jobProgress(job: DownloadJob): number {
    if (!job.totalBytes || !job.receivedBytes) return 0;
    return Math.min(100, Math.round((job.receivedBytes / job.totalBytes) * 100));
  }

  function statusForRecord(recordId: string): string {
    const job = jobForRecord(recordId);
    return job ? statusLabel(job) : '';
  }

  function progressForRecord(recordId: string): number {
    const job = jobForRecord(recordId);
    return job ? jobProgress(job) : 0;
  }

  function errorForRecord(recordId: string): string {
    return jobForRecord(recordId)?.errorDetail ?? '';
  }

  function cancelForRecord(recordId: string): void {
    const job = activeJobForRecord(recordId);
    if (job) void cancelJob(job.id);
  }

  function openOptions(): void {
    void browser.runtime.openOptionsPage();
  }

  onMounted(() => {
    connectPort();
    void loadState();
  });

  onBeforeUnmount(() => {
    port?.disconnect();
    if (toastTimer) clearTimeout(toastTimer);
  });

  return reactive({
    activeJobCount,
    activeJobForRecord,
    cancelForRecord,
    cancelJob,
    clearAll,
    copyUrl,
    deleteRecord,
    downloadRecord,
    downloadSelected,
    downloadTargetIds,
    errorForRecord,
    filter,
    filterOptions,
    filteredRecords,
    formatSize,
    formatTime,
    jobForRecord,
    jobProgress,
    jobs,
    loading,
    progressForRecord,
    openOptions,
    openRecord,
    records,
    searchText,
    selectedIds,
    selectedVisibleIds,
    settings,
    showConfirm,
    statusForRecord,
    statusLabel,
    toast,
    toggleCapture,
    toggleSelectAll,
    toggleSelected
  });
}

function isToday(timestamp: number): boolean {
  return new Date(timestamp).toDateString() === new Date().toDateString();
}

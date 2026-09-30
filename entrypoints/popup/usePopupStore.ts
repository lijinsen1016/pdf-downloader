import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { browser, type Browser } from 'wxt/browser';
import { setLanguage } from '@/modules/i18n';
import { request } from '@/modules/protocol/client';
import type { PortEvent } from '@/modules/protocol/schemas';
import { DEFAULT_SETTINGS, type Settings } from '@/modules/shared/types';
import { useCaptureList } from './composables/useCaptureList';
import { useDownloadHistory } from './composables/useDownloadHistory';
import { useDownloadJobs } from './composables/useDownloadJobs';
import { useToast } from './composables/useToast';
import { describeError } from '@/modules/protocol/errors';

export type PopupView = 'capture' | 'history';

/**
 * 组装层：连接 background 端口、分发广播，并把各切片组合成面板 store。
 * 具体逻辑分别在 composables 里，这里只做接线与跨切片操作。
 */
export function usePopupStore() {
  const { t } = useI18n();
  const { toast, showToast, disposeToast } = useToast();

  const searchText = ref('');
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  const view = ref<PopupView>('capture');
  const loading = ref(true);
  const showConfirm = ref(false);

  const capture = useCaptureList({ t, showToast, searchText });
  const downloads = useDownloadJobs({ t, showToast });
  const history = useDownloadHistory({ t, showToast, searchText });

  let port: Browser.runtime.Port | undefined;

  function applySettings(next: Settings): void {
    settings.value = next;
    setLanguage(next.language);
  }

  function handlePortEvent(event: PortEvent): void {
    switch (event.type) {
      case 'records/changed':
        capture.setRecords(event.records);
        break;
      case 'jobs/changed':
        downloads.setJobs(event.jobs);
        break;
      case 'settings/changed':
        applySettings(event.settings);
        break;
      case 'history/changed':
        history.setHistory(event.history);
        break;
      case 'error':
        showToast(
          event.detail ? `${t(event.errorKey)}: ${event.detail}` : t(event.errorKey),
          'error'
        );
        break;
    }
  }

  function connectPort(): void {
    port = browser.runtime.connect({ name: 'popup' });
    port.onMessage.addListener((event: unknown) => {
      handlePortEvent(event as PortEvent);
    });
  }

  async function loadState(): Promise<void> {
    loading.value = true;
    try {
      const response = await request({ type: 'state/get' });
      capture.setRecords(response.records);
      downloads.setJobs(response.jobs);
      history.setHistory(response.history);
      applySettings(response.settings);
    } catch (error) {
      showToast(describeError(error, t), 'error');
    } finally {
      loading.value = false;
    }
  }

  async function toggleCapture(): Promise<void> {
    try {
      const response = await request({
        type: 'settings/update',
        patch: { captureEnabled: !settings.value.captureEnabled }
      });
      applySettings(response.settings);
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  async function downloadSelected(): Promise<void> {
    await downloads.startDownloads(capture.downloadTargetIds.value);
  }

  async function openRecord(recordId: string): Promise<void> {
    try {
      await request({ type: 'records/open', id: recordId });
      showToast(t('message.openedPdf'));
    } catch (error) {
      showToast(describeError(error, t), 'error');
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

  function clearAll(): void {
    showConfirm.value = false;
    void capture.clearAll();
  }

  /** 打开「清空记录」确认框；避免子组件直接改 store 上的状态字段。 */
  function requestClear(): void {
    showConfirm.value = true;
  }

  function dismissClear(): void {
    showConfirm.value = false;
  }

  function clearSearch(): void {
    searchText.value = '';
  }

  function openOptions(): void {
    void browser.runtime.openOptionsPage();
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

  function formatHistoryTime(timestamp: number): string {
    const locale = settings.value.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    return new Date(timestamp).toLocaleString(locale, {
      year: 'numeric',
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

  onMounted(() => {
    connectPort();
    void loadState();
  });

  onBeforeUnmount(() => {
    port?.disconnect();
    disposeToast();
  });

  return reactive({
    // 视图壳
    settings,
    view,
    loading,
    showConfirm,
    searchText,
    toast,
    // 记录切片
    ...capture,
    // 下载任务切片
    ...downloads,
    // 历史切片
    ...history,
    // 跨切片动作
    clearAll,
    clearSearch,
    copyUrl,
    dismissClear,
    downloadSelected,
    formatHistoryTime,
    formatSize,
    formatTime,
    loadState,
    openOptions,
    openRecord,
    requestClear,
    showToast,
    toggleCapture
  });
}

export type PopupStore = ReturnType<typeof usePopupStore>;

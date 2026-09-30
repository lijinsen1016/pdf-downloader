import { computed, ref, type Ref } from 'vue';
import type { ComposerTranslation } from 'vue-i18n';
import { browser } from 'wxt/browser';
import { request } from '@/modules/protocol/client';
import type { DownloadHistoryItem } from '@/modules/shared/types';
import { describeError } from '@/modules/protocol/errors';

export interface DownloadHistoryDeps {
  t: ComposerTranslation;
  showToast: (message: string, type?: 'success' | 'error') => void;
  searchText: Ref<string>;
}

/** 下载历史视图状态。 */
export function useDownloadHistory({ t, showToast, searchText }: DownloadHistoryDeps) {
  const history = ref<DownloadHistoryItem[]>([]);

  const filteredHistory = computed(() => {
    const keyword = searchText.value.trim().toLowerCase();
    return history.value.filter(
      (item) =>
        !keyword ||
        item.fileName.toLowerCase().includes(keyword) ||
        item.url.toLowerCase().includes(keyword) ||
        item.host.toLowerCase().includes(keyword)
    );
  });

  function setHistory(next: DownloadHistoryItem[]): void {
    history.value = next;
  }

  async function openHistoryUrl(url: string): Promise<void> {
    try {
      await browser.tabs.create({ url, active: true });
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  async function deleteHistoryItem(id: string): Promise<void> {
    try {
      const response = await request({ type: 'history/delete', id });
      history.value = response.history;
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  async function clearHistory(): Promise<void> {
    try {
      const response = await request({ type: 'history/clear' });
      history.value = response.history;
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  return { history, filteredHistory, setHistory, openHistoryUrl, deleteHistoryItem, clearHistory };
}

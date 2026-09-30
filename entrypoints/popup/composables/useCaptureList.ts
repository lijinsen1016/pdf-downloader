import { computed, ref, type Ref } from 'vue';
import type { ComposerTranslation } from 'vue-i18n';
import { request } from '@/modules/protocol/client';
import { getHost } from '@/modules/shared/url';
import { isToday } from '@/modules/shared/time';
import type { PdfRecord } from '@/modules/shared/types';
import { describeError } from '@/modules/protocol/errors';

export type RecordFilter = 'all' | 'auth' | 'today';

export interface CaptureListDeps {
  t: ComposerTranslation;
  showToast: (message: string, type?: 'success' | 'error') => void;
  searchText: Ref<string>;
}

/** 捕获列表：记录集合、搜索筛选与多选。 */
export function useCaptureList({ t, showToast, searchText }: CaptureListDeps) {
  const records = ref<PdfRecord[]>([]);
  const filter = ref<RecordFilter>('all');
  const selectedIds = ref<Set<string>>(new Set());

  const filteredRecords = computed(() => {
    const keyword = searchText.value.trim().toLowerCase();
    return records.value.filter((record) => {
      const matchesKeyword =
        !keyword ||
        record.fileName.toLowerCase().includes(keyword) ||
        record.url.toLowerCase().includes(keyword) ||
        getHost(record.url).toLowerCase().includes(keyword);
      if (!matchesKeyword) return false;

      if (filter.value === 'auth') return record.auth.cookie || record.auth.authHeaders.length > 0;
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

  const filterOptions = computed(() => [
    { value: 'all' as const, label: t('filter.all'), count: records.value.length },
    {
      value: 'auth' as const,
      label: t('filter.auth'),
      count: records.value.filter(
        (record) => record.auth.cookie || Boolean(record.auth.bearerScheme)
      ).length
    },
    {
      value: 'today' as const,
      label: t('filter.today'),
      count: records.value.filter((record) => isToday(record.capturedAt)).length
    }
  ]);

  function setRecords(next: PdfRecord[]): void {
    records.value = next;
  }

  async function scanActivePage(): Promise<void> {
    try {
      const response = await request({ type: 'page/scan' });
      showToast(
        response.count > 0
          ? t('message.scanSuccess', { count: response.count })
          : t('message.scanEmpty'),
        response.count > 0 ? 'success' : 'error'
      );
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  async function deleteRecord(id: string): Promise<void> {
    try {
      const response = await request({ type: 'records/delete', id });
      records.value = response.records;
      removeSelected(id);
      showToast(t('message.recordDeleted'));
    } catch (error) {
      showToast(describeError(error, t), 'error');
    }
  }

  async function clearAll(): Promise<void> {
    try {
      const response = await request({ type: 'records/clear' });
      records.value = response.records;
      selectedIds.value = new Set();
      showToast(t('message.listCleared'));
    } catch (error) {
      showToast(describeError(error, t), 'error');
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

  function clearSelection(): void {
    selectedIds.value = new Set();
  }

  return {
    records,
    filter,
    selectedIds,
    filteredRecords,
    selectedVisibleIds,
    downloadTargetIds,
    filterOptions,
    setRecords,
    scanActivePage,
    deleteRecord,
    clearAll,
    toggleSelected,
    toggleSelectAll,
    clearSelection
  };
}

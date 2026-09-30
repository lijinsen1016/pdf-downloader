import { browser } from 'wxt/browser';
import { MAX_STORED_POST_BODIES, MAX_STORED_POST_BODY_BYTES, STORAGE_KEYS } from '../shared/types';

export interface StoredPostBody {
  contentType?: string;
  kind: 'form' | 'raw';
  formData?: Record<string, string[]>;
  base64?: string;
}

type PostBodyMap = Record<string, StoredPostBody>;

function estimateSize(body: StoredPostBody): number {
  if (body.base64) return body.base64.length;
  let size = 0;
  for (const values of Object.values(body.formData ?? {})) {
    for (const value of values) size += value.length;
  }
  return size;
}

/**
 * 从最新到最旧保留条目，超出数量或体积预算的最旧条目被淘汰，
 * 避免 storage.session 的 10MB 配额被 POST 本体吃满。
 */
function evict(
  entries: PostBodyMap,
  budgetBytes: number,
  maxCount: number
): { next: PostBodyMap; evicted: string[] } {
  const ids = Object.keys(entries);
  const next: PostBodyMap = {};
  const evicted: string[] = [];
  let keptBytes = 0;
  let keptCount = 0;

  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const id = ids[index];
    if (id === undefined) continue;
    const body = entries[id];
    if (!body) continue;

    const size = estimateSize(body);
    if (keptCount >= maxCount || keptBytes + size > budgetBytes) {
      evicted.push(id);
      continue;
    }

    next[id] = body;
    keptBytes += size;
    keptCount += 1;
  }

  return { next, evicted };
}

async function readAll(): Promise<PostBodyMap> {
  const raw = await browser.storage.session.get(STORAGE_KEYS.postBodies);
  const value = raw[STORAGE_KEYS.postBodies];
  if (!value || typeof value !== 'object') return {};
  return value as PostBodyMap;
}

async function writeAll(entries: PostBodyMap): Promise<void> {
  const { next, evicted } = evict(entries, MAX_STORED_POST_BODY_BYTES, MAX_STORED_POST_BODIES);
  try {
    await browser.storage.session.set({ [STORAGE_KEYS.postBodies]: next });
  } catch (error) {
    console.warn('[pdf-catcher] post body quota exceeded, dropping oldest entries', error);
    const retry = evict(
      entries,
      Math.floor(MAX_STORED_POST_BODY_BYTES / 2),
      Math.floor(MAX_STORED_POST_BODIES / 2)
    );
    await browser.storage.session.set({ [STORAGE_KEYS.postBodies]: retry.next });
  }
  if (evicted.length) {
    console.debug('[pdf-catcher] evicted post bodies', evicted.length);
  }
}

export async function loadPostBody(recordId: string): Promise<StoredPostBody | undefined> {
  return (await readAll())[recordId];
}

export async function savePostBody(recordId: string, body: StoredPostBody): Promise<void> {
  const all = await readAll();
  all[recordId] = body;
  await writeAll(all);
}

export async function deletePostBodies(recordIds: string[]): Promise<void> {
  if (!recordIds.length) return;
  const all = await readAll();
  for (const id of recordIds) delete all[id];
  await writeAll(all);
}

export async function clearPostBodies(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEYS.postBodies);
}

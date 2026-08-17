import { MAX_PENDING_REQUESTS, PENDING_TTL_MS } from '../shared/types';

export interface PendingResponse {
  statusCode: number;
  contentType?: string;
  contentDisposition?: string;
  contentLength?: number;
  contentRangeTotal?: number;
  fromCache?: boolean;
}

export interface PendingRequest {
  requestId: string;
  url: string;
  finalUrl?: string;
  tabId: number;
  method: string;
  createdAt: number;
  hasCookie: boolean;
  hasRange: boolean;
  authorizationValue?: string;
  response?: PendingResponse;
}

export class PendingRequestStore {
  private readonly pending = new Map<string, PendingRequest>();

  set(request: PendingRequest): void {
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      this.sweep(Date.now() - PENDING_TTL_MS);
    }
    this.pending.set(request.requestId, request);
  }

  get(requestId: string): PendingRequest | undefined {
    return this.pending.get(requestId);
  }

  delete(requestId: string): void {
    this.pending.delete(requestId);
  }

  sweep(now = Date.now()): void {
    const cutoff = now - PENDING_TTL_MS;
    for (const [id, request] of this.pending) {
      if (request.createdAt < cutoff) this.pending.delete(id);
    }
  }
}

export function parseContentRangeTotal(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^bytes\s+\d*-\d*\/(\d+)$/i.exec(value.trim());
  if (!match?.[1]) return undefined;
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

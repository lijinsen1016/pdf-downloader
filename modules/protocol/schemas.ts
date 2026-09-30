import { z } from 'zod';
import type { DownloadHistoryItem, DownloadJob, PdfRecord, Settings } from '../shared/types';

export const pdfRecordAuthSchema = z.object({
  cookie: z.boolean(),
  authHeaders: z.array(z.string()).default([]),
  bearerScheme: z.string().optional(),
  tokenRef: z.string().optional(),
  bearerTokenRef: z.string().optional()
});

export const pdfRecordSchema = z.object({
  id: z.string(),
  url: z.string(),
  finalUrl: z.string().optional(),
  host: z.string(),
  fileName: z.string(),
  mime: z.string().optional(),
  size: z.number().nonnegative().optional(),
  capturedAt: z.number(),
  tabId: z.number().optional(),
  statusCode: z.number().int(),
  partial: z.boolean().optional(),
  confidence: z.enum(['high', 'medium']),
  auth: pdfRecordAuthSchema,
  source: z.enum(['network', 'dom']).optional(),
  method: z.enum(['GET', 'POST']).optional()
});

export const historyItemSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  url: z.string(),
  host: z.string(),
  size: z.number().nonnegative().optional(),
  downloadedAt: z.number(),
  jobId: z.string().optional(),
  recordId: z.string().optional()
});

export const downloadJobSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  url: z.string(),
  fileName: z.string(),
  status: z.enum(['queued', 'fetching', 'starting', 'downloading', 'done', 'failed', 'canceled']),
  downloadId: z.number().optional(),
  blobUrl: z.string().optional(),
  errorKey: z.string().optional(),
  errorDetail: z.string().optional(),
  totalBytes: z.number().nonnegative().optional(),
  receivedBytes: z.number().nonnegative().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const settingsSchema = z.object({
  captureEnabled: z.boolean(),
  language: z.enum(['zh-CN', 'en']),
  retentionMinutes: z.number().int().min(1).max(60 * 24 * 30),
  maxRecords: z.number().int().min(10).max(2000),
  reuseAuthorization: z.boolean(),
  ignoredHosts: z.array(z.string()),
  historyEnabled: z.boolean().default(false),
  capturePostPdf: z.boolean().default(false),
  reusableHeaders: z.array(z.string()).default(['authorization'])
});

export const popupToBackgroundSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state/get')
  }),
  z.object({
    type: z.literal('records/delete'),
    id: z.string()
  }),
  z.object({
    type: z.literal('records/clear')
  }),
  z.object({
    type: z.literal('records/open'),
    id: z.string()
  }),
  z.object({
    type: z.literal('download/start'),
    ids: z.array(z.string()).min(1)
  }),
  z.object({
    type: z.literal('download/cancel'),
    jobId: z.string()
  }),
  z.object({
    type: z.literal('download/cancelAll')
  }),
  z.object({
    type: z.literal('settings/get')
  }),
  z.object({
    type: z.literal('settings/update'),
    patch: settingsSchema.partial()
  }),
  z.object({
    type: z.literal('page/scan')
  }),
  z.object({
    type: z.literal('history/get')
  }),
  z.object({
    type: z.literal('history/delete'),
    id: z.string()
  }),
  z.object({
    type: z.literal('history/clear')
  })
]);

export const offscreenBlobResponseSchema = z.object({
  ok: z.boolean(),
  blobUrl: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number().nonnegative().optional(),
  error: z.string().optional()
});

export const offscreenToDocumentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('offscreen/ping')
  }),
  z.object({
    type: z.literal('offscreen/fetch-blob'),
    jobId: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    method: z.enum(['GET', 'POST']).optional(),
    postBody: z
      .object({
        contentType: z.string().optional(),
        kind: z.enum(['form', 'raw']),
        formData: z.record(z.string(), z.array(z.string())).optional(),
        base64: z.string().optional()
      })
      .optional(),
    leaseMs: z.number().optional(),
    requirePdfMagic: z.boolean().optional()
  }),
  z.object({
    type: z.literal('offscreen/revoke-blob'),
    blobUrl: z.string()
  }),
  z.object({
    type: z.literal('offscreen/cancel-fetch'),
    jobId: z.string()
  })
]);

export type PopupToBackground = z.infer<typeof popupToBackgroundSchema>;

/** background 的响应同样过 schema，前端不再靠 `as` 强转。 */
export const stateGetResponseSchema = z.object({
  ok: z.literal(true),
  records: z.array(pdfRecordSchema),
  jobs: z.array(downloadJobSchema),
  history: z.array(historyItemSchema),
  settings: settingsSchema
});

export const recordsResponseSchema = z.object({
  ok: z.literal(true),
  records: z.array(pdfRecordSchema)
});

export const jobsResponseSchema = z.object({
  ok: z.literal(true),
  jobs: z.array(downloadJobSchema)
});

export const settingsResponseSchema = z.object({
  ok: z.literal(true),
  settings: settingsSchema
});

export const historyResponseSchema = z.object({
  ok: z.literal(true),
  history: z.array(historyItemSchema)
});

export const openRecordResponseSchema = z.object({
  ok: z.literal(true),
  url: z.string(),
  usedBlob: z.boolean(),
  usedAuthRule: z.boolean().optional()
});

export const okResponseSchema = z.object({ ok: z.literal(true) });

export const scanResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number()
});

export const errorResponseSchema = z.object({
  ok: z.literal(false),
  errorKey: z.string(),
  errorDetail: z.string().optional()
});

export const responseSchemas = {
  'state/get': stateGetResponseSchema,
  'records/delete': recordsResponseSchema,
  'records/clear': recordsResponseSchema,
  'records/open': openRecordResponseSchema,
  'download/start': jobsResponseSchema,
  'download/cancel': okResponseSchema,
  'download/cancelAll': okResponseSchema,
  'settings/get': settingsResponseSchema,
  'settings/update': settingsResponseSchema,
  'page/scan': scanResponseSchema,
  'history/get': historyResponseSchema,
  'history/delete': historyResponseSchema,
  'history/clear': historyResponseSchema
} satisfies Record<PopupToBackground['type'], z.ZodTypeAny>;

export type ResponseByType = {
  [K in keyof typeof responseSchemas]: z.infer<(typeof responseSchemas)[K]>;
};

export type PortEvent =
  | { type: 'records/changed'; records: PdfRecord[] }
  | { type: 'jobs/changed'; jobs: DownloadJob[] }
  | { type: 'settings/changed'; settings: Settings }
  | { type: 'history/changed'; history: DownloadHistoryItem[] }
  | { type: 'error'; errorKey: string; detail?: string };

export function safeParse<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

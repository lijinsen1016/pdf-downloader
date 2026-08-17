import { pathEndsWithPdf } from './url';
import { looksLikePdfFileName } from './file-name';
import { parseContentDisposition } from './content-disposition';

export interface ClassifyInput {
  method: string;
  statusCode: number;
  url: string;
  contentType?: string;
  contentDisposition?: string;
}

export type PdfVerdict =
  | { isPdf: false; reason: string }
  | {
      isPdf: true;
      confidence: 'high' | 'medium';
      source: 'content-type' | 'content-disposition' | 'url-extension';
      mime?: string;
      fileName?: string;
    };

function normalizeHeaderValue(value: string | undefined): string {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function classifyPdf(input: ClassifyInput): PdfVerdict {
  if (input.method.toUpperCase() !== 'GET') {
    return { isPdf: false, reason: 'non-get' };
  }

  if (input.statusCode < 200 || input.statusCode >= 300) {
    return { isPdf: false, reason: 'non-2xx' };
  }

  const mime = normalizeHeaderValue(input.contentType);

  if (mime === 'text/html' || mime === 'application/json') {
    return { isPdf: false, reason: 'non-pdf-content-type' };
  }

  if (mime === 'application/pdf' || mime === 'application/x-pdf' || mime === 'text/pdf') {
    const disposition = parseContentDisposition(input.contentDisposition).filename;
    return {
      isPdf: true,
      confidence: 'high',
      source: 'content-type',
      mime: input.contentType?.split(';')[0]?.trim() || mime,
      fileName: disposition
    };
  }

  const disposition = parseContentDisposition(input.contentDisposition).filename;
  if (looksLikePdfFileName(disposition)) {
    return {
      isPdf: true,
      confidence: 'high',
      source: 'content-disposition',
      mime: input.contentType?.split(';')[0]?.trim() || undefined,
      fileName: disposition
    };
  }

  if (pathEndsWithPdf(input.url) && (mime === '' || mime === 'application/octet-stream' || mime === 'binary/octet-stream')) {
    return {
      isPdf: true,
      confidence: 'medium',
      source: 'url-extension',
      mime: input.contentType?.split(';')[0]?.trim() || undefined
    };
  }

  return { isPdf: false, reason: 'no-pdf-signal' };
}

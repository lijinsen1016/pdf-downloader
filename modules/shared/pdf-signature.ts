const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const MAX_HEADER_SCAN = 1024;

/** 响应头声明的 PDF MIME。 */
export function isPdfContentType(contentType: string | undefined): boolean {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/pdf' || mime === 'application/x-pdf' || mime === 'text/pdf';
}

/**
 * 校验响应体开头是否为 %PDF- 魔数。
 * 允许前置 UTF-8 BOM 与少量空白/填充字节（最多扫描 1024 字节）。
 */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, MAX_HEADER_SCAN);
  let start = 0;

  if (limit >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }

  while (start < limit) {
    const byte = bytes[start];
    if (
      byte === 0x20 ||
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      byte === 0x0c ||
      byte === 0x00
    ) {
      start += 1;
      continue;
    }
    break;
  }

  if (start + PDF_MAGIC.length > bytes.length) return false;
  for (let index = 0; index < PDF_MAGIC.length; index += 1) {
    if (bytes[start + index] !== PDF_MAGIC[index]) return false;
  }
  return true;
}

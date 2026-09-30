const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** 响应头声明的 PDF MIME。 */
export function isPdfContentType(contentType: string | undefined): boolean {
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/pdf' || mime === 'application/x-pdf' || mime === 'text/pdf';
}

/**
 * 校验响应体开头是否为 %PDF- 魔数。
 * 有些服务端会在真正的 PDF 前拼接空白或 BOM，这里允许最多 1024 字节的前导空白。
 */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024);
  for (let start = 0; start < limit; start += 1) {
    const byte = bytes[start];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0xef) continue;
    for (let index = 0; index < PDF_MAGIC.length; index += 1) {
      if (bytes[start + index] !== PDF_MAGIC[index]) return false;
    }
    return true;
  }
  return false;
}

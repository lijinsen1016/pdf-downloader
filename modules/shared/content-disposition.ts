export interface ParsedContentDisposition {
  filename?: string;
}

function parseExtendedParameter(value: string): string | undefined {
  const match = /^(?:UTF-8|ISO-8859-1)'[^']*'([\s\S]*)$/i.exec(value.trim());
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * 解析 Content-Disposition 中的 filename / filename*。
 * 只处理常见格式，不引入完整 RFC 6266 依赖。
 */
export function parseContentDisposition(header?: string): ParsedContentDisposition {
  if (!header) return {};

  const parts = header.split(';').map((part) => part.trim());
  if (!parts.length) return {};

  let extended: string | undefined;
  let plain: string | undefined;

  for (const part of parts.slice(1)) {
    const extendedMatch = /^filename\*\s*=\s*(.+)$/i.exec(part);
    if (extendedMatch?.[1]) {
      const raw = extendedMatch[1].trim();
      extended = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      continue;
    }

    const plainMatch = /^filename\s*=\s*(.+)$/i.exec(part);
    if (plainMatch?.[1]) {
      const raw = plainMatch[1].trim();
      plain = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
  }

  const filename = extended ? parseExtendedParameter(extended) : plain;
  return filename ? { filename } : {};
}

import { browser } from 'wxt/browser';
import {
  errorResponseSchema,
  responseSchemas,
  type PopupToBackground,
  type ResponseByType
} from './schemas';

export class ProtocolError extends Error {
  constructor(
    public readonly errorKey: string,
    public readonly detail?: string
  ) {
    super(detail ? `${errorKey}: ${detail}` : errorKey);
    this.name = 'ProtocolError';
  }
}

/**
 * 类型化的 background RPC：发送请求并校验响应，
 * 失败时抛出带 errorKey 的 ProtocolError（便于 i18n 展示）。
 */
export async function request<T extends PopupToBackground['type']>(
  message: Extract<PopupToBackground, { type: T }>
): Promise<ResponseByType[T]> {
  const raw: unknown = await browser.runtime.sendMessage(message);

  const parsed = responseSchemas[message.type as T].safeParse(raw);
  if (parsed.success) {
    return parsed.data as ResponseByType[T];
  }

  const error = errorResponseSchema.safeParse(raw);
  if (error.success) {
    throw new ProtocolError(error.data.errorKey, error.data.errorDetail);
  }

  throw new ProtocolError('message.requestFailed');
}

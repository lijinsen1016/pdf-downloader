import type { ComposerTranslation } from 'vue-i18n';
import { ProtocolError } from './client';

/** 把 RPC 失败转换成可展示的本地化文案（popup 与 options 共用）。 */
export function describeError(error: unknown, t: ComposerTranslation): string {
  if (error instanceof ProtocolError) {
    return error.detail ? `${t(error.errorKey)}: ${error.detail}` : t(error.errorKey);
  }
  return t('message.requestFailed');
}

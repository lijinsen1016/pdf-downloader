import { closeOffscreenDocument, revokeBlobInOffscreen } from './offscreen-client';

const OFFSCREEN_CLOSE_DELAY_MS = 3000;

/**
 * 管理离屏文档创建的 blob URL 租约：只要还有未完成的下载/阅读页持有它，
 * 就不能关闭离屏文档；全部释放后再延迟关闭。
 */
export class BlobLeaseManager {
  private readonly leases = new Set<string>();
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  get size(): number {
    return this.leases.size;
  }

  has(blobUrl: string): boolean {
    return this.leases.has(blobUrl);
  }

  add(blobUrl: string): void {
    this.leases.add(blobUrl);
    this.cancelClose();
  }

  /** 释放租约并吊销 blob URL；返回是否真的持有过。 */
  release(blobUrl: string): boolean {
    if (!this.leases.delete(blobUrl)) return false;
    void revokeBlobInOffscreen(blobUrl);
    this.scheduleClose();
    return true;
  }

  /** 离屏文档自己报告租约到期时调用，不重复吊销。 */
  handleExpired(blobUrl: string): void {
    if (this.leases.delete(blobUrl)) this.scheduleClose();
  }

  cancelClose(): void {
    if (!this.closeTimer) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  }

  private scheduleClose(): void {
    if (this.leases.size > 0) return;
    this.cancelClose();
    this.closeTimer = setTimeout(() => {
      this.closeTimer = undefined;
      void closeOffscreenDocument();
    }, OFFSCREEN_CLOSE_DELAY_MS);
  }
}

import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  modulesDir: 'wxt.modules',
  manifest: {
    name: 'PDF Catcher - PDF 捕手',
    minimum_chrome_version: '116',
    description: '自动捕获网页中的 PDF 文档，支持搜索、批量下载和阅读。会话级存储，不保存敏感登录信息。',
    permissions: ['storage', 'downloads', 'webRequest', 'offscreen', 'scripting', 'declarativeNetRequest'],
    host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      'scan-page': {
        suggested_key: {
          default: 'Alt+Shift+P'
        },
        description: 'Scan the current page for PDF links'
      }
    }
  }
});

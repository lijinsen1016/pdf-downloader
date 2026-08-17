import { browser } from 'wxt/browser';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createRuleId(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return ((values[0] ?? 1) % 2_000_000_000) + 1;
}

/**
 * 通过 declarativeNetRequest 会话规则，为本次 main_frame 导航临时注入
 * Authorization 头。导航完成后删除规则，避免凭证泄漏到后续请求。
 */
export async function openWithAuthorizationRule(
  url: string,
  authorizationHeader: string
): Promise<boolean> {
  const ruleId = createRuleId();
  await browser.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            {
              header: 'Authorization',
              operation: 'set',
              value: authorizationHeader
            }
          ]
        },
        condition: {
          regexFilter: `^${escapeRegExp(url)}$`,
          requestMethods: ['get'],
          resourceTypes: ['main_frame']
        }
      }
    ]
  });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
    } catch {
      // 会话规则会随浏览器会话结束自动消失
    }
  };

  const tab = await browser.tabs.create({ url, active: true });
  const tabId = tab.id;

  const onUpdated = (updatedTabId: number, info: { status?: string }) => {
    if (updatedTabId === tabId && info.status === 'complete') {
      void cleanup();
    }
  };

  browser.tabs.onUpdated.addListener(onUpdated);
  setTimeout(() => {
    browser.tabs.onUpdated.removeListener(onUpdated);
    void cleanup();
  }, 15_000);

  return true;
}

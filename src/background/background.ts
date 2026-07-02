/**
 * BOSS自动投递 - Background Service Worker
 * 职责：轻量级消息中继
 * - 转发 popup 的命令到当前标签页的 content script
 * - 转发 content script 的状态更新回 popup
 */

import type { CommandMessage, StatusMessage, LogMessage } from '../shared/types';

/**
 * 监听来自 popup 或 content script 的消息
 * popup → background → content script (COMMAND)
 * content script → background → popup (STATUS / LOG)
 */
chrome.runtime.onMessage.addListener((message: CommandMessage | StatusMessage | LogMessage, sender, sendResponse) => {
  // 来自 popup 的命令：转发到当前活跃标签页的 content script
  if (message.type === 'COMMAND') {
    forwardToActiveTab(message).catch((err) => {
      console.error('[Background] 命令转发失败:', err);
    });
    sendResponse({ success: true });
    return;
  }

  // 来自 content script 的状态/日志：转发到 popup
  if (message.type === 'STATUS' || message.type === 'LOG') {
    // 使用 chrome.runtime.sendMessage 广播给 popup（popup 打开时才能收到）
    chrome.runtime.sendMessage(message).catch(() => {
      // popup 可能未打开，忽略发送失败
    });
    sendResponse({ success: true });
    return;
  }
});

/**
 * 转发命令到当前活跃标签页
 */
async function forwardToActiveTab(message: CommandMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    console.warn('[Background] 未找到活跃标签页');
    return;
  }

  // 检查 URL 是否匹配 zhipin.com
  if (!tab.url?.includes('zhipin.com')) {
    console.warn('[Background] 当前页面不是 zhipin.com，忽略命令');
    // 通知 popup 当前不在目标页面
    chrome.runtime.sendMessage({
      type: 'STATUS',
      state: 'IDLE',
      processedCount: 0,
      error: '请先打开 zhipin.com 职位列表页面',
    } satisfies StatusMessage).catch(() => {});
    return;
  }

  await chrome.tabs.sendMessage(tab.id, message);
}

// Service Worker 启动日志
console.log('[Background] BOSS自动投递 Service Worker 已启动');

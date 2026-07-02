/**
 * BOSS自动投递 - Popup (极简)
 * 只显示状态，操作在页面浮动面板中完成
 */

import { AutomationState, type StatusMessage } from '../shared/types';

const st = document.getElementById('st') as HTMLSpanElement;
const ct = document.getElementById('ct') as HTMLSpanElement;

const SCN: Record<string, string> = {
  IDLE: '就绪', FIND_NEXT_JOB: '查找职位', HIGHLIGHT_JOB: '高亮', CLICK_JOB: '点击',
  WAIT_DETAIL: '等待详情', FIND_COMMUNICATE: '查找沟通', HIGHLIGHT_COMMUNICATE: '高亮沟通',
  CLICK_COMMUNICATE: '点击沟通', CHECK_DIALOG: '检查弹窗', HIGHLIGHT_DIALOG: '高亮弹窗',
  CLICK_DIALOG: '点击弹窗', WAIT: '等待中', STOPPED: '已停止', ERROR: '错误',
  NO_MORE_JOBS: '全部完成',
};

// 打开时查询状态
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command: 'GET_STATUS' });
  } catch { /* */ }
})();

chrome.runtime.onMessage.addListener((msg: StatusMessage) => {
  if (msg.type !== 'STATUS') return;
  st.textContent = SCN[msg.state] || msg.state;
});

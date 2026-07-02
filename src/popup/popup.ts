/**
 * BOSS自动投递 - Popup
 * 打开时查询状态，显示进度和预计剩余时间
 */

import { AutomationState, type StatusMessage } from '../shared/types';

const go = document.getElementById('go') as HTMLButtonElement;
const sp = document.getElementById('sp') as HTMLButtonElement;
const st = document.getElementById('st') as HTMLSpanElement;
const ct = document.getElementById('ct') as HTMLSpanElement;
const eta = document.getElementById('eta') as HTMLSpanElement;

const STATE_CN: Record<string, string> = {
  IDLE: '就绪', FIND_NEXT_JOB: '查找职位', HIGHLIGHT_JOB: '高亮', CLICK_JOB: '点击',
  WAIT_DETAIL: '等待详情', FIND_COMMUNICATE: '查找沟通', HIGHLIGHT_COMMUNICATE: '高亮沟通',
  CLICK_COMMUNICATE: '点击沟通', CHECK_DIALOG: '检查弹窗', HIGHLIGHT_DIALOG: '高亮弹窗',
  CLICK_DIALOG: '点击弹窗', WAIT: '等待中', STOPPED: '已停止', ERROR: '错误',
  NO_MORE_JOBS: '全部完成',
};
const IDLE_STATES = [AutomationState.IDLE, AutomationState.STOPPED, AutomationState.NO_MORE_JOBS];

// === 打开时查询状态 ===
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command: 'GET_STATUS' });
  } catch { /* */ }
})();

go.addEventListener('click', async () => { await sendCmd('START'); });
sp.addEventListener('click', async () => { await sendCmd('STOP'); });

chrome.runtime.onMessage.addListener((msg: StatusMessage) => {
  if (msg.type !== 'STATUS') return;
  st.textContent = STATE_CN[msg.state] || msg.state;
  setRun(!IDLE_STATES.includes(msg.state));
});

// Content script 也会通过 chrome.runtime 发送额外的进度信息
// 我们从 popup 这边不主动轮询，依赖 STATUS message 中的 processedCount
// ETA 在面板中显示即可

async function sendCmd(cmd: 'START' | 'STOP'): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command: cmd });
  } catch { /* */ }
}

function setRun(v: boolean): void {
  go.classList.toggle('hidden', v);
  sp.classList.toggle('hidden', !v);
}

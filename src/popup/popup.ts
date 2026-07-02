/**
 * BOSS自动投递 - Popup (精简版)
 * 打开时主动查询运行状态，保持 UI 与实际同步
 */

import { AutomationState, type StatusMessage } from '../shared/types';

const go = document.getElementById('go') as HTMLButtonElement;
const sp = document.getElementById('sp') as HTMLButtonElement;
const st = document.getElementById('st') as HTMLSpanElement;
const ct = document.getElementById('ct') as HTMLSpanElement;

let running = false;

// === 打开时查询当前状态 ===
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command: 'GET_STATUS' });
  } catch { /* ignore */ }
})();

go.addEventListener('click', async () => {
  await sendCmd('START');
  setRun(true);
  st.textContent = '运行中';
});

sp.addEventListener('click', async () => {
  await sendCmd('STOP');
});

// 监听状态更新
chrome.runtime.onMessage.addListener((msg: StatusMessage) => {
  if (msg.type !== 'STATUS') return;
  st.textContent = msg.state;
  ct.textContent = String(msg.processedCount);
  const idle = [AutomationState.IDLE, AutomationState.STOPPED, AutomationState.NO_MORE_JOBS].includes(msg.state);
  setRun(!idle);
});

async function sendCmd(cmd: 'START' | 'STOP'): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command: cmd });
  } catch { /* ignore */ }
}

function setRun(v: boolean): void {
  running = v;
  go.classList.toggle('hidden', v);
  sp.classList.toggle('hidden', !v);
}

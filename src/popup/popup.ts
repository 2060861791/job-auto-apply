/**
 * BOSS自动投递 - Popup (精简版)
 * 只负责：开始/停止按钮 + 简单状态显示
 * 详细信息在页面右侧浮动面板查看
 */

import { type StatusMessage } from '../shared/types';

const go = document.getElementById('go') as HTMLButtonElement;
const sp = document.getElementById('sp') as HTMLButtonElement;
const st = document.getElementById('st') as HTMLSpanElement;
const ct = document.getElementById('ct') as HTMLSpanElement;

let running = false;

go.addEventListener('click', async () => {
  await sendCmd('START');
  setRun(true);
  st.textContent = '运行中';
});

sp.addEventListener('click', async () => {
  await sendCmd('STOP');
  setRun(false);
  st.textContent = '已停止';
});

chrome.runtime.onMessage.addListener((msg: StatusMessage) => {
  if (msg.type === 'STATUS') {
    st.textContent = msg.state;
    ct.textContent = String(msg.processedCount);
    if (msg.state === 'STOPPED' || msg.state === 'NO_MORE_JOBS' || msg.state === 'IDLE') {
      setRun(false);
    }
  }
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

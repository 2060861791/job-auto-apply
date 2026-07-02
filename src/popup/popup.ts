/**
 * BOSS自动投递 - Popup 脚本
 * 负责：Start/Stop 按钮交互、状态显示、日志展示
 */

import { AutomationState, type StatusMessage, type LogMessage } from '../shared/types';

// ========== DOM 元素引用 ==========
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const countText = document.getElementById('countText') as HTMLSpanElement;
const logContainer = document.getElementById('logContainer') as HTMLDivElement;
const clearLogBtn = document.getElementById('clearLogBtn') as HTMLButtonElement;

// ========== 状态 ==========
let isRunning = false;

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  // 查询当前运行状态
  sendCommand('GET_STATUS');

  // 绑定按钮事件
  startBtn.addEventListener('click', onStart);
  stopBtn.addEventListener('click', onStop);
  clearLogBtn.addEventListener('click', clearLogs);
});

// ========== 消息监听 ==========
chrome.runtime.onMessage.addListener((message: StatusMessage | LogMessage) => {
  if (message.type === 'STATUS') {
    handleStatusUpdate(message);
  } else if (message.type === 'LOG') {
    appendLog(message);
  }
});

// ========== 按钮事件处理 ==========
function onStart(): void {
  addLog('info', '发送开始命令...');
  sendCommand('START');
  setUIRunning(true);
  statusText.textContent = '运行中';
}

function onStop(): void {
  addLog('warn', '发送停止命令...');
  sendCommand('STOP');
}

// ========== 状态更新处理 ==========
function handleStatusUpdate(msg: StatusMessage): void {
  statusText.textContent = getStateLabel(msg.state);
  countText.textContent = `${msg.processedCount} 个职位`;

  switch (msg.state) {
    case AutomationState.IDLE:
    case AutomationState.STOPPED:
    case AutomationState.NO_MORE_JOBS:
      setUIRunning(false);
      break;
    default:
      setUIRunning(true);
      break;
  }

  if (msg.error) {
    addLog('error', msg.error);
  }
}

// ========== UI 切换 ==========
function setUIRunning(running: boolean): void {
  isRunning = running;
  if (running) {
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
  } else {
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }
}

// ========== 消息发送 ==========
/**
 * 向当前标签页的 content script 发送命令
 */
async function sendCommand(command: 'START' | 'STOP' | 'GET_STATUS'): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command });
    }
  } catch (err) {
    addLog('error', `发送命令失败: ${String(err)}`);
  }
}

// ========== 日志 ==========
/**
 * 向日志容器添加一条日志
 */
function addLog(level: 'info' | 'warn' | 'error', message: string): void {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  entry.textContent = `[${time}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  // 限制日志条数
  while (logContainer.children.length > 50) {
    logContainer.firstChild?.remove();
  }
}

/**
 * 追加来自 content script 的日志
 */
function appendLog(msg: LogMessage): void {
  addLog(msg.level, msg.message);
}

/** 清除所有日志 */
function clearLogs(): void {
  logContainer.innerHTML = '';
  addLog('info', '日志已清除');
}

/** 获取状态的中文标签 */
function getStateLabel(state: AutomationState): string {
  const labels: Record<AutomationState, string> = {
    [AutomationState.IDLE]: '就绪',
    [AutomationState.FIND_NEXT_JOB]: '查找下一条...',
    [AutomationState.HIGHLIGHT_JOB]: '高亮职位...',
    [AutomationState.CLICK_JOB]: '点击职位...',
    [AutomationState.WAIT_DETAIL]: '等待详情...',
    [AutomationState.FIND_COMMUNICATE]: '查找按钮...',
    [AutomationState.HIGHLIGHT_COMMUNICATE]: '高亮沟通按钮...',
    [AutomationState.CLICK_COMMUNICATE]: '点击沟通...',
    [AutomationState.CHECK_DIALOG]: '检查弹窗...',
    [AutomationState.HIGHLIGHT_DIALOG]: '高亮弹窗...',
    [AutomationState.CLICK_DIALOG]: '点击弹窗...',
    [AutomationState.SCROLL_JOB_LIST]: '滚动列表...',
    [AutomationState.WAIT_NEW_JOBS]: '等待加载...',
    [AutomationState.WAIT]: '等待中...',
    [AutomationState.STOPPED]: '已停止',
    [AutomationState.ERROR]: '错误',
    [AutomationState.NO_MORE_JOBS]: '无更多职位',
  };
  return labels[state] || state;
}

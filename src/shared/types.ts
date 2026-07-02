/**
 * 共享类型定义
 * 用于 popup、content script、background 之间的消息通信
 */

/** 自动化状态枚举 */
export enum AutomationState {
  IDLE = 'IDLE',
  FIND_NEXT_JOB = 'FIND_NEXT_JOB',
  HIGHLIGHT_JOB = 'HIGHLIGHT_JOB',
  CLICK_JOB = 'CLICK_JOB',
  WAIT_DETAIL = 'WAIT_DETAIL',
  FIND_COMMUNICATE = 'FIND_COMMUNICATE',
  HIGHLIGHT_COMMUNICATE = 'HIGHLIGHT_COMMUNICATE',
  CLICK_COMMUNICATE = 'CLICK_COMMUNICATE',
  CHECK_DIALOG = 'CHECK_DIALOG',
  HIGHLIGHT_DIALOG = 'HIGHLIGHT_DIALOG',
  CLICK_DIALOG = 'CLICK_DIALOG',
  SCROLL_JOB_LIST = 'SCROLL_JOB_LIST',
  WAIT_NEW_JOBS = 'WAIT_NEW_JOBS',
  WAIT = 'WAIT',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
  NO_MORE_JOBS = 'NO_MORE_JOBS',
}

/** 命令消息：popup → content script */
export interface CommandMessage {
  type: 'COMMAND';
  command: 'START' | 'STOP' | 'GET_STATUS';
}

/** 状态更新消息：content script → popup */
export interface StatusMessage {
  type: 'STATUS';
  state: AutomationState;
  processedCount: number;
  error?: string;
}

/** 日志消息：content script → popup（用于调试） */
export interface LogMessage {
  type: 'LOG';
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** 所有消息类型联合 */
export type Message = CommandMessage | StatusMessage | LogMessage;

/** 常量配置 */
export const CONFIG = {
  /** 操作间随机等待最小毫秒数 */
  WAIT_MIN_MS: 1000,
  /** 操作间随机等待最大毫秒数 */
  WAIT_MAX_MS: 3000,
  /** 高亮持续时间（毫秒） */
  HIGHLIGHT_DURATION_MS: 500,
  /** 等待详情加载超时（毫秒） */
  DETAIL_LOAD_TIMEOUT_MS: 5000,
  /** 等待新职位加载超时（毫秒） */
  NEW_JOB_TIMEOUT_MS: 8000,
  /** 最大连续错误次数（超过后停止） */
  MAX_ERROR_COUNT: 5,
  /** MutationObserver 等待新节点超时（毫秒） */
  MUTATION_OBSERVER_TIMEOUT_MS: 5000,
} as const;

/** 生成随机等待时间（毫秒） */
export function randomWaitMs(): number {
  return Math.floor(Math.random() * (CONFIG.WAIT_MAX_MS - CONFIG.WAIT_MIN_MS) + CONFIG.WAIT_MIN_MS);
}

/** 共享类型定义 */

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

export interface CommandMessage { type: 'COMMAND'; command: 'START' | 'STOP' | 'GET_STATUS' | 'TOGGLE_PANEL' | 'TOGGLE_FILTER'; }
export interface StatusMessage { type: 'STATUS'; state: AutomationState; processedCount: number; error?: string; }
export interface LogMessage { type: 'LOG'; level: 'info' | 'warn' | 'error'; message: string; }
export type Message = CommandMessage | StatusMessage | LogMessage;

/** 速度配置 */
export interface SpeedSettings {
  highlightMs: number;
  minWaitMs: number;
  maxWaitMs: number;
  detailTimeoutMs: number;
  dialogCheckMs: number;
  scrollWaitMs: number;
}

/** 速度预设 */
export const SPEED_PRESETS: Record<string, SpeedSettings> = {
  /** 推荐：90%+ 稳定，已是最优速度 */
  recommend: {
    highlightMs: 350,
    minWaitMs: 800,
    maxWaitMs: 1500,
    detailTimeoutMs: 4000,
    dialogCheckMs: 800,
    scrollWaitMs: 2000,
  },
  /** 稳定：更保守，适合网络慢时 */
  stable: {
    highlightMs: 600,
    minWaitMs: 1200,
    maxWaitMs: 2500,
    detailTimeoutMs: 6000,
    dialogCheckMs: 1500,
    scrollWaitMs: 3000,
  },
  /** 极速：最快速度，可能不稳定 */
  turbo: {
    highlightMs: 150,
    minWaitMs: 400,
    maxWaitMs: 800,
    detailTimeoutMs: 2500,
    dialogCheckMs: 500,
    scrollWaitMs: 1200,
  },
};

/** 默认使用推荐速度 */
export let ACTIVE_SPEED: SpeedSettings = { ...SPEED_PRESETS.recommend };

export function applySpeed(settings: SpeedSettings): void {
  ACTIVE_SPEED = { ...settings };
}

export function randomWaitMs(): number {
  const s = ACTIVE_SPEED;
  return Math.floor(Math.random() * (s.maxWaitMs - s.minWaitMs) + s.minWaitMs);
}

/** 其他常量 */
export const CONFIG = {
  MAX_ERROR_COUNT: 5,
  MUTATION_OBSERVER_TIMEOUT_MS: 6000,
} as const;

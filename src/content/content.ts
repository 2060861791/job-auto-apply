/**
 * BOSS自动投递 - Content Script
 *
 * 核心自动化逻辑，运行在 https://www.zhipin.com/* 页面。
 *
 * 设计要点：
 * - 状态机驱动（非 while(true) 死循环），通过 setTimeout 异步调度
 * - 每次循环重新查询 DOM，不缓存节点引用（应对懒加载和 DOM 变更）
 * - 所有选择器基于文字内容、role、aria-label，不依赖随机 class
 * - 操作前先高亮目标元素（红色边框+阴影 500ms），再执行 click
 * - 每个操作包裹 try-catch，失败不崩溃，记录日志后继续
 */

import {
  AutomationState,
  CONFIG,
  randomWaitMs,
  type CommandMessage,
  type StatusMessage,
  type LogMessage,
} from '../shared/types';

// ============================================================
// 全局状态
// ============================================================

/** 当前状态机状态 */
let currentState: AutomationState = AutomationState.IDLE;

/** 是否已收到停止命令 */
let stopped = false;

/** 当前处理的职位列表索引（指向下一个要点击的职位） */
let currentJobIndex = 0;

/** 已处理的职位计数 */
let processedCount = 0;

/** 连续错误计数（超过阈值自动停止） */
let consecutiveErrors = 0;

/** 下一次状态转换的定时器 ID（用于取消） */
let transitionTimerId: ReturnType<typeof setTimeout> | null = null;

// ============================================================
// 初始化
// ============================================================

console.log('[Content] BOSS自动投递 Content Script 已加载');

// 监听来自 popup（经 background 转发）的命令
chrome.runtime.onMessage.addListener((message: CommandMessage) => {
  if (message.type !== 'COMMAND') return;

  switch (message.command) {
    case 'START':
      start();
      break;
    case 'STOP':
      stop();
      break;
    case 'GET_STATUS':
      sendStatus(currentState);
      break;
  }
});

// ============================================================
// 对外接口：start() / stop()
// ============================================================

/** 启动状态机 */
function start(): void {
  if (currentState !== AutomationState.IDLE &&
      currentState !== AutomationState.STOPPED &&
      currentState !== AutomationState.NO_MORE_JOBS) {
    log('warn', '状态机已在运行中，忽略重复启动');
    return;
  }

  stopped = false;
  currentJobIndex = 0;
  processedCount = 0;
  consecutiveErrors = 0;
  log('info', '========== 开始自动投递 ==========');
  transition(AutomationState.FIND_NEXT_JOB, 500);
}

/** 停止状态机 */
function stop(): void {
  log('warn', '收到停止命令，正在停止...');
  stopped = true;

  // 取消待执行的定时器
  if (transitionTimerId !== null) {
    clearTimeout(transitionTimerId);
    transitionTimerId = null;
  }

  currentState = AutomationState.STOPPED;
  sendStatus(AutomationState.STOPPED);
  log('info', '========== 已停止 ==========');
}

// ============================================================
// 状态机核心
// ============================================================

/** 状态 → 处理函数的映射表 */
const stateHandlers: Record<AutomationState, () => Promise<AutomationState>> = {
  [AutomationState.IDLE]:               handleIdle,
  [AutomationState.FIND_NEXT_JOB]:      handleFindNextJob,
  [AutomationState.HIGHLIGHT_JOB]:      handleHighlightJob,
  [AutomationState.CLICK_JOB]:          handleClickJob,
  [AutomationState.WAIT_DETAIL]:        handleWaitDetail,
  [AutomationState.FIND_COMMUNICATE]:   handleFindCommunicate,
  [AutomationState.HIGHLIGHT_COMMUNICATE]: handleHighlightCommunicate,
  [AutomationState.CLICK_COMMUNICATE]:  handleClickCommunicate,
  [AutomationState.CHECK_DIALOG]:       handleCheckDialog,
  [AutomationState.HIGHLIGHT_DIALOG]:   handleHighlightDialog,
  [AutomationState.CLICK_DIALOG]:       handleClickDialog,
  [AutomationState.SCROLL_JOB_LIST]:    handleScrollJobList,
  [AutomationState.WAIT_NEW_JOBS]:      handleWaitNewJobs,
  [AutomationState.WAIT]:               handleWait,
  [AutomationState.STOPPED]:            handleStopped,
  [AutomationState.ERROR]:              handleError,
  [AutomationState.NO_MORE_JOBS]:       handleNoMoreJobs,
};

/**
 * 执行当前状态，获取下一个状态，并通过 setTimeout 调度
 * 这是状态机的驱动引擎
 */
async function executeState(state: AutomationState): Promise<void> {
  if (stopped) {
    currentState = AutomationState.STOPPED;
    sendStatus(AutomationState.STOPPED);
    return;
  }

  currentState = state;
  sendStatus(state);

  try {
    const nextState = await stateHandlers[state]();
    if (stopped) return;

    // 根据下一状态决定延迟
    const delay = getTransitionDelay(nextState);
    transition(nextState, delay);
  } catch (err) {
    // 任何未捕获的错误都不会导致崩溃
    handleStateError(err);
  }
}

/**
 * 调度状态转换
 * @param nextState 下一个状态
 * @param delayMs  延迟毫秒数
 */
function transition(nextState: AutomationState, delayMs: number = 0): void {
  if (stopped) {
    currentState = AutomationState.STOPPED;
    sendStatus(AutomationState.STOPPED);
    return;
  }

  // 清除之前的定时器
  if (transitionTimerId !== null) {
    clearTimeout(transitionTimerId);
  }

  transitionTimerId = setTimeout(() => {
    transitionTimerId = null;
    executeState(nextState);
  }, delayMs);
}

/**
 * 根据下一状态返回合适的转换延迟
 */
function getTransitionDelay(state: AutomationState): number {
  switch (state) {
    case AutomationState.HIGHLIGHT_JOB:
    case AutomationState.HIGHLIGHT_COMMUNICATE:
    case AutomationState.HIGHLIGHT_DIALOG:
      return CONFIG.HIGHLIGHT_DURATION_MS; // 500ms 高亮显示
    case AutomationState.WAIT:
      return randomWaitMs(); // 1000-3000ms 随机等待
    case AutomationState.WAIT_DETAIL:
      return 1500; // 等待详情渲染
    case AutomationState.WAIT_NEW_JOBS:
      return 2000; // 初始等待，然后由 waitForNewJobs 接管
    default:
      return 300; // 默认短延迟
  }
}

// ============================================================
// 状态处理函数
// ============================================================

/** IDLE: 等待开始命令，不做任何操作 */
async function handleIdle(): Promise<AutomationState> {
  return AutomationState.IDLE;
}

/** STOPPED: 已停止 */
async function handleStopped(): Promise<AutomationState> {
  return AutomationState.IDLE;
}

/** NO_MORE_JOBS: 所有职位已处理完毕 */
async function handleNoMoreJobs(): Promise<AutomationState> {
  log('info', `所有职位已处理完毕！共处理 ${processedCount} 个职位`);
  return AutomationState.NO_MORE_JOBS;
}

/** ERROR: 错误处理，记录日志后根据情况重试或停止 */
async function handleError(): Promise<AutomationState> {
  consecutiveErrors++;

  if (consecutiveErrors >= CONFIG.MAX_ERROR_COUNT) {
    log('error', `连续错误达到 ${CONFIG.MAX_ERROR_COUNT} 次，自动停止`);
    return AutomationState.STOPPED;
  }

  log('warn', `错误恢复中 (${consecutiveErrors}/${CONFIG.MAX_ERROR_COUNT})，等待后重试...`);
  return AutomationState.WAIT;
}

/** FIND_NEXT_JOB: 查找下一条待处理的职位 */
async function handleFindNextJob(): Promise<AutomationState> {
  const items = getJobItems();

  if (items.length === 0) {
    log('warn', '未找到职位列表元素，尝试滚动加载...');
    return AutomationState.SCROLL_JOB_LIST;
  }

  if (currentJobIndex >= items.length) {
    // 当前列表已处理完，尝试滚动加载更多
    log('info', `已处理完当前列表 ${items.length} 个职位，尝试加载更多...`);
    return AutomationState.SCROLL_JOB_LIST;
  }

  log('info', `定位第 ${currentJobIndex + 1}/${items.length} 个职位`);
  return AutomationState.HIGHLIGHT_JOB;
}

/** HIGHLIGHT_JOB: 高亮当前职位元素 */
async function handleHighlightJob(): Promise<AutomationState> {
  const items = getJobItems();
  if (currentJobIndex >= items.length) {
    return AutomationState.SCROLL_JOB_LIST;
  }

  const target = items[currentJobIndex];
  // 滚动到目标元素可视区域
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // 高亮并等待 500ms（由 transition 的延迟处理）
  highlightElement(target);
  log('info', '高亮职位元素 → 准备点击');
  return AutomationState.CLICK_JOB;
}

/** CLICK_JOB: 点击职位元素，打开详情 */
async function handleClickJob(): Promise<AutomationState> {
  const items = getJobItems();
  if (currentJobIndex >= items.length) {
    return AutomationState.SCROLL_JOB_LIST;
  }

  const target = items[currentJobIndex];
  target.click();
  log('info', `已点击第 ${currentJobIndex + 1} 个职位`);
  return AutomationState.WAIT_DETAIL;
}

/** WAIT_DETAIL: 等待右侧详情面板加载 */
async function handleWaitDetail(): Promise<AutomationState> {
  // 等待"立即沟通"按钮出现（最多等待 CONFIG.DETAIL_LOAD_TIMEOUT_MS）
  const btn = await waitForElement(
    () => findButtonByText('立即沟通'),
    CONFIG.DETAIL_LOAD_TIMEOUT_MS
  );

  if (!btn) {
    log('warn', '等待详情加载超时，跳过当前职位');
    currentJobIndex++;
    return AutomationState.WAIT;
  }

  log('info', '详情加载完成，找到"立即沟通"按钮');
  return AutomationState.FIND_COMMUNICATE;
}

/** FIND_COMMUNICATE: 查找"立即沟通"按钮 */
async function handleFindCommunicate(): Promise<AutomationState> {
  const btn = findButtonByText('立即沟通');

  if (!btn) {
    log('warn', '未找到"立即沟通"按钮，跳过当前职位');
    currentJobIndex++;
    return AutomationState.WAIT;
  }

  log('info', '找到"立即沟通"按钮');
  return AutomationState.HIGHLIGHT_COMMUNICATE;
}

/** HIGHLIGHT_COMMUNICATE: 高亮"立即沟通"按钮 */
async function handleHighlightCommunicate(): Promise<AutomationState> {
  const btn = findButtonByText('立即沟通');
  if (!btn) {
    currentJobIndex++;
    return AutomationState.WAIT;
  }

  btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightElement(btn);
  log('info', '高亮"立即沟通"按钮 → 准备点击');
  return AutomationState.CLICK_COMMUNICATE;
}

/** CLICK_COMMUNICATE: 点击"立即沟通"按钮 */
async function handleClickCommunicate(): Promise<AutomationState> {
  const btn = findButtonByText('立即沟通');
  if (!btn) {
    log('warn', '"立即沟通"按钮已消失，可能已处理过');
    currentJobIndex++;
    return AutomationState.WAIT;
  }

  btn.click();
  log('info', '已点击"立即沟通"');
  return AutomationState.CHECK_DIALOG;
}

/** CHECK_DIALOG: 检查是否出现"留在此页"弹窗 */
async function handleCheckDialog(): Promise<AutomationState> {
  // 等待弹窗可能出现（短暂延迟）
  await sleep(800);

  const dialogBtn = findButtonByText('留在此页');

  if (dialogBtn) {
    log('info', '检测到"留在此页"弹窗');
    return AutomationState.HIGHLIGHT_DIALOG;
  }

  log('info', '无弹窗，处理完成');
  // 当前职位处理完成
  currentJobIndex++;
  processedCount++;
  consecutiveErrors = 0; // 成功后重置错误计数
  return AutomationState.WAIT;
}

/** HIGHLIGHT_DIALOG: 高亮"留在此页"按钮 */
async function handleHighlightDialog(): Promise<AutomationState> {
  const dialogBtn = findButtonByText('留在此页');
  if (!dialogBtn) {
    // 弹窗已消失
    currentJobIndex++;
    processedCount++;
    consecutiveErrors = 0;
    return AutomationState.WAIT;
  }

  dialogBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightElement(dialogBtn);
  log('info', '高亮"留在此页"按钮 → 准备点击');
  return AutomationState.CLICK_DIALOG;
}

/** CLICK_DIALOG: 点击"留在此页"按钮 */
async function handleClickDialog(): Promise<AutomationState> {
  const dialogBtn = findButtonByText('留在此页');
  if (!dialogBtn) {
    // 弹窗已消失
    currentJobIndex++;
    processedCount++;
    consecutiveErrors = 0;
    return AutomationState.WAIT;
  }

  dialogBtn.click();
  log('info', '已点击"留在此页"');
  currentJobIndex++;
  processedCount++;
  consecutiveErrors = 0;
  return AutomationState.WAIT;
}

/** SCROLL_JOB_LIST: 滚动职位列表以触发懒加载 */
async function handleScrollJobList(): Promise<AutomationState> {
  const scrolled = scrollJobList();

  if (!scrolled) {
    log('info', '无法滚动列表，可能已到底部');
    return AutomationState.NO_MORE_JOBS;
  }

  log('info', '已滚动职位列表，等待新职位加载...');
  return AutomationState.WAIT_NEW_JOBS;
}

/** WAIT_NEW_JOBS: 等待新职位节点加载完成 */
async function handleWaitNewJobs(): Promise<AutomationState> {
  const hasNew = await waitForNewJobs();

  if (hasNew) {
    log('info', '检测到新职位已加载');
    return AutomationState.FIND_NEXT_JOB;
  }

  // 超时仍无新职位
  log('info', '无更多新职位加载');
  return AutomationState.NO_MORE_JOBS;
}

/** WAIT: 随机等待，然后回到查找下一条 */
async function handleWait(): Promise<AutomationState> {
  return AutomationState.FIND_NEXT_JOB;
}

// ============================================================
// DOM 操作工具函数
// ============================================================

/**
 * 按文字内容查找按钮
 * 使用多种策略，优先 XPath 文字匹配，其次 role/aria-label
 *
 * @param text 按钮文字（支持部分匹配）
 * @returns 匹配的元素，未找到返回 null
 */
function findButtonByText(text: string): HTMLElement | null {
  // 策略 1: XPath 精确文字匹配 button 标签
  const xpath = `.//button[contains(text(), '${text}')]`;
  const byXpath = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue as HTMLElement | null;
  if (byXpath) return byXpath;

  // 策略 2: 查找所有 <button>，匹配 innerText
  const buttons = Array.from(document.querySelectorAll('button'));
  const byButtonText = buttons.find(
    (btn) => btn.textContent?.includes(text)
  ) as HTMLElement | undefined;
  if (byButtonText) return byButtonText;

  // 策略 3: 查找 role="button" 且文字匹配的元素
  const roleButtons = Array.from(document.querySelectorAll('[role="button"]'));
  const byRole = roleButtons.find(
    (el) => el.textContent?.includes(text)
  ) as HTMLElement | undefined;
  if (byRole) return byRole;

  // 策略 4: 查找包含文字的 <span> 或 <a> 标签（有些按钮不用 <button> 实现）
  const spans = Array.from(document.querySelectorAll('span, a, div[role="button"]'));
  const bySpan = spans.find(
    (el) => el.textContent?.trim() === text || el.textContent?.includes(text)
  ) as HTMLElement | undefined;
  if (bySpan) return bySpan;

  // 策略 5: 检查 aria-label 属性
  const allElements = Array.from(document.querySelectorAll('[aria-label]'));
  const byAria = allElements.find(
    (el) => el.getAttribute('aria-label')?.includes(text)
  ) as HTMLElement | undefined;
  if (byAria) return byAria;

  return null;
}

/**
 * 高亮目标元素
 * 添加醒目的红色边框和阴影效果，视觉反馈当前操作目标
 * 注意：样式会在 transition 的 HIGHLIGHT_DURATION_MS 后被 click 状态覆盖（通过后续状态点击）
 *
 * @param el 要高亮的 DOM 元素
 */
function highlightElement(el: HTMLElement): void {
  const originalOutline = el.style.outline;
  const originalBoxShadow = el.style.boxShadow;
  const originalTransition = el.style.transition;

  // 设置高亮样式
  el.style.outline = '3px solid red';
  el.style.boxShadow = '0 0 16px 4px rgba(255, 0, 0, 0.6)';
  el.style.transition = 'outline 0.3s, box-shadow 0.3s';

  // 500ms 后移除高亮
  setTimeout(() => {
    el.style.outline = originalOutline;
    el.style.boxShadow = originalBoxShadow;
    el.style.transition = originalTransition;
  }, CONFIG.HIGHLIGHT_DURATION_MS);
}

/**
 * 获取当前可见的职位列表项
 * 每次调用都重新查询 DOM，不缓存
 *
 * 查找策略（按优先级）：
 * 1. 查找所有 <li> 中符合职位卡片特征的
 * 2. 查找职位列表容器中结构相似的子元素
 * 3. 匹配包含薪资、公司等职位特征的卡片元素
 *
 * @returns 职位元素数组
 */
function getJobItems(): HTMLElement[] {
  // 策略 1: 查找 <li> 元素中包含职位信息的（BOSS直聘常用 li 列表）
  const allLi = Array.from(document.querySelectorAll('li')) as HTMLElement[];
  const jobLis = allLi.filter((li) => {
    const text = li.textContent || '';
    // 职位卡片通常包含：职位名 + 公司名 + 薪资/地点等信息
    return text.length > 20 && text.length < 500 && isJobCardLike(text);
  });

  if (jobLis.length >= 3) {
    // 确保这些 <li> 是同级且结构相似的（同一列表）
    const siblings = getLargestSiblingGroup(jobLis);
    if (siblings.length >= 3) return siblings;
  }

  // 策略 2: 查找职位列表区域内的可点击卡片
  // 寻找包含大量相似子元素的容器
  const container = findJobListContainer();
  if (container) {
    const cards = Array.from(container.children) as HTMLElement[];
    const jobCards = cards.filter((card) => {
      const text = card.textContent || '';
      return text.length > 20 && isJobCardLike(text);
    });

    if (jobCards.length >= 3) return jobCards;
  }

  // 策略 3: 全局搜索所有类似职位卡片的可点击元素
  const clickables = Array.from(
    document.querySelectorAll('div[class*="card"], div[class*="item"], li[class*="card"], li[class*="item"]')
  ) as HTMLElement[];

  const cards = clickables.filter((el) => {
    const text = el.textContent || '';
    return isJobCardLike(text);
  });

  if (cards.length >= 3) return cards;

  // 策略 4: 最后的兜底——查找所有可点击的、包含职位关键词的 div/li
  const allDivs = Array.from(document.querySelectorAll('div, li')) as HTMLElement[];
  const fallbackCards = allDivs.filter((el) => {
    const text = el.textContent || '';
    // 必须有职位特征且可点击（或者是可交互的）
    return text.length > 15 && text.length < 300 && isJobCardLike(text);
  });

  // 取最大同级组
  return getLargestSiblingGroup(fallbackCards);
}

/**
 * 判断文本内容是否像职位卡片
 * 职位卡片特征：包含职位名称（如工程师、经理等）+ 公司名或薪资信息
 */
function isJobCardLike(text: string): boolean {
  // 常见职位关键词
  const jobKeywords = [
    '工程师', '经理', '专员', '设计师', '运营', '开发',
    '产品', '销售', '市场', '财务', 'HR', '行政', '客服',
    '前端', '后端', '全栈', '测试', '运维', '架构师',
    '工程師', '設計師', '產品', '營運', '行銷',
  ];

  const hasJobKeyword = jobKeywords.some((kw) => text.includes(kw));
  if (!hasJobKeyword) return false;

  // 应该包含薪资或地点信息
  const hasSalaryOrLocation = /\d{1,2}[kK万]/.test(text) || /北京|上海|广州|深圳|杭州|成都|武汉/.test(text);
  return hasSalaryOrLocation;
}

/**
 * 从元素数组中找出最大的同级元素组
 * （同属一个父容器的元素）
 */
function getLargestSiblingGroup(elements: HTMLElement[]): HTMLElement[] {
  if (elements.length === 0) return [];

  // 按父元素分组
  const groups = new Map<HTMLElement, HTMLElement[]>();
  for (const el of elements) {
    const parent = el.parentElement;
    if (!parent) continue;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(el);
  }

  // 返回最大分组
  let largest: HTMLElement[] = [];
  for (const group of groups.values()) {
    if (group.length > largest.length) {
      largest = group;
    }
  }

  return largest;
}

/**
 * 查找职位列表的滚动容器
 * 特征：包含大量子元素的、可滚动的容器
 */
function findJobListContainer(): HTMLElement | null {
  // 查找所有可滚动元素
  const scrollables = Array.from(document.querySelectorAll('*')).filter((el) => {
    const style = window.getComputedStyle(el);
    const overflow = style.overflowY || style.overflow;
    return (
      (overflow === 'auto' || overflow === 'scroll') &&
      el.scrollHeight > el.clientHeight + 50
    );
  }) as HTMLElement[];

  // 选择包含最多子元素的那个（且子元素看起来像职位卡片）
  let bestContainer: HTMLElement | null = null;
  let bestScore = 0;

  for (const container of scrollables) {
    const children = Array.from(container.children) as HTMLElement[];
    const jobLikeCount = children.filter((child) => {
      const text = child.textContent || '';
      return text.length > 20 && isJobCardLike(text);
    }).length;

    if (jobLikeCount > bestScore) {
      bestScore = jobLikeCount;
      bestContainer = container;
    }
  }

  return bestContainer;
}

/**
 * 滚动职位列表到底部，触发懒加载
 * @returns 是否成功执行了滚动
 */
function scrollJobList(): boolean {
  const container = findJobListContainer();

  if (container) {
    // 滚动到列表容器底部
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
    return true;
  }

  // 兜底：如果有职位列表项，滚动它们的父容器
  const items = getJobItems();
  if (items.length > 0) {
    const parent = items[0].parentElement;
    if (parent) {
      parent.scrollTo({
        top: parent.scrollHeight,
        behavior: 'smooth',
      });
      return true;
    }
  }

  // 最后兜底：滚动整个页面
  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: 'smooth',
  });
  return true;
}

/**
 * 等待新职位节点出现在 DOM 中
 * 使用 MutationObserver 监听职位列表容器的子节点变化
 *
 * @returns 是否在超时前检测到新节点
 */
function waitForNewJobs(): Promise<boolean> {
  return new Promise((resolve) => {
    // 记录当前职位数量
    const currentCount = getJobItems().length;
    log('info', `当前列表有 ${currentCount} 个职位，等待新职位加载...`);

    const container = findJobListContainer();

    if (!container) {
      // 没有找到容器，使用轮询方式
      pollForNewJobs(currentCount, resolve);
      return;
    }

    // 使用 MutationObserver 监听 DOM 变更
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        const newCount = getJobItems().length;
        resolve(newCount > currentCount);
      }
    }, CONFIG.MUTATION_OBSERVER_TIMEOUT_MS);

    const observer = new MutationObserver(() => {
      if (resolved) return;
      const newCount = getJobItems().length;
      if (newCount > currentCount) {
        resolved = true;
        clearTimeout(timeoutId);
        observer.disconnect();
        log('info', `新职位已加载：${currentCount} → ${newCount}`);
        resolve(true);
      }
    });

    // 监听容器的子节点变化
    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    // 同时启动轮询作为双保险
    const pollInterval = setInterval(() => {
      if (resolved) {
        clearInterval(pollInterval);
        return;
      }
      const newCount = getJobItems().length;
      if (newCount > currentCount) {
        resolved = true;
        clearInterval(pollInterval);
        clearTimeout(timeoutId);
        observer.disconnect();
        log('info', `轮询检测到新职位：${currentCount} → ${newCount}`);
        resolve(true);
      }
    }, 1000);
  });
}

/**
 * 轮询方式等待新职位
 */
function pollForNewJobs(
  initialCount: number,
  resolve: (value: boolean) => void,
  startTime: number = Date.now()
): void {
  const elapsed = Date.now() - startTime;

  if (elapsed > CONFIG.NEW_JOB_TIMEOUT_MS) {
    const newCount = getJobItems().length;
    resolve(newCount > initialCount);
    return;
  }

  const newCount = getJobItems().length;
  if (newCount > initialCount) {
    resolve(true);
    return;
  }

  setTimeout(() => pollForNewJobs(initialCount, resolve, startTime), 500);
}

/**
 * 等待某个条件成立
 * 通过轮询检查一个函数，直到它返回真值或超时
 *
 * @param fn     返回目标元素或真值的函数
 * @param timeoutMs 超时毫秒数
 * @returns 目标值或 null
 */
function waitForElement<T>(
  fn: () => T | null,
  timeoutMs: number = CONFIG.DETAIL_LOAD_TIMEOUT_MS
): Promise<T | null> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    function check(): void {
      const result = fn();
      if (result) {
        resolve(result);
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(check, 300);
    }

    check();
  });
}

// ============================================================
// 错误处理
// ============================================================

/**
 * 状态处理中的错误捕获
 * 记录日志，转换到 ERROR 状态（由 handleError 决定下一步）
 */
function handleStateError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  log('error', `状态 [${currentState}] 出错: ${message}`);
  transition(AutomationState.ERROR, 500);
}

// ============================================================
// 消息通信
// ============================================================

/**
 * 发送状态更新到 popup（通过 background 转发）
 */
function sendStatus(state: AutomationState, error?: string): void {
  const msg: StatusMessage = {
    type: 'STATUS',
    state,
    processedCount,
    error,
  };

  chrome.runtime.sendMessage(msg).catch(() => {
    // popup 未打开时忽略
  });
}

/**
 * 记录日志并发送到 popup
 */
function log(level: 'info' | 'warn' | 'error', message: string): void {
  const prefix = '[BOSS自动投递]';
  const fullMsg = `${prefix} ${message}`;

  // 同时输出到浏览器控制台
  switch (level) {
    case 'warn':  console.warn(fullMsg); break;
    case 'error': console.error(fullMsg); break;
    default:      console.log(fullMsg); break;
  }

  // 发送到 popup
  const logMsg: LogMessage = { type: 'LOG', level, message };
  chrome.runtime.sendMessage(logMsg).catch(() => {});
}

// ============================================================
// 通用工具
// ============================================================

/** Promise 版本的 setTimeout */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

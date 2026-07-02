/**
 * BOSS自动投递 - Content Script v8
 *
 * 精简版：可拖动面板 + 速度设置 + 自动化 + 投递记录
 * 移除：滚动加载（用户手动预加载）、清除按钮
 * 到达列表末尾自动停止
 */

import {
  AutomationState,
  CONFIG,
  applySpeed,
  randomWaitMs,
  SPEED_PRESETS,
  type SpeedSettings,
  type CommandMessage,
  type StatusMessage,
  type LogMessage,
} from '../shared/types';

// ============================================================
// 全局
// ============================================================
let currentState: AutomationState = AutomationState.IDLE;
let stopped = false;
let lastClickedJobText = '';
let processedCount = 0;
let consecutiveErrors = 0;
let transitionTimerId: ReturnType<typeof setTimeout> | null = null;

let panel: HTMLElement | null = null;
let jobItems: HTMLElement[] = [];
let currentIdx = 0;
let clickInspect = false;
let settingsOpen = false;

// 拖动
let dragging = false, dsx = 0, dsy = 0, psx = 0, psy = 0;

// 投递记录
interface SubJob { time: string; title: string; company: string; location: string; tags: string; status: string; }
const submittedJobs: SubJob[] = [];

let speed: SpeedSettings = { ...SPEED_PRESETS.recommend };

// ============================================================
// 初始化
// ============================================================

function init(): void {
  try {
    if (panel) return;
    createPanel();
    refresh();
  } catch (e) {
    console.error('[BOSS] 初始化失败:', e);
  }
}

// 等页面稳定后初始化
setTimeout(init, 1500);
// 页面完全加载后再试一次
window.addEventListener('load', () => setTimeout(init, 2000));

chrome.runtime.onMessage.addListener((message: CommandMessage) => {
  if (message.type !== 'COMMAND') return;
  switch (message.command) {
    case 'START': start(); break;
    case 'STOP': stop(); break;
    case 'GET_STATUS': sendStatus(currentState); break;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!dragging || !panel) return;
  let nx = psx + (e.clientX - dsx);
  let ny = psy + (e.clientY - dsy);
  nx = Math.max(0, Math.min(nx, window.innerWidth - panel.offsetWidth));
  ny = Math.max(0, Math.min(ny, window.innerHeight - 60));
  panel.style.left = nx + 'px';
  panel.style.top = ny + 'px';
  panel.style.right = 'auto';
});
document.addEventListener('mouseup', () => { dragging = false; });

// 点击检测
document.addEventListener('click', (e) => {
  if (!clickInspect) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  inspectElement(e.target as HTMLElement);
}, true);

// ============================================================
// 面板
// ============================================================

function createPanel(): void {
  if (document.getElementById('__boss_panel__')) return;

  panel = document.createElement('div');
  panel.id = '__boss_panel__';
  panel.innerHTML =
`<style>
._bp{position:fixed;top:80px;right:16px;width:360px;background:#1a1a2e;color:#cdd6f4;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.55);z-index:999999;font-family:system-ui,-apple-system,sans-serif;font-size:12px;overflow:hidden;user-select:none;}
._bp *{box-sizing:border-box;margin:0;padding:0;}
._bph{cursor:move;background:linear-gradient(135deg,#2d2d44,#252540);padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #3a3a55;}
._bph ._bphi{font-size:13px;}
._bph ._bpht{font-weight:700;font-size:13px;color:#e2a4f5;flex:1;}
._bph ._bphb{font-size:10px;background:#3a3a55;color:#a6adc8;padding:2px 8px;border-radius:10px;}
._bph button{width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:#a6adc8;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
._bph button:hover{background:#3a3a55;color:#fff;}
._bps{display:flex;border-bottom:1px solid #2a2a44;}
._bps ._bpsi{flex:1;text-align:center;padding:10px 4px;border-right:1px solid #2a2a44;}
._bps ._bpsi:last-child{border-right:none;}
._bps ._bpsv{font-size:18px;font-weight:700;}
._bps ._bpsl{font-size:10px;color:#78789e;margin-top:2px;}
._bpb{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #2a2a44;}
._bpb button{flex:1;padding:7px 0;border:1px solid #3a3a55;border-radius:7px;background:#22223a;color:#cdd6f4;font-size:11px;cursor:pointer;transition:all .15s;}
._bpb button:hover{background:#2d2d48;border-color:#545478;}
._bpb ._na{background:#89b4fa;color:#1a1a2e;border-color:#89b4fa;font-weight:600;}
._bpb ._nn{background:#a6e3a1;color:#1a1a2e;border-color:#a6e3a1;font-weight:600;}
._bpb ._nd{background:#f38ba8;color:#1a1a2e;border-color:#f38ba8;font-weight:600;}
._bpb ._nx{background:#a6e3a1;color:#1a1a2e;border-color:#a6e3a1;font-weight:700;}
._bcfg{display:none;padding:10px 14px;border-bottom:1px solid #2a2a44;background:#1e1e34;}
._bcfg.o{display:block;}
._bcfg ._bcgt{font-size:11px;font-weight:600;color:#78789e;margin-bottom:8px;}
._bcfg ._bcgr{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
._bcfg ._bcgr label{width:55px;font-size:11px;color:#a6adc8;flex-shrink:0;text-align:right;}
._bcfg ._bcgr input[type=range]{flex:1;accent-color:#89b4fa;height:4px;}
._bcfg ._bcgr ._bcgv{width:70px;font-size:11px;color:#a6e3a1;flex-shrink:0;}
._bcfg ._bcgp{display:flex;gap:6px;margin-top:8px;}
._bcfg ._bcgp button{flex:1;padding:6px 0;border-radius:6px;border:1px solid #3a3a55;background:#22223a;color:#cdd6f4;font-size:11px;cursor:pointer;}
._bcfg ._bcgp button:hover{background:#2d2d48;}
._bcfg ._bcgp ._sel{border-color:#89b4fa;color:#89b4fa;font-weight:600;}
._bpo{max-height:260px;overflow-y:auto;padding:10px 14px;font-size:11px;line-height:1.65;color:#b4b8d0;}
._bpo b{color:#e2a4f5;}
._bpo ._dim{color:#585b70;}
._bpo ._ac{color:#a6e3a1;}
._bpo ._cu{color:#f9e2af;}
._bpo ._sb{color:#f38ba8;}
._bpo::-webkit-scrollbar{width:4px;}
._bpo::-webkit-scrollbar-thumb{background:#3a3a55;border-radius:2px;}
</style>
<div class="_bp">
<div class="_bph" id="_ph">
  <span class="_bphi">≡</span>
  <span class="_bpht">BOSS 自动投递 v8</span>
  <span class="_bphb" id="_badge">就绪</span>
  <button id="_cfgBtn" title="速度设置">⚙</button>
  <button id="_minBtn" title="折叠">─</button>
</div>
<div class="_bps">
  <div class="_bpsi"><div class="_bpsv" id="_cnt" style="color:#a6e3a1">-</div><div class="_bpsl">检测到</div></div>
  <div class="_bpsi"><div class="_bpsv" id="_sent" style="color:#f5c2e7">0</div><div class="_bpsl">已投递</div></div>
  <div class="_bpsi"><div class="_bpsv" id="_idx" style="color:#f9e2af">-</div><div class="_bpsl">当前</div></div>
  <div class="_bpsi"><div class="_bpsv" id="_st" style="color:#f38ba8;font-size:11px;">就绪</div><div class="_bpsl">状态</div></div>
</div>
<div class="_bpb">
  <button class="_na" id="_prev" style="flex:.7;font-size:16px;">◀</button>
  <button class="_nn" id="_next" style="flex:.7;font-size:16px;">▶</button>
  <button id="_inspect">🎯 OFF</button>
  <button id="_export" class="_nx">📥 导出</button>
</div>
<div class="_bcfg" id="_cfgPanel">
  <div class="_bcgt">⚙ 速度设置 (<span id="_speedLabel">推荐</span>)</div>
  <div class="_bcgr"><label>高亮</label><input type="range" id="_sHl" min="100" max="2000" step="50"><span class="_bcgv" id="_sHlV">350ms</span></div>
  <div class="_bcgr"><label>步间最小</label><input type="range" id="_sMin" min="200" max="3000" step="100"><span class="_bcgv" id="_sMinV">800ms</span></div>
  <div class="_bcgr"><label>步间最大</label><input type="range" id="_sMax" min="500" max="5000" step="100"><span class="_bcgv" id="_sMaxV">1500ms</span></div>
  <div class="_bcgr"><label>加载超时</label><input type="range" id="_sTmo" min="1500" max="8000" step="100"><span class="_bcgv" id="_sTmoV">4000ms</span></div>
  <div class="_bcgp">
    <button id="_preStable">🐢 稳定</button>
    <button id="_preRec" class="_sel">⚡ 推荐</button>
    <button id="_preTurbo">🚀 极速</button>
  </div>
</div>
<div class="_bpo" id="_output">加载中...</div>
</div>`;

  document.body.appendChild(panel);

  // 拖动
  const ph = panel.querySelector('#_ph')!;
  ph.addEventListener('mousedown', (e) => {
    const me = e as MouseEvent;
    if ((me.target as HTMLElement).tagName === 'BUTTON') return;
    dragging = true;
    dsx = me.clientX; dsy = me.clientY;
    const r = panel!.getBoundingClientRect();
    psx = r.left; psy = r.top;
  });

  // 按钮
  on('#_prev', () => nav(-1));
  on('#_next', () => nav(1));
  on('#_inspect', () => {
    clickInspect = !clickInspect;
    const b = getEl('_inspect');
    b.textContent = clickInspect ? '🎯 ON' : '🎯 OFF';
    b.className = clickInspect ? '_nd' : '';
    if (clickInspect) setOut('✅ 点击检测 ON');
  });
  on('#_export', exportJobs);
  on('#_cfgBtn', () => { settingsOpen = !settingsOpen; getEl('_cfgPanel').classList.toggle('o', settingsOpen); });
  on('#_minBtn', toggleMin);

  // 设置
  slider('_sHl', '_sHlV', 'highlightMs');
  slider('_sMin', '_sMinV', 'minWaitMs');
  slider('_sMax', '_sMaxV', 'maxWaitMs');
  slider('_sTmo', '_sTmoV', 'detailTimeoutMs');
  on('#_preStable', () => preset('stable'));
  on('#_preRec', () => preset('recommend'));
  on('#_preTurbo', () => preset('turbo'));

  syncSliders();
}

function toggleMin(): void {
  const kids = panel!.children[0].children;
  for (let i = 1; i < kids.length; i++) {
    (kids[i] as HTMLElement).style.display =
      (kids[i] as HTMLElement).style.display === 'none' ? '' : 'none';
  }
}

// ============================================================
// 刷新
// ============================================================

function refresh(): void {
  try {
    jobItems = getJobCards();
    const ai = findActiveIdx(jobItems);
    if (ai >= 0) currentIdx = ai;
    updateStats();
    buildOutput();
    if (jobItems.length > 0 && currentIdx < jobItems.length) hlCard(currentIdx);
  } catch (e) {
    setOut('⚠ 刷新出错: ' + String(e));
  }
}

function buildOutput(): void {
  const L: string[] = [];
  const a = (s: string) => L.push(s);
  a(`📋 <b>${jobItems.length}</b> 个职位 | 已投递 <b class="_sb">${submittedJobs.length}</b> | ${currentState}`);
  a('');
  if (jobItems.length > 0) {
    jobItems.forEach((card, i) => {
      const title = t(card, 'a.job-name').substring(0, 22);
      const comp = t(card, 'span.boss-name').substring(0, 10);
      const tags = t(card, 'ul.tag-list');
      const active = !!card.querySelector('.job-card-wrap.active');
      const sub = submittedJobs.some(j => j.title.includes(title) || title.includes(j.title));
      const icons = [
        active ? '<span class="_ac">✅</span>' : '⬜',
        i === currentIdx ? '<span class="_cu">◀</span>' : '',
        sub ? '<span class="_sb">📤</span>' : '',
      ].filter(Boolean).join('');
      a(`  ${icons} [${i}] <b>${esc(title)}</b> | ${esc(comp)} <span class="_dim">${esc(tags)}</span>`);
    });
  } else {
    a('⚠ 未检测到职位，请确保在搜索结果页');
  }
  setOut(L.join('\n'));
}

function updateStats(): void {
  setVal('_cnt', String(jobItems.length));
  setVal('_sent', String(submittedJobs.length));
  setVal('_idx', jobItems.length > 0 ? String(currentIdx + 1) : '-');
  setVal('_st', currentState);
}

function nav(delta: number): void {
  if (jobItems.length === 0) { refresh(); return; }
  const ni = currentIdx + delta;
  if (ni < 0 || ni >= jobItems.length) return;
  currentIdx = ni;
  hlCard(currentIdx);
  updateStats();
  buildOutput();
}

function hlCard(idx: number): void {
  const card = jobItems[idx];
  if (!card) return;
  jobItems.forEach(e => { e.style.outline = ''; e.style.boxShadow = ''; });
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.outline = '3px solid #f5c2e7';
  card.style.boxShadow = '0 0 20px 4px rgba(245,194,231,0.5)';
  setOut([
    `📍 导航 [${idx + 1}/${jobItems.length}]`,
    `职位: <b>${esc(t(card, 'a.job-name'))}</b>`,
    `公司: <b>${esc(t(card, 'span.boss-name'))}</b>`,
    `地址: ${esc(t(card, 'span.company-location'))}`,
    `要求: ${esc(t(card, 'ul.tag-list'))}`,
  ].join('\n'));
}

// ============================================================
// 设置
// ============================================================

function slider(sid: string, vid: string, key: keyof SpeedSettings): void {
  const s = getEl(sid) as HTMLInputElement;
  const v = getEl(vid);
  s.addEventListener('input', () => {
    const val = parseInt(s.value);
    v.textContent = val + 'ms';
    (speed as any)[key] = val;
    applySpeed(speed);
  });
}

function syncSliders(): void {
  (getEl('_sHl') as HTMLInputElement).value = String(speed.highlightMs);
  getEl('_sHlV').textContent = speed.highlightMs + 'ms';
  (getEl('_sMin') as HTMLInputElement).value = String(speed.minWaitMs);
  getEl('_sMinV').textContent = speed.minWaitMs + 'ms';
  (getEl('_sMax') as HTMLInputElement).value = String(speed.maxWaitMs);
  getEl('_sMaxV').textContent = speed.maxWaitMs + 'ms';
  (getEl('_sTmo') as HTMLInputElement).value = String(speed.detailTimeoutMs);
  getEl('_sTmoV').textContent = speed.detailTimeoutMs + 'ms';
}

function preset(name: string): void {
  const p = SPEED_PRESETS[name];
  if (!p) return;
  speed = { ...p };
  applySpeed(speed);
  syncSliders();
  ['_preStable', '_preRec', '_preTurbo'].forEach(id => getEl(id).classList.remove('_sel'));
  getEl('_pre' + (name === 'recommend' ? 'Rec' : name.charAt(0).toUpperCase() + name.slice(1))).classList.add('_sel');
  getEl('_speedLabel').textContent = name === 'recommend' ? '推荐' : name === 'stable' ? '稳定' : '极速';
  setOut(`✅ 已切换「${getEl('_speedLabel').textContent}」速度`);
}

// ============================================================
// 自动化
// ============================================================

function start(): void {
  if (currentState !== AutomationState.IDLE && currentState !== AutomationState.STOPPED && currentState !== AutomationState.NO_MORE_JOBS) return;
  stopped = false; lastClickedJobText = ''; processedCount = 0; consecutiveErrors = 0;
  getEl('_badge').textContent = '运行中';
  refresh();
  transition(AutomationState.FIND_COMMUNICATE, 500);
}

function stop(): void {
  stopped = true;
  if (transitionTimerId !== null) { clearTimeout(transitionTimerId); transitionTimerId = null; }
  currentState = AutomationState.STOPPED;
  sendStatus(AutomationState.STOPPED);
  getEl('_badge').textContent = '已停止';
}

function transition(next: AutomationState, ms: number): void {
  if (stopped) { currentState = AutomationState.STOPPED; sendStatus(AutomationState.STOPPED); return; }
  if (transitionTimerId !== null) clearTimeout(transitionTimerId);
  transitionTimerId = setTimeout(() => { transitionTimerId = null; runState(next); }, ms);
}

async function runState(state: AutomationState): Promise<void> {
  if (stopped) { currentState = AutomationState.STOPPED; sendStatus(AutomationState.STOPPED); return; }
  currentState = state;
  sendStatus(state);
  updateStats();
  try {
    let next: AutomationState;
    switch (state) {
      case AutomationState.IDLE: next = AutomationState.IDLE; break;
      case AutomationState.STOPPED: next = AutomationState.IDLE; break;
      case AutomationState.NO_MORE_JOBS:
        getEl('_badge').textContent = '完成';
        setOut(`✅ 全部完成！共投递 <b>${submittedJobs.length}</b> 个职位`);
        next = AutomationState.NO_MORE_JOBS; break;
      case AutomationState.ERROR:
        consecutiveErrors++;
        next = consecutiveErrors >= CONFIG.MAX_ERROR_COUNT ? AutomationState.STOPPED : AutomationState.WAIT; break;
      case AutomationState.FIND_COMMUNICATE:
        next = findButtonByText('立即沟通') ? AutomationState.HIGHLIGHT_COMMUNICATE : AutomationState.FIND_NEXT_JOB; break;
      case AutomationState.HIGHLIGHT_COMMUNICATE: {
        const b = findButtonByText('立即沟通');
        if (!b) { next = AutomationState.FIND_NEXT_JOB; break; }
        b.scrollIntoView({ behavior: 'smooth', block: 'center' }); hlEl(b);
        next = AutomationState.CLICK_COMMUNICATE; break;
      }
      case AutomationState.CLICK_COMMUNICATE: {
        const b = findButtonByText('立即沟通');
        if (!b) { next = AutomationState.FIND_NEXT_JOB; break; }
        b.click(); next = AutomationState.CHECK_DIALOG; break;
      }
      case AutomationState.CHECK_DIALOG:
        await sleep(speed.dialogCheckMs);
        recordSubmit(findButtonByText('留在此页') ? '弹窗已处理' : '已沟通');
        next = findButtonByText('留在此页') ? AutomationState.HIGHLIGHT_DIALOG : (processedCount++, consecutiveErrors = 0, AutomationState.FIND_NEXT_JOB); break;
      case AutomationState.HIGHLIGHT_DIALOG: {
        const b = findButtonByText('留在此页');
        if (!b) { processedCount++; consecutiveErrors = 0; next = AutomationState.FIND_NEXT_JOB; break; }
        b.scrollIntoView({ behavior: 'smooth', block: 'center' }); hlEl(b);
        next = AutomationState.CLICK_DIALOG; break;
      }
      case AutomationState.CLICK_DIALOG: {
        const b = findButtonByText('留在此页');
        if (b) b.click();
        processedCount++; consecutiveErrors = 0;
        next = AutomationState.FIND_NEXT_JOB; break;
      }
      case AutomationState.FIND_NEXT_JOB: {
        const cards = getJobCards();
        if (cards.length === 0) { next = AutomationState.NO_MORE_JOBS; break; }
        const ai = findActiveIdx(cards);
        // 有选中且有下一个 → 点下一个
        if (ai >= 0 && ai < cards.length - 1) { next = AutomationState.HIGHLIGHT_JOB; break; }
        // 用文本指纹找
        if (lastClickedJobText && ai < 0) {
          const idx = findJobByText(cards, lastClickedJobText);
          if (idx >= 0 && idx < cards.length - 1) { next = AutomationState.HIGHLIGHT_JOB; break; }
        }
        // 首次
        if (!lastClickedJobText) { next = AutomationState.HIGHLIGHT_JOB; break; }
        // 没有下一个了 → 停止
        next = AutomationState.NO_MORE_JOBS; break;
      }
      case AutomationState.HIGHLIGHT_JOB: {
        const tgt = getTargetCard();
        if (!tgt) { lastClickedJobText = ''; next = AutomationState.FIND_NEXT_JOB; break; }
        tgt.scrollIntoView({ behavior: 'smooth', block: 'center' }); hlEl(tgt);
        next = AutomationState.CLICK_JOB; break;
      }
      case AutomationState.CLICK_JOB: {
        const tgt = getTargetCard();
        if (!tgt) { lastClickedJobText = ''; next = AutomationState.FIND_NEXT_JOB; break; }
        lastClickedJobText = (tgt.textContent || '').trim().substring(0, 60);
        const box = tgt.querySelector('li.job-card-box') as HTMLElement | null;
        (box || tgt).click();
        next = AutomationState.WAIT_DETAIL; break;
      }
      case AutomationState.WAIT_DETAIL: {
        const b = await waitFor(() => findButtonByText('立即沟通'), speed.detailTimeoutMs);
        next = b ? AutomationState.FIND_COMMUNICATE : AutomationState.WAIT; break;
      }
      default: next = AutomationState.WAIT;
    }
    if (stopped) return;
    const delay = (
      next === AutomationState.HIGHLIGHT_JOB || next === AutomationState.HIGHLIGHT_COMMUNICATE || next === AutomationState.HIGHLIGHT_DIALOG
    ) ? speed.highlightMs : next === AutomationState.WAIT ? randomWaitMs() : speed.minWaitMs;
    transition(next, delay);
  } catch (err) {
    log('error', `[${state}] ${String(err)}`);
    transition(AutomationState.ERROR, 1000);
  }
}

function getDelay(next: AutomationState): number {
  if (next === AutomationState.HIGHLIGHT_JOB || next === AutomationState.HIGHLIGHT_COMMUNICATE || next === AutomationState.HIGHLIGHT_DIALOG) return speed.highlightMs;
  if (next === AutomationState.WAIT) return randomWaitMs();
  return speed.minWaitMs;
}

// ============================================================
// 职位查询
// ============================================================

function getJobCards(): HTMLElement[] {
  const ul = document.querySelector('ul.rec-job-list') as HTMLElement | null;
  if (ul) return Array.from(ul.children).filter(c => c.tagName === 'DIV' && c.className.includes('card-area')) as HTMLElement[];
  for (const u of document.querySelectorAll('ul')) {
    const cards = Array.from(u.children).filter(c => c.tagName === 'DIV' && c.className.includes('card-area')) as HTMLElement[];
    if (cards.length >= 3) return cards;
  }
  return Array.from(document.querySelectorAll('div.card-area')) as HTMLElement[];
}

function findActiveIdx(cards: HTMLElement[]): number {
  return cards.findIndex(c => c.querySelector('.job-card-wrap.active') !== null);
}

function findJobByText(cards: HTMLElement[], text: string): number {
  const n = text.substring(0, 30).trim();
  if (!n) return -1;
  return cards.findIndex(c => (c.textContent || '').trim().substring(0, 60).includes(n));
}

function getTargetCard(): HTMLElement | null {
  const cards = getJobCards();
  if (cards.length === 0) return null;
  const ai = findActiveIdx(cards);
  if (ai >= 0 && ai < cards.length - 1) return cards[ai + 1];
  if (lastClickedJobText) { const i = findJobByText(cards, lastClickedJobText); if (i >= 0 && i < cards.length - 1) return cards[i + 1]; }
  return cards[0];
}

// ============================================================
// 投递记录
// ============================================================

function recordSubmit(status: string): void {
  const cards = getJobCards();
  let card: HTMLElement | null = null;
  const ai = findActiveIdx(cards);
  if (ai >= 0) card = cards[ai];
  else if (lastClickedJobText) { const i = findJobByText(cards, lastClickedJobText); if (i >= 0) card = cards[i]; }

  if (card) {
    submittedJobs.push({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      title: t(card, 'a.job-name'),
      company: t(card, 'span.boss-name'),
      location: t(card, 'span.company-location'),
      tags: t(card, 'ul.tag-list'),
      status,
    });
    updateStats();
    log('info', `📝 ${t(card, 'a.job-name')}`);
  }
}

// ============================================================
// 导出
// ============================================================

function exportJobs(): void {
  if (submittedJobs.length === 0) { setOut('⚠ 还没有投递记录'); return; }
  const lines = [
    '═══════════════════════════════════',
    '  BOSS直聘 投递记录',
    `  导出: ${new Date().toLocaleString('zh-CN')}`,
    `  共 ${submittedJobs.length} 个职位`,
    '═══════════════════════════════════', '',
  ];
  submittedJobs.forEach((j, i) => {
    lines.push(`【${i + 1}】${j.title}`);
    lines.push(`  公司: ${j.company}  地址: ${j.location}`);
    lines.push(`  要求: ${j.tags}  状态: ${j.status}  时间: ${j.time}`, '');
  });
  lines.push('═══════════════════════════════════');
  download(lines.join('\n'), `BOSS投递记录-${new Date().toISOString().slice(0, 10)}.txt`);
  setOut(`✅ 已导出 ${submittedJobs.length} 条记录`);
}

// ============================================================
// 点击检测
// ============================================================

function inspectElement(el: HTMLElement): void {
  const L: string[] = [];
  const a = (s: string) => L.push(s);
  a('══════════ 🔍 ══════════');
  a(`Tag: <b>${esc(el.tagName.toLowerCase())}</b>`);
  a(`Class: ${esc(el.className || '(无)')}`);
  const r = el.getBoundingClientRect();
  a(`Rect: (${R(r.left)},${R(r.top)}) ${R(r.width)}×${R(r.height)}`);
  a(`CSS: <code>${esc(cssPath(el))}</code>`);
  a(`Text: ${esc((el.textContent || '').trim().substring(0, 100))}`);
  a('── 祖先 ──');
  let cur: HTMLElement | null = el;
  for (let i = 0; i < 6 && cur; i++) {
    const rc = cur.getBoundingClientRect();
    a(`  L${i}: &lt;${esc(cur.tagName.toLowerCase())}&gt; "${esc((cur.className || '').substring(0, 40))}" @(${R(rc.left)},${R(rc.top)}) ${R(rc.width)}×${R(rc.height)}`);
    cur = cur.parentElement;
  }
  a('═══════════════════════');
  setOut(L.join('\n'));
}

// ============================================================
// DOM 工具
// ============================================================

function findButtonByText(text: string): HTMLElement | null {
  return (
    document.evaluate(`.//button[contains(text(),'${text}')]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as HTMLElement
  ) || (
    Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text)) as HTMLElement
  ) || (
    Array.from(document.querySelectorAll('[role="button"]')).find(b => b.textContent?.includes(text)) as HTMLElement
  ) || (
    Array.from(document.querySelectorAll('span, a')).find(b => b.textContent?.trim() === text) as HTMLElement
  ) || null;
}

function hlEl(el: HTMLElement): void {
  const o = el.style.outline, s = el.style.boxShadow, tr = el.style.transition;
  el.style.outline = '3px solid #f38ba8';
  el.style.boxShadow = '0 0 18px 5px rgba(243,139,168,0.6)';
  el.style.transition = 'outline .2s,box-shadow .2s';
  setTimeout(() => { el.style.outline = o; el.style.boxShadow = s; el.style.transition = tr; }, speed.highlightMs);
}

function waitFor<T>(fn: () => T | null, ms: number): Promise<T | null> {
  return new Promise(r => { const t0 = Date.now(); const c = () => { const v = fn(); if (v) r(v); else if (Date.now() - t0 >= ms) r(null); else setTimeout(c, 300); }; c(); });
}

function cssPath(el: HTMLElement): string {
  const p: string[] = [];
  let c: HTMLElement | null = el;
  while (c && c !== document.body && c !== document.documentElement) {
    let s = c.tagName.toLowerCase();
    if (c.id) { p.unshift('#' + c.id); break; }
    if (c.className && typeof c.className === 'string') {
      const cls = c.className.trim().split(/\s+/).filter(x => x && !x.includes(':')).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
    }
    const par = c.parentElement;
    if (par) {
      const sibs = Array.from(par.children).filter(x => x.tagName === c!.tagName);
      if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(c) + 1})`;
    }
    p.unshift(s); c = par;
  }
  return p.join(' > ');
}

function t(el: HTMLElement, sel: string): string { const e = el.querySelector(sel); return e ? (e.textContent || '').trim() : ''; }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// 工具
// ============================================================

function getEl(id: string): HTMLElement { return document.getElementById(id)!; }
function on(id: string, fn: () => void): void { getEl(id).addEventListener('click', fn); }
function setVal(id: string, text: string): void { const el = getEl(id); if (el) el.textContent = text; }
function setOut(html: string): void { const el = getEl('_output'); if (el) el.innerHTML = html.replace(/\n/g, '<br>'); }
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function R(n: number): string { return Math.round(n).toString(); }

function download(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function sendStatus(state: AutomationState): void {
  updateStats();
  chrome.runtime.sendMessage({ type: 'STATUS', state, processedCount } satisfies StatusMessage).catch(() => {});
}

function log(level: 'info' | 'warn' | 'error', msg: string): void {
  const m = `[BOSS] ${msg}`;
  switch (level) { case 'warn': console.warn(m); break; case 'error': console.error(m); break; default: console.log(m); break; }
  chrome.runtime.sendMessage({ type: 'LOG', level, message: msg } satisfies LogMessage).catch(() => {});
}

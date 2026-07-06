/**
 * BOSS自动投递 - Content Script v9
 *
 * v9: 开始/停止集成到面板 + 丝滑ETA倒计时 + 刷新按钮
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
// 中文状态
// ============================================================
const SCN: Record<string, string> = {
  IDLE: '就绪', FIND_NEXT_JOB: '查找职位', HIGHLIGHT_JOB: '高亮职位', CLICK_JOB: '点击职位',
  WAIT_DETAIL: '等待详情', FIND_COMMUNICATE: '查找沟通', HIGHLIGHT_COMMUNICATE: '高亮沟通',
  CLICK_COMMUNICATE: '点击沟通', CHECK_DIALOG: '检查弹窗', HIGHLIGHT_DIALOG: '高亮弹窗',
  CLICK_DIALOG: '点击弹窗', WAIT: '等待中', STOPPED: '已停止', ERROR: '错误',
  NO_MORE_JOBS: '全部完成',
};
const IDLE_SET = new Set([AutomationState.IDLE, AutomationState.STOPPED, AutomationState.NO_MORE_JOBS]);

// ============================================================
// 全局
// ============================================================
let currentState: AutomationState = AutomationState.IDLE;
let stopped = false;
let lastClickedJobText = '';
let processedCount = 0;
let consecutiveErrors = 0;
let transitionTimerId: ReturnType<typeof setTimeout> | null = null;

let pnl: HTMLElement | null = null;
let jobItems: HTMLElement[] = [];
let curIdx = 0;
let inspectOn = false, cfgOpen = false, folded = false, userNav = false, blockOn = false;

// 关键词屏蔽
let blockKeywords: string[] = [];
let skippedCount = 0;
const skippedTexts = new Set<string>();

// 精选模式 —— DOM 层过滤 + 工作制高亮
let filterMode = false;
let filterObserver: MutationObserver | null = null;
let filterStyleEl: HTMLStyleElement | null = null;
let filteredJobs: { title: string; company: string }[] = [];
let fHideListOpen = false;

// 拖动
let drag = false, dx = 0, dy = 0, px = 0, py = 0;

// 投递记录
interface Sub { time: string; title: string; company: string; location: string; tags: string; status: string; }
const subs: Sub[] = [];

// 计时
let startTime = 0;
let etaTotalMs = 0;       // 预估总耗时（8秒×职位数）
let etaTimer: ReturnType<typeof setInterval> | null = null;

let spd: SpeedSettings = { ...SPEED_PRESETS.recommend };
applySpeed(spd);
let speedPreset = 'recommend';

// ============================================================
// 持久化 (chrome.storage.local)
// ============================================================

async function saveSettings(): Promise<void> {
  try {
    await chrome.storage.local.set({
      speed: spd,
      speedPreset,
      blockKeywords,
      blockOn,
      filterMode,
    });
  } catch { /* */ }
}

async function loadSettings(): Promise<void> {
  try {
    const r = await chrome.storage.local.get(['speed', 'speedPreset', 'blockKeywords', 'blockOn', 'panelVisible', 'filterMode']);
    if (r.speed) { spd = r.speed; applySpeed(spd); }
    if (r.speedPreset) speedPreset = r.speedPreset;
    if (r.blockKeywords) { blockKeywords = r.blockKeywords; blockOn = r.blockOn === true; }
    // 精选模式恢复
    if (r.filterMode === true) {
      filterMode = true;
      showFilterPanel();
      setTimeout(() => { applyFilterToDOM(); startFilterObserver(); startDetailObserver(); }, 1000);
    }
    // 面板显隐
    if (r.panelVisible === false && pnl) {
      pnl.style.display = 'none';
    }
  } catch { /* */ }
}

// ============================================================
// 初始化
// ============================================================

let panelVisible = true;
let initTried = 0;

// 先从存储加载设置
loadSettings().then(() => {
  // 面板可见性
  chrome.storage.local.get('panelVisible').then(r => {
    if (r.panelVisible === false) panelVisible = false;
  });
});

function tryInit(): void {
  initTried++;
  if (pnl) return;
  if (document.readyState === 'loading') { setTimeout(tryInit, 800); return; }
  const cards = getJobCards();
  if (cards.length === 0 && initTried < 6) { setTimeout(tryInit, 1000); return; }
  try {
    buildPanel();
    syncSlidersUI();
    // 恢复持久化的预设按钮高亮
    if (speedPreset) {
      ['__pre_s__','__pre_r__','__pre_t__'].forEach(id => $(id).classList.remove('_on'));
      const map: Record<string, string> = { stable: '__pre_s__', recommend: '__pre_r__', turbo: '__pre_t__' };
      const labels: Record<string, string> = { stable: '稳定', recommend: '推荐', turbo: '极速' };
      if (map[speedPreset]) { $(map[speedPreset]).classList.add('_on'); setText('__spdlbl__', labels[speedPreset] || '推荐'); }
    }
    // 恢复持久化的屏蔽词到输入框
    if (blockKeywords.length > 0) {
      $<HTMLInputElement>('__blkin__').value = blockKeywords.join(',');
      if (blockOn) { $('__blkpnl__').classList.add('on'); $<HTMLButtonElement>('__block__').textContent = '🚫 ON'; $<HTMLButtonElement>('__block__').className = '_nd'; }
    }
    refreshBlockTags();
    refreshPanel();
  } catch (e) { if (initTried < 10) setTimeout(tryInit, 1500); }
}
setTimeout(tryInit, 1000);
window.addEventListener('load', () => setTimeout(tryInit, 1500));

chrome.runtime.onMessage.addListener((message: CommandMessage) => {
  if (message.type !== 'COMMAND') return;
  if (message.command === 'START') start();
  else if (message.command === 'STOP') stop();
  else if (message.command === 'GET_STATUS') sendStatus(currentState);
  else if (message.command === 'TOGGLE_PANEL') {
    chrome.storage.local.get('panelVisible').then(r => {
      panelVisible = r.panelVisible !== false;
      if (pnl) pnl.style.display = panelVisible ? '' : 'none';
    });
  }
  else if (message.command === 'TOGGLE_FILTER') {
    chrome.storage.local.get('filterMode').then(r => {
      filterMode = r.filterMode === true;
      if (filterMode) {
        showFilterPanel(); applyFilterToDOM(); startFilterObserver(); startDetailObserver();
      } else {
        hideFilterPanel(); removeFilterFromDOM(); stopFilterObserver(); stopDetailObserver();
      }
    });
  }
});

document.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const target = fPnl && fPnl.style.transition === 'none' ? fPnl : (pnl || fPnl);
  if (!target) return;
  target.style.left = Math.max(0, Math.min(px + e.clientX - dx, innerWidth - target.offsetWidth)) + 'px';
  target.style.top = Math.max(0, Math.min(py + e.clientY - dy, innerHeight - 60)) + 'px';
});
document.addEventListener('mouseup', () => { drag = false; });
document.addEventListener('click', (e) => {
  if (!inspectOn) return;
  // 跳过面板内的按钮点击，否则 inspect 无法关闭
  if ((e.target as HTMLElement).closest('#_b_')) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  doInspect(e.target as HTMLElement);
}, true);

// ============================================================
// CSS & HTML
// ============================================================

const CSS = `
#_b_{position:fixed;top:80px;right:16px;width:360px;background:#1a1a2e;color:#cdd6f4;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.55);z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:12px;user-select:none;display:flex;flex-direction:column;max-height:calc(100vh - 100px);}
#_b_ ._h{cursor:move;background:linear-gradient(135deg,#2d2d44,#252540);padding:10px 14px;display:flex;align-items:center;gap:8px;border-radius:14px 14px 0 0;flex-shrink:0;}
#_b_ ._hh{color:#e2a4f5;font-weight:700;font-size:13px;flex:1;}
#_b_ ._hb{font-size:10px;background:#3a3a55;color:#a6adc8;padding:2px 8px;border-radius:10px;}
#_b_ ._h button{width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:#a6adc8;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
#_b_ ._h button:hover{background:#3a3a55;color:#fff;}
#_b_ ._s{display:flex;border-bottom:1px solid #2a2a44;flex-shrink:0;}
#_b_ ._si{flex:1;text-align:center;padding:8px 2px;border-right:1px solid #2a2a44;}
#_b_ ._si:last-child{border-right:none;}
#_b_ ._sv{font-size:16px;font-weight:700;}
#_b_ ._sl{font-size:9px;color:#78789e;margin-top:1px;}
#_b_ ._bt{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #2a2a44;flex-shrink:0;}
#_b_ ._bt button{flex:1;padding:7px 0;border:1px solid #3a3a55;border-radius:7px;background:#22223a;color:#cdd6f4;font-size:11px;cursor:pointer;}
#_b_ ._bt button:hover{background:#2d2d48;}
#_b_ ._cfg{display:none;padding:10px 14px;border-bottom:1px solid #2a2a44;background:#1e1e34;flex-shrink:0;}
#_b_ ._cfg.on{display:block;}
#_b_ ._cgt{font-size:11px;font-weight:600;color:#78789e;margin-bottom:8px;}
#_b_ ._cgr{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
#_b_ ._cgr label{width:55px;font-size:11px;color:#a6adc8;flex-shrink:0;text-align:right;}
#_b_ ._cgr input[type=range]{flex:1;accent-color:#89b4fa;height:4px;}
#_b_ ._cgr span{width:65px;font-size:11px;color:#a6e3a1;flex-shrink:0;}
#_b_ ._cgp{display:flex;gap:6px;margin-top:8px;}
#_b_ ._cgp button{flex:1;padding:6px 0;border-radius:6px;border:1px solid #3a3a55;background:#22223a;color:#cdd6f4;font-size:11px;cursor:pointer;}
#_b_ ._cgp button:hover{background:#2d2d48;}
#_b_ ._cgp ._on{border-color:#89b4fa;color:#89b4fa;font-weight:600;}
#_b_ ._out{flex:1;overflow-y:auto;padding:10px 14px;font-size:11px;line-height:1.6;color:#b4b8d0;min-height:60px;max-height:240px;}
#_b_ ._out b{color:#e2a4f5;}
#_b_ ._out ._d{color:#585b70;}
#_b_ ._out ._g{color:#a6e3a1;}
#_b_ ._out ._y{color:#f9e2af;}
#_b_ ._out ._r{color:#f38ba8;}
#_b_ ._out::-webkit-scrollbar{width:4px;}
#_b_ ._out::-webkit-scrollbar-thumb{background:#3a3a55;border-radius:2px;}
._go{background:#a6e3a1!important;color:#1a1a2e!important;border-color:#a6e3a1!important;font-weight:700;font-size:14px!important;letter-spacing:2px;}
._sp{background:#f38ba8!important;color:#1a1a2e!important;border-color:#f38ba8!important;font-weight:700;font-size:14px!important;letter-spacing:2px;}
._na{background:#89b4fa!important;color:#1a1a2e!important;border-color:#89b4fa!important;font-weight:600;}
._nn{background:#a6e3a1!important;color:#1a1a2e!important;border-color:#a6e3a1!important;font-weight:600;}
._nd{background:#f38ba8!important;color:#1a1a2e!important;border-color:#f38ba8!important;}
._nx{background:#a6e3a1!important;color:#1a1a2e!important;border-color:#a6e3a1!important;font-weight:700;}
	._bk{display:none;padding:8px 12px;border-bottom:1px solid #2a2a44;background:#1e1e34;flex-shrink:0;}
	._bk.on{display:flex;flex-direction:column;gap:6px;}
	._bk input{flex:1;padding:6px 10px;border:1px solid #3a3a55;border-radius:6px;background:#22223a;color:#cdd6f4;font-size:11px;outline:none;}
	._bk input:focus{border-color:#89b4fa;}
	._bk ._kw{display:flex;flex-wrap:wrap;gap:4px;}
	._bk ._kt{font-size:10px;background:#f38ba8;color:#1a1a2e;padding:2px 8px;border-radius:10px;cursor:pointer;}
	._bk ._kt:hover{background:#e06c75;}
	._bk ._kh{font-size:10px;color:#78789e;}
`;

const HTML = `
<div class="_h" id="__h__">
  <span>≡</span><span class="_hh">BOSS 自动投递 v9</span>
  <span class="_hb" id="__badge__">就绪</span>
  <button id="__cfg__" title="设置">⚙</button>
  <button id="__fold__" title="折叠">─</button>
</div>
<div class="_s" id="__stats__">
  <div class="_si"><div class="_sv" style="color:#a6e3a1" id="__cnt__">-/ -</div><div class="_sl">进度</div></div>
  <div class="_si"><div class="_sv" style="color:#f5c2e7" id="__sent__">0</div><div class="_sl">已投</div></div>
  <div class="_si"><div class="_sv" style="color:#89b4fa" id="__eta__">-</div><div class="_sl">预计剩余</div></div>
  <div class="_si"><div class="_sv" style="color:#f38ba8;font-size:11px" id="__st__">就绪</div><div class="_sl">状态</div></div>
</div>
<div class="_bt">
  <button class="_go" id="__toggle__">▶ 开 始</button>
</div>
<div class="_bt">
  <button class="_na" id="__prev__" style="flex:.6;font-size:16px;">◀</button>
  <button class="_nn" id="__next__" style="flex:.6;font-size:16px;">▶</button>
  <button id="__insp__">🎯 OFF</button>
  <button id="__refresh__">🔄 刷新</button>
	  <button id="__block__">🚫 OFF</button>
  <button class="_nx" id="__export__">📥 导出</button>
</div>
<div class="_bk" id="__blkpnl__">
	  <input type="text" id="__blkin__" placeholder="输入关键词，逗号分隔，如：Unity3D,U3D,Java">
	  <div class="_kw" id="__blktags__"><span class="_kh">屏蔽词（点击标签删除）</span></div>
	</div>
	<div class="_cfg" id="__cfgpnl__">
  <div class="_cgt">⚙ 速度设置 (<span id="__spdlbl__">推荐</span>)</div>
  <div class="_cgr"><label>高亮</label><input type="range" id="__hl__" min="100" max="2000" step="50"><span id="__hlv__">350ms</span></div>
  <div class="_cgr"><label>步间最小</label><input type="range" id="__minw__" min="200" max="3000" step="100"><span id="__minwv__">800ms</span></div>
  <div class="_cgr"><label>步间最大</label><input type="range" id="__maxw__" min="500" max="5000" step="100"><span id="__maxwv__">1500ms</span></div>
  <div class="_cgr"><label>加载超时</label><input type="range" id="__tmo__" min="1500" max="8000" step="100"><span id="__tmov__">4000ms</span></div>
  <div class="_cgp">
    <button id="__pre_s__">🐢 稳定</button>
    <button class="_on" id="__pre_r__">⚡ 推荐</button>
    <button id="__pre_t__">🚀 极速</button>
  </div>
</div>
<div class="_out" id="__out__">加载中...</div>`;

function buildPanel(): void {
  if (document.getElementById('_b_')) return;
  const el = document.createElement('div');
  el.id = '_b_';
  el.innerHTML = `<style>${CSS}</style>${HTML}`;
  document.body.appendChild(el);
  pnl = el;
  // 应用持久化的面板显隐
  chrome.storage.local.get('panelVisible').then(r => {
    if (r.panelVisible === false) { pnl!.style.display = 'none'; panelVisible = false; }
  });

  $('__h__').addEventListener('mousedown', (e) => {
    const me = e as MouseEvent;
    if ((me.target as HTMLElement).tagName === 'BUTTON') return;
    drag = true; dx = me.clientX; dy = me.clientY;
    const r = pnl!.getBoundingClientRect();
    px = r.left; py = r.top; pnl!.style.transition = 'none';
  });

  click('__toggle__', () => {
    if (IDLE_SET.has(currentState)) start();
    else stop();
  });
  click('__prev__', () => { userNav = true; navPanel(-1); });
  click('__next__', () => { userNav = true; navPanel(1); });
  click('__refresh__', () => { out('🔄 刷新中...'); setTimeout(refreshPanel, 200); });
  click('__insp__', () => {
    inspectOn = !inspectOn;
    const b = $<HTMLButtonElement>('__insp__');
    b.textContent = inspectOn ? '🎯 ON' : '🎯 OFF';
    b.className = inspectOn ? '_nd' : '';
    if (inspectOn) out('✅ 点击检测 ON');
  });
  click('__export__', doExport);
  // block 相关（包 try-catch 防加载卡死）
  try {
    click('__block__', () => {
      blockOn = !blockOn;
      const b = $<HTMLButtonElement>('__block__');
      b.textContent = blockOn ? '🚫 ON' : '🚫 OFF';
      b.className = blockOn ? '_nd' : '';
      $('__blkpnl__').classList.toggle('on', blockOn);
      if (blockOn) { applyBlockKeywords(); refreshPanel(); }
      else { blockKeywords = []; skippedCount = 0; skippedTexts.clear(); refreshBlockTags(); refreshPanel(); saveSettings(); }
    });
    const blkIn = $<HTMLInputElement>('__blkin__');
    if (blkIn) {
      // 输入即生效，无需等回车或失焦
      blkIn.addEventListener('input', () => { applyBlockKeywords(); refreshPanel(); if (filterMode) { applyFilterToDOM(); refreshFilterPanel(); } });
    }
  } catch { /* 面板主功能不受影响 */ }
  click('__cfg__', () => { cfgOpen = !cfgOpen; $('__cfgpnl__').classList.toggle('on', cfgOpen); });
  click('__fold__', () => {
    folded = !folded;
    ['__stats__','__nav__','__ctrl__','__blkpnl__','__cfgpnl__','__out__'].forEach(id => {
      const el2 = document.getElementById(id); if (el2) el2.style.display = folded ? 'none' : '';
    });
    $<HTMLButtonElement>('__fold__').textContent = folded ? '□' : '─';
  });

  slider('__hl__', '__hlv__', 'highlightMs');
  slider('__minw__', '__minwv__', 'minWaitMs');
  slider('__maxw__', '__maxwv__', 'maxWaitMs');
  slider('__tmo__', '__tmov__', 'detailTimeoutMs');

  click('__pre_s__', () => preset('stable'));
  click('__pre_r__', () => preset('recommend'));
  click('__pre_t__', () => preset('turbo'));

  syncSlidersUI();
}

// ============================================================
// 面板刷新
// ============================================================

function refreshPanel(): void {
  const allCards = getJobCards();
  // 屏蔽模式下过滤掉匹配的职位，列表里不显示
  jobItems = (blockOn && blockKeywords.length > 0)
    ? allCards.filter(c => !isBlocked(c))
    : allCards;
  const ai = findActiveIdx(jobItems);
  if (!userNav && ai >= 0) curIdx = ai;

  const total = jobItems.length;
  const done = subs.length;

  setText('__cnt__', `${done}/${total}`);
  setText('__sent__', String(done));
  setText('__st__', SCN[currentState] || currentState);

  const L: string[] = [];
  const blkTxt = blockOn ? ` | 🚫屏蔽 <b class="_y">${blockKeywords.length > 0 ? blockKeywords.join(',') : '关'}</b>` : '';
  L.push(`📋 <b>${total}</b> 个职位 | 已投 <b class="_r">${done}</b> | 剩余 <b>${Math.max(0, total - done)}</b>${blkTxt} | ${SCN[currentState] || currentState}`);
  L.push('');

  if (total > 0) {
    jobItems.forEach((card, i) => {
      const title = txt(card, 'a.job-name').substring(0, 22);
      const comp = txt(card, 'span.boss-name').substring(0, 10);
      const tags = txt(card, 'ul.tag-list');
      const active = !!card.querySelector('.job-card-wrap.active');
      const sub = subs.some(j => j.title.includes(title) || title.includes(j.title));
      const icons = [
        active ? '<span class="_g">✅</span>' : '⬜',
        i === curIdx ? '<span class="_y">◀</span>' : '',
        sub ? '<span class="_r">📤</span>' : '',
      ].filter(Boolean).join('');
      L.push(`  ${icons} [${i}] <b>${esc(title)}</b> | ${esc(comp)} <span class="_d">${esc(tags)}</span>`);
    });
    if (!userNav || curIdx < total) hlCard(curIdx);
  } else {
    L.push('⚠ 未检测到职位');
  }

  out(L.join('\n'));
}

function navPanel(delta: number): void {
  if (jobItems.length === 0) { out('⚠ 未检测到职位'); return; }
  const ni = curIdx + delta;
  if (ni < 0 || ni >= jobItems.length) { out(`⚠ 已是第${delta > 0 ? '最后' : '一'}个`); return; }
  curIdx = ni;
  jobItems.forEach(e => { e.style.outline = ''; e.style.boxShadow = ''; });
  const card = jobItems[curIdx];
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.outline = '3px solid #f5c2e7';
  card.style.boxShadow = '0 0 20px 4px rgba(245,194,231,0.5)';
  setText('__cnt__', `${subs.length}/${jobItems.length}`);
  out(`📍 [${curIdx + 1}/${jobItems.length}] <b>${esc(txt(card, 'a.job-name'))}</b>\n${esc(txt(card, 'span.boss-name'))} | ${esc(txt(card, 'span.company-location'))}`);
}

function hlCard(idx: number): void {
  const card = jobItems[idx];
  if (!card) return;
  jobItems.forEach(e => { e.style.outline = ''; e.style.boxShadow = ''; });
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.outline = '3px solid #f5c2e7';
  card.style.boxShadow = '0 0 20px 4px rgba(245,194,231,0.5)';
}

// ============================================================
// 关键词屏蔽
// ============================================================

function applyBlockKeywords(): void {
  const raw = $<HTMLInputElement>('__blkin__').value.trim();
  blockKeywords = raw ? raw.split(/[,，\s]+/).filter(Boolean).map(k => k.toLowerCase()) : [];
  refreshBlockTags();
  saveSettings();
}

function refreshBlockTags(): void {
  const container = $('__blktags__');
  if (!container) return;
  if (blockKeywords.length === 0) {
    container.innerHTML = '<span class="_kh">屏蔽词（输入后按回车）</span>';
  } else {
    container.innerHTML = blockKeywords.map(k =>
      `<span class="_kt" data-kw="${esc(k)}" title="点击删除">🚫 ${esc(k)}</span>`
    ).join(' ');
    // 点击标签删除
    container.querySelectorAll('._kt').forEach(el => {
      el.addEventListener('click', () => {
        const kw = el.getAttribute('data-kw') || '';
        blockKeywords = blockKeywords.filter(k => k !== kw);
        $<HTMLInputElement>('__blkin__').value = blockKeywords.join(',');
        saveSettings();
        refreshBlockTags();
        refreshPanel();
        if (filterMode) { applyFilterToDOM(); refreshFilterPanel(); }
      });
    });
  }
}

function isBlocked(card: HTMLElement): boolean {
  if (!blockOn || blockKeywords.length === 0) return false;
  const title = txt(card, 'a.job-name').toLowerCase();
  return blockKeywords.some(kw => title.includes(kw));
}

// ============================================================
// 精选模式 —— DOM 过滤 + 工作制高亮 + 详情检测 + 独立面板
// ============================================================

type ScheduleType = '双休' | '大小周' | '单休' | '朝九晚五' | '朝九晚六' | '上班时间' | '工作时间';
// 详情 p.desc 关键词（优先级从高到低）
const DETAIL_KW: [string, ScheduleType][] = [
  ['单休', '单休'], ['大小周', '大小周'], ['双休', '双休'],
  ['朝九晚五', '朝九晚五'], ['朝九晚六', '朝九晚六'],
  ['上班时间', '上班时间'], ['工作时间', '工作时间'],
];
// 已扫描的 schedule 缓存（title → ScheduleType）
const scheduleCache = new Map<string, ScheduleType>();

// 精选模式统计
let filterHiddenCount = 0;
let schedCounts: Record<ScheduleType | '未匹配', number> = { 双休: 0, 大小周: 0, 单休: 0, 朝九晚五: 0, 朝九晚六: 0, 上班时间: 0, 工作时间: 0, 未匹配: 0 };

// 详情面板 observer
let detailObserver: MutationObserver | null = null;

function matchesBlockKeywords(card: HTMLElement): boolean {
  if (blockKeywords.length === 0) return false;
  const title = txt(card, 'a.job-name').toLowerCase();
  return blockKeywords.some(kw => title.includes(kw));
}

function getScheduleType(card: HTMLElement): ScheduleType | null {
  const text = card.textContent || '';
  if (text.includes('单休')) return '单休';
  if (text.includes('大小周')) return '大小周';
  if (text.includes('双休')) return '双休';
  if (text.includes('朝九晚五')) return '朝九晚五';
  if (text.includes('朝九晚六')) return '朝九晚六';
  if (text.includes('上班时间')) return '上班时间';
  if (text.includes('工作时间')) return '工作时间';
  return null;
}

function parseDetailSchedule(descText: string): ScheduleType | null {
  for (const [kw, type] of DETAIL_KW) {
    if (descText.includes(kw)) return type;
  }
  return null;
}

function injectCardBadge(card: HTMLElement, sched: ScheduleType | '未匹配'): void {
  // 移除旧 badge
  card.querySelectorAll('.__boss_sched__').forEach(e => e.remove());
  const badge = document.createElement('span');
  badge.className = '__boss_sched__';
  const colors: Record<string, [string, string]> = {
    双休: ['#28a745', '#d4edda'], 大小周: ['#ffc107', '#fff3cd'],
    单休: ['#dc3545', '#f8d7da'], 朝九晚五: ['#4a90d9', '#dbeafe'],
    朝九晚六: ['#4a90d9', '#dbeafe'], 上班时间: ['#f59e0b', '#fef3c7'],
    工作时间: ['#f59e0b', '#fef3c7'], 未匹配: ['#9ca3af', '#f3f4f6'],
  };
  const [border, bg] = colors[sched] || ['#9ca3af', '#f3f4f6'];
  Object.assign(badge.style, {
    display: 'inline-block', padding: '1px 6px', borderRadius: '2px',
    fontSize: '10px', fontWeight: '700', marginRight: '6px',
    borderLeft: `2px solid ${border}`, background: bg, color: border,
    verticalAlign: 'middle', flexShrink: '0',
  });
  badge.textContent = sched;
  // 插入到卡片最前面
  const wrap = card.querySelector('.job-card-wrap') || card.querySelector('.job-card-box') || card;
  wrap.insertBefore(badge, wrap.firstChild);
}

function applyFilterToCard(card: HTMLElement): void {
  if (matchesBlockKeywords(card)) {
    card.style.display = 'none';
    card.setAttribute('__boss_filtered__', '');
    return;
  }
  card.style.display = '';
  card.removeAttribute('__boss_filtered__');
  // 优先用缓存，其次卡片内文本
  const title = txt(card, 'a.job-name');
  const cached = scheduleCache.get(title);
  if (cached) { injectCardBadge(card, cached); return; }
  const sched = getScheduleType(card);
  if (sched) {
    scheduleCache.set(title, sched);
    injectCardBadge(card, sched);
  } else {
    injectCardBadge(card, '未匹配');
  }
}

function applyFilterToDOM(): void {
  const cards = getJobCards();
  schedCounts = { 双休: 0, 大小周: 0, 单休: 0, 朝九晚五: 0, 朝九晚六: 0, 上班时间: 0, 工作时间: 0, 未匹配: 0 };
  filterHiddenCount = 0;
  filteredJobs = [];
  for (const card of cards) {
    if (matchesBlockKeywords(card)) {
      filterHiddenCount++;
      filteredJobs.push({
        title: txt(card, 'a.job-name').substring(0, 30),
        company: txt(card, 'span.boss-name').substring(0, 15),
      });
    }
    applyFilterToCard(card);
    const title = txt(card, 'a.job-name');
    const s = scheduleCache.get(title) || getScheduleType(card);
    if (s) { schedCounts[s]++; scheduleCache.set(title, s); }
    else { schedCounts['未匹配']++; }
  }
  refreshFilterPanel();
}

function removeFilterFromDOM(): void {
  document.querySelectorAll('[__boss_filtered__]').forEach(c => {
    (c as HTMLElement).style.display = '';
    c.removeAttribute('__boss_filtered__');
  });
  document.querySelectorAll('.__boss_sched__').forEach(c => c.remove());
  filterHiddenCount = 0;
  schedCounts = { 双休: 0, 大小周: 0, 单休: 0, 朝九晚五: 0, 朝九晚六: 0, 上班时间: 0, 工作时间: 0, 未匹配: 0 };
  refreshFilterPanel();
}

function startFilterObserver(): void {
  if (filterObserver) return;
  filterObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains('card-area')) applyFilterToCard(node);
        else {
          const cards = node.querySelectorAll?.('div.card-area');
          cards?.forEach(c => applyFilterToCard(c as HTMLElement));
        }
      }
    }
  });
  const listEl = document.querySelector('ul.rec-job-list');
  if (listEl) filterObserver.observe(listEl, { childList: true, subtree: false });
  else filterObserver.observe(document.body, { childList: true, subtree: true });
}

function stopFilterObserver(): void {
  if (filterObserver) { filterObserver.disconnect(); filterObserver = null; }
}

// 详情面板 observer —— 点击职位后检测 p.desc 的工作制信息
function startDetailObserver(): void {
  if (detailObserver) return;
  detailObserver = new MutationObserver(() => {
    const descEl = document.querySelector('.job-detail-body p.desc, .job-detail-container p.desc');
    if (!descEl || !descEl.textContent) return;
    const descText = descEl.textContent;
    const detailSched = parseDetailSchedule(descText);
    // 找到当前选中的卡片
    const activeCard = document.querySelector('.job-card-wrap.active')?.closest('.card-area') as HTMLElement | null;
    if (!activeCard) return;
    const title = txt(activeCard, 'a.job-name');
    if (!title) return;
    const oldCached = scheduleCache.get(title);
    if (detailSched && oldCached !== detailSched) {
      scheduleCache.set(title, detailSched);
      injectCardBadge(activeCard, detailSched);
      schedCounts[detailSched] = (schedCounts[detailSched] || 0) + 1;
      if (oldCached) schedCounts[oldCached] = Math.max(0, (schedCounts[oldCached] || 1) - 1);
      refreshFilterPanel();
    } else if (!detailSched && !oldCached) {
      // 详情也未找到 → 保持未匹配
    }
  });
  const detailContainer = document.querySelector('.job-detail-container');
  if (detailContainer) {
    detailObserver.observe(detailContainer, { childList: true, subtree: true });
  } else {
    // 等容器出现
    const bodyObs = new MutationObserver(() => {
      const dc = document.querySelector('.job-detail-container');
      if (dc && detailObserver) { detailObserver.observe(dc, { childList: true, subtree: true }); bodyObs.disconnect(); }
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => bodyObs.disconnect(), 15000);
  }
}

function stopDetailObserver(): void {
  if (detailObserver) { detailObserver.disconnect(); detailObserver = null; }
}

// ============================================================
// 精选模式面板 (#_f_)
// ============================================================

const FILTER_CSS = `
#_f_{position:fixed;top:80px;right:392px;width:280px;background:#1a1a2e;color:#cdd6f4;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.55);z-index:2147483646;font-family:system-ui,-apple-system,sans-serif;font-size:12px;user-select:none;display:flex;flex-direction:column;}
#_f_ ._fh{cursor:move;background:linear-gradient(135deg,#1e3a3a,#253530);padding:10px 14px;display:flex;align-items:center;gap:8px;border-radius:14px 14px 0 0;flex-shrink:0;}
#_f_ ._fhh{color:#a6e3a1;font-weight:700;font-size:13px;flex:1;}
#_f_ ._fhb{font-size:10px;background:#3a5545;color:#a6e3a1;padding:2px 8px;border-radius:10px;}
#_f_ ._fs{padding:10px 14px;border-bottom:1px solid #2a2a44;flex-shrink:0;font-size:11px;line-height:1.6;}
#_f_ ._fs ._fl{display:flex;justify-content:space-between;padding:2px 0;}
#_f_ ._fs ._flc{font-weight:600;}
#_f_ ._fs ._fd{color:#78789e;}
#_f_ ._fb{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #2a2a44;flex-shrink:0;}
#_f_ ._fb button{flex:1;padding:6px 0;border:1px solid #3a3a55;border-radius:7px;background:#22223a;color:#cdd6f4;font-size:11px;cursor:pointer;}
#_f_ ._fb button:hover{background:#2d2d48;}
#_f_ ._fhlist{font-size:10px;line-height:1.6;color:#a6adc8;padding:4px 0;}
#_f_ ._fhlist ._hi{padding:2px 0;border-bottom:1px solid #1e1e34;display:flex;justify-content:space-between;}
#_f_ ._fhlist ._hi:last-child{border-bottom:none}
#_f_ ._fhlist ._hit{color:#cdd6f4}
#_f_ ._fhlist ._hic{color:#78789e}
`;

const FILTER_HTML = `
<div class="_fh" id="__fh__">
  <span>🔍</span><span class="_fhh">精选模式</span>
  <span class="_fhb" id="__fbadge__">OFF</span>
</div>
<div class="_fs" id="__fstats__">
  <div class="_fl"><span class="_fd">屏蔽词</span><span id="__fkw__">-</span></div>
  <div class="_fl" id="__fhidrow__" style="cursor:pointer"><span class="_fd">已隐藏</span><span class="_flc" id="__fhid__" style="color:#f38ba8">0  ▸</span></div>
  <div class="_fhlist" id="__fhlist__" style="display:none;max-height:150px;overflow-y:auto;margin:4px 0"></div>
  <div class="_fl"><span class="_fd">🟢 双休</span><span class="_flc" style="color:#28a745" id="__fc_shuang__">0</span></div>
  <div class="_fl"><span class="_fd">🟡 大小周</span><span class="_flc" style="color:#ffc107" id="__fc_dxzhou__">0</span></div>
  <div class="_fl"><span class="_fd">🔴 单休</span><span class="_flc" style="color:#dc3545" id="__fc_danxiu__">0</span></div>
  <div class="_fl"><span class="_fd">🔵 朝九晚五/六</span><span class="_flc" style="color:#4a90d9" id="__fc_9to5__">0</span></div>
  <div class="_fl"><span class="_fd">🟠 有工作时间</span><span class="_flc" style="color:#f59e0b" id="__fc_worktime__">0</span></div>
  <div class="_fl"><span class="_fd">⬜ 未匹配</span><span class="_flc" style="color:#9ca3af" id="__fc_none__">0</span></div>
</div>
<div class="_fb">
  <button id="__fscan__">🔄 重新扫描</button>
</div>
`;

let fPnl: HTMLElement | null = null;

function buildFilterPanel(): void {
  if (document.getElementById('_f_')) return;
  const el = document.createElement('div');
  el.id = '_f_';
  el.innerHTML = `<style>${FILTER_CSS}</style>${FILTER_HTML}`;
  document.body.appendChild(el);
  fPnl = el;

  $('__fh__').addEventListener('mousedown', (e) => {
    const me = e as MouseEvent;
    if ((me.target as HTMLElement).tagName === 'BUTTON') return;
    drag = true; dx = me.clientX; dy = me.clientY;
    const r = fPnl!.getBoundingClientRect();
    px = r.left; py = r.top; fPnl!.style.transition = 'none';
  });

  click('__fscan__', () => { scheduleCache.clear(); applyFilterToDOM(); });
  // 已隐藏列表展开/折叠
  click('__fhidrow__', () => {
    fHideListOpen = !fHideListOpen;
    const list = $('__fhlist__');
    const hidSpan = $('__fhid__');
    if (fHideListOpen) {
      list.style.display = 'block';
      hidSpan.textContent = filterHiddenCount + '  ▾';
    } else {
      list.style.display = 'none';
      hidSpan.textContent = filterHiddenCount + '  ▸';
    }
  });
}

function refreshFilterPanel(): void {
  if (!fPnl) return;
  setText('__fbadge__', filterMode ? 'ON' : 'OFF');
  if (filterMode) {
    $<HTMLElement>('__fbadge__').style.background = '#28a745'; $<HTMLElement>('__fbadge__').style.color = '#fff';
  } else {
    $<HTMLElement>('__fbadge__').style.background = '#3a5545'; $<HTMLElement>('__fbadge__').style.color = '#a6e3a1';
  }
  setText('__fkw__', blockKeywords.length > 0 ? blockKeywords.join(', ') : '无');
  // 已隐藏数量 + 箭头
  {
    const hs = $('__fhid__');
    if (hs) hs.textContent = filterHiddenCount + (fHideListOpen ? '  ▾' : '  ▸');
  }
  // 填充屏蔽列表
  {
    const hl = $('__fhlist__');
    if (hl) {
      if (filteredJobs.length > 0) {
        hl.innerHTML = filteredJobs.map(j =>
          `<div class="_hi"><span class="_hit">${esc(j.title)}</span><span class="_hic">${esc(j.company)}</span></div>`
        ).join('');
      } else {
        hl.innerHTML = '<div class="_hi"><span class="_hic">无</span></div>';
      }
    }
  }
  setText('__fc_shuang__', String(schedCounts['双休']));
  setText('__fc_dxzhou__', String(schedCounts['大小周']));
  setText('__fc_danxiu__', String(schedCounts['单休']));
  setText('__fc_9to5__', String((schedCounts['朝九晚五'] || 0) + (schedCounts['朝九晚六'] || 0)));
  setText('__fc_worktime__', String((schedCounts['上班时间'] || 0) + (schedCounts['工作时间'] || 0)));
  setText('__fc_none__', String(schedCounts['未匹配']));
}

function showFilterPanel(): void {
  buildFilterPanel();
  if (fPnl) { fPnl.style.display = ''; refreshFilterPanel(); }
}

function hideFilterPanel(): void {
  if (fPnl) fPnl.style.display = 'none';
}

// ============================================================
// ETA 倒计时
// 第一次投递完成后确定总耗时锚点，之后纯倒计时不做修正
// ============================================================

function startEtaCountdown(): void {
  stopEtaCountdown();
  if (jobItems.length === 0 || !etaTotalMs) return;
  updateEtaDisplay();
  etaTimer = setInterval(updateEtaDisplay, 1000);
}

function updateEtaDisplay(): void {
  const elapsed = startTime > 0 ? Date.now() - startTime : 0;
  const remaining = Math.max(0, etaTotalMs - elapsed);
  setText('__eta__', formatDuration(remaining));
}

function stopEtaCountdown(): void {
  if (etaTimer !== null) { clearInterval(etaTimer); etaTimer = null; }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '即将完成';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}分${sec}秒` : `${m}分钟`;
}

// ============================================================
// 设置
// ============================================================

function slider(sid: string, vid: string, key: keyof SpeedSettings): void {
  $<HTMLInputElement>(sid).addEventListener('input', () => {
    const v = parseInt($<HTMLInputElement>(sid).value);
    setText(vid, v + 'ms');
    (spd as any)[key] = v;
    applySpeed(spd);
    speedPreset = ''; saveSettings();
  });
}

function syncSlidersUI(): void {
  $<HTMLInputElement>('__hl__').value = String(spd.highlightMs); setText('__hlv__', spd.highlightMs + 'ms');
  $<HTMLInputElement>('__minw__').value = String(spd.minWaitMs); setText('__minwv__', spd.minWaitMs + 'ms');
  $<HTMLInputElement>('__maxw__').value = String(spd.maxWaitMs); setText('__maxwv__', spd.maxWaitMs + 'ms');
  $<HTMLInputElement>('__tmo__').value = String(spd.detailTimeoutMs); setText('__tmov__', spd.detailTimeoutMs + 'ms');
}

function preset(name: string): void {
  const p = SPEED_PRESETS[name];
  if (!p) return;
  spd = { ...p }; applySpeed(spd); syncSlidersUI();
  speedPreset = name; saveSettings();
  ['__pre_s__','__pre_r__','__pre_t__'].forEach(id => $(id).classList.remove('_on'));
  const map: Record<string, string> = { stable: '__pre_s__', recommend: '__pre_r__', turbo: '__pre_t__' };
  $(map[name]).classList.add('_on');
  const labels: Record<string, string> = { stable: '稳定', recommend: '推荐', turbo: '极速' };
  setText('__spdlbl__', labels[name]);
  out(`✅ 已切换「${labels[name]}」速度`);
}

// ============================================================
// 自动化
// ============================================================

function start(): void {
  if (!IDLE_SET.has(currentState)) return;
  stopped = false; lastClickedJobText = ''; processedCount = 0; consecutiveErrors = 0;
  userNav = false;
  skippedCount = 0; skippedTexts.clear();
  startTime = Date.now();
  stopEtaCountdown();
  setText('__badge__', '运行中');
  // 每个职位预估8秒 × 总数，直接启动倒计时
  if (jobItems.length > 0) {
    etaTotalMs = 8000 * jobItems.length;
    startEtaCountdown();
  } else {
    setText('__eta__', '计算中...');
  }
  // 切换按钮为停止
  const btn = $<HTMLButtonElement>('__toggle__');
  btn.textContent = '⏹ 停 止';
  btn.className = '_sp';
  refreshPanel();
  go(AutomationState.FIND_NEXT_JOB, 500);
}

function stop(): void {
  stopped = true;
  if (transitionTimerId !== null) { clearTimeout(transitionTimerId); transitionTimerId = null; }
  currentState = AutomationState.STOPPED;
  sendStatus(AutomationState.STOPPED);
  stopEtaCountdown();
  setText('__badge__', '已停止');
  setText('__st__', SCN.STOPPED);
  const btn = $<HTMLButtonElement>('__toggle__');
  btn.textContent = '▶ 开 始';
  btn.className = '_go';
  out('⏹ 已停止');
}

function go(next: AutomationState, ms: number): void {
  if (stopped) { currentState = AutomationState.STOPPED; sendStatus(AutomationState.STOPPED); return; }
  if (transitionTimerId !== null) clearTimeout(transitionTimerId);
  transitionTimerId = setTimeout(() => { transitionTimerId = null; step(next); }, ms);
}

async function step(state: AutomationState): Promise<void> {
  if (stopped) { currentState = AutomationState.STOPPED; sendStatus(AutomationState.STOPPED); return; }
  currentState = state;
  sendStatus(state);
  setText('__st__', SCN[state] || state);
  setText('__badge__', '运行中');
  try {
    let next: AutomationState;
    switch (state) {
      case AutomationState.IDLE: next = AutomationState.IDLE; break;
      case AutomationState.STOPPED: next = AutomationState.IDLE; break;
      case AutomationState.NO_MORE_JOBS:
        stopEtaCountdown();
        setText('__badge__', '完成'); setText('__st__', SCN.NO_MORE_JOBS);
        setText('__eta__', '已完成');
        out(`✅ 全部完成！共投递 <b>${subs.length}</b> 个职位`);
        next = AutomationState.NO_MORE_JOBS; break;
      case AutomationState.ERROR:
        consecutiveErrors++;
        next = consecutiveErrors >= CONFIG.MAX_ERROR_COUNT ? AutomationState.STOPPED : AutomationState.WAIT; break;
      case AutomationState.FIND_COMMUNICATE:
        // 安全检查：当前选中的职位如果是屏蔽的，跳过
        if (blockOn && blockKeywords.length > 0) {
          const cards = getJobCards();
          const ai = findActiveIdx(cards);
          if (ai >= 0 && isBlocked(cards[ai])) {
            out(`🚫 屏蔽跳过「立即沟通」: <b>${esc(txt(cards[ai], 'a.job-name'))}</b>`);
            lastClickedJobText = (cards[ai].textContent || '').trim().substring(0, 60);
            next = AutomationState.FIND_NEXT_JOB; break;
          }
        }
        next = findBtn('立即沟通') ? AutomationState.HIGHLIGHT_COMMUNICATE : AutomationState.FIND_NEXT_JOB; break;
      case AutomationState.HIGHLIGHT_COMMUNICATE: {
        const b = findBtn('立即沟通');
        if (!b) { next = AutomationState.FIND_NEXT_JOB; break; }
        b.scrollIntoView({ behavior: 'smooth', block: 'center' }); hlEl(b);
        next = AutomationState.CLICK_COMMUNICATE; break;
      }
      case AutomationState.CLICK_COMMUNICATE: {
        const b = findBtn('立即沟通');
        if (!b) { next = AutomationState.FIND_NEXT_JOB; break; }
        b.click(); next = AutomationState.CHECK_DIALOG; break;
      }
      case AutomationState.CHECK_DIALOG:
        await sleep(spd.dialogCheckMs);
        recordSub(findBtn('留在此页') ? '弹窗已处理' : '已沟通');
        next = findBtn('留在此页') ? AutomationState.HIGHLIGHT_DIALOG : (processedCount++, consecutiveErrors = 0, AutomationState.FIND_NEXT_JOB); break;
      case AutomationState.HIGHLIGHT_DIALOG: {
        const b2 = findBtn('留在此页');
        if (!b2) { processedCount++; consecutiveErrors = 0; next = AutomationState.FIND_NEXT_JOB; break; }
        b2.scrollIntoView({ behavior: 'smooth', block: 'center' }); hlEl(b2);
        next = AutomationState.CLICK_DIALOG; break;
      }
      case AutomationState.CLICK_DIALOG: {
        const b2 = findBtn('留在此页');
        if (b2) b2.click();
        processedCount++; consecutiveErrors = 0;
        next = AutomationState.FIND_NEXT_JOB; break;
      }
      case AutomationState.FIND_NEXT_JOB: {
        const cards = getJobCards();
        if (cards.length === 0) { next = AutomationState.NO_MORE_JOBS; break; }
        const ai = findActiveIdx(cards);
        if (ai >= 0 && ai < cards.length - 1) { next = AutomationState.HIGHLIGHT_JOB; break; }
        if (lastClickedJobText && ai < 0) {
          const idx = findJobByText(cards, lastClickedJobText);
          if (idx >= 0 && idx < cards.length - 1) { next = AutomationState.HIGHLIGHT_JOB; break; }
        }
        if (!lastClickedJobText) { next = AutomationState.HIGHLIGHT_JOB; break; }
        next = AutomationState.NO_MORE_JOBS; break;
      }
      case AutomationState.HIGHLIGHT_JOB: {
        const tgt = getTargetCard();
        if (!tgt) { out('⚠ 全部职位被屏蔽或无更多职位'); stop(); next = AutomationState.NO_MORE_JOBS; break; }
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
        const b = await waitFor(() => findBtn('立即沟通'), spd.detailTimeoutMs);
        next = b ? AutomationState.FIND_COMMUNICATE : AutomationState.WAIT; break;
      }
      default: next = AutomationState.WAIT;
    }
    if (stopped) return;
    const delay = (
      next === AutomationState.HIGHLIGHT_JOB || next === AutomationState.HIGHLIGHT_COMMUNICATE || next === AutomationState.HIGHLIGHT_DIALOG
    ) ? spd.highlightMs : next === AutomationState.WAIT ? randomWaitMs() : spd.minWaitMs;
    go(next, delay);
  } catch (err) {
    log('error', `[${state}] ${String(err)}`);
    go(AutomationState.ERROR, 1000);
  }
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
  let startIdx: number;
  if (ai >= 0 && ai < cards.length - 1) startIdx = ai + 1;
  else if (lastClickedJobText) { const i = findJobByText(cards, lastClickedJobText); startIdx = i >= 0 && i < cards.length - 1 ? i + 1 : 0; }
  else startIdx = 0;
  // 跳过屏蔽的职位
  for (let j = 0; j < cards.length; j++) {
    const idx = (startIdx + j) % cards.length;
    if (!isBlocked(cards[idx]) && !(filterMode && cards[idx].hasAttribute('__boss_filtered__'))) return cards[idx];
  }
  return null; // 全部被屏蔽
}

// ============================================================
// 投递记录 & ETA
// ============================================================

function recordSub(status: string): void {
  const cards = getJobCards();
  let card: HTMLElement | null = null;
  const ai = findActiveIdx(cards);
  if (ai >= 0) card = cards[ai];
  else if (lastClickedJobText) { const i = findJobByText(cards, lastClickedJobText); if (i >= 0) card = cards[i]; }
  if (card) {
    subs.push({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      title: txt(card, 'a.job-name'), company: txt(card, 'span.boss-name'),
      location: txt(card, 'span.company-location'), tags: txt(card, 'ul.tag-list'), status,
    });
    setText('__sent__', String(subs.length));
    setText('__cnt__', `${subs.length}/${jobItems.length}`);

  }
}

function doExport(): void {
  if (subs.length === 0) { out('⚠ 还没有投递记录'); return; }
  const lines = ['═══════════════════════════════════', '  BOSS直聘 投递记录', `  导出: ${new Date().toLocaleString('zh-CN')}`, `  共 ${subs.length} 个职位`, '═══════════════════════════════════', ''];
  subs.forEach((j, i) => { lines.push(`【${i + 1}】${j.title}`, `  公司: ${j.company}  地址: ${j.location}`, `  要求: ${j.tags}  状态: ${j.status}  时间: ${j.time}`, ''); });
  lines.push('═══════════════════════════════════');
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `BOSS投递记录-${new Date().toISOString().slice(0, 10)}.txt`; a.click();
  URL.revokeObjectURL(url);
  out(`✅ 已导出 ${subs.length} 条记录`);
}

// ============================================================
// 点击检测
// ============================================================

function doInspect(el: HTMLElement): void {
  const L: string[] = ['══════════ 🔍 ══════════'];
  L.push(`Tag: <b>${esc(el.tagName.toLowerCase())}</b>`, `Class: ${esc(el.className || '(无)')}`);
  const r = el.getBoundingClientRect();
  L.push(`Rect: (${R(r.left)},${R(r.top)}) ${R(r.width)}×${R(r.height)}`);
  L.push(`Text: ${esc((el.textContent || '').trim().substring(0, 100))}`);
  L.push('── 祖先 ──');
  let cur: HTMLElement | null = el;
  for (let i = 0; i < 6 && cur; i++) {
    const rc = cur.getBoundingClientRect();
    L.push(`  L${i}: &lt;${esc(cur.tagName.toLowerCase())}&gt; "${esc((cur.className || '').substring(0, 40))}" @(${R(rc.left)},${R(rc.top)}) ${R(rc.width)}×${R(rc.height)}`);
    cur = cur.parentElement;
  }
  L.push('═══════════════════════');
  out(L.join('\n'));
}

// ============================================================
// DOM 工具
// ============================================================

function findBtn(text: string): HTMLElement | null {
  return (
    document.evaluate(`.//button[contains(text(),'${text}')]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as HTMLElement
  ) || (Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text)) as HTMLElement)
    || (Array.from(document.querySelectorAll('[role="button"]')).find(b => b.textContent?.includes(text)) as HTMLElement)
    || (Array.from(document.querySelectorAll('span, a')).find(b => b.textContent?.trim() === text) as HTMLElement)
    || null;
}

function hlEl(el: HTMLElement): void {
  const o = el.style.outline, s = el.style.boxShadow, tr = el.style.transition;
  el.style.outline = '3px solid #f38ba8';
  el.style.boxShadow = '0 0 18px 5px rgba(243,139,168,0.6)';
  el.style.transition = 'outline .2s,box-shadow .2s';
  setTimeout(() => { el.style.outline = o; el.style.boxShadow = s; el.style.transition = tr; }, spd.highlightMs);
}

function waitFor<T>(fn: () => T | null, ms: number): Promise<T | null> {
  return new Promise(r => { const t0 = Date.now(); const c = () => { const v = fn(); if (v) r(v); else if (Date.now() - t0 >= ms) r(null); else setTimeout(c, 300); }; c(); });
}

function txt(el: HTMLElement, sel: string): string { const e = el.querySelector(sel); return e ? (e.textContent || '').trim() : ''; }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// 工具
// ============================================================

function $<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function click(id: string, fn: () => void): void { $(id).addEventListener('click', fn); }
function setText(id: string, text: string): void { const el = document.getElementById(id); if (el) el.textContent = text; }
function out(html: string): void { const el = document.getElementById('__out__'); if (el) el.innerHTML = html.replace(/\n/g, '<br>'); }
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function R(n: number): string { return Math.round(n).toString(); }

function sendStatus(state: AutomationState): void {
  setText('__st__', SCN[state] || state);
  setText('__sent__', String(subs.length));
  setText('__cnt__', `${subs.length}/${jobItems.length}`);
  chrome.runtime.sendMessage({ type: 'STATUS', state, processedCount } satisfies StatusMessage).catch(() => {});
}

function log(level: 'info' | 'warn' | 'error', msg: string): void {
  const m = `[BOSS] ${msg}`;
  switch (level) { case 'warn': console.warn(m); break; case 'error': console.error(m); break; default: console.log(m); break; }
  chrome.runtime.sendMessage({ type: 'LOG', level, message: msg } satisfies LogMessage).catch(() => {});
}

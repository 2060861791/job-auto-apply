/**
 * BOSS自动投递 - Content Script v8.1
 *
 * 修复：面板定位/DOM结构/拖动/点击/初始化
 * 自包含单元素面板，position:fixed 直接在面板上
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

let pnl: HTMLElement | null = null;
let jobItems: HTMLElement[] = [];
let curIdx = 0;
let inspectOn = false;
let cfgOpen = false;
let folded = false;

// 拖动
let drag = false, dx = 0, dy = 0, px = 0, py = 0;

// 投递记录
interface Sub { time: string; title: string; company: string; location: string; tags: string; status: string; }
const subs: Sub[] = [];

let spd: SpeedSettings = { ...SPEED_PRESETS.recommend };
applySpeed(spd);

// ============================================================
// 初始化
// ============================================================

let initTried = 0;
function tryInit(): void {
  initTried++;
  if (pnl) return;
  if (document.readyState === 'loading') { setTimeout(tryInit, 800); return; }
  const cards = getJobCards();
  if (cards.length === 0 && initTried < 6) { setTimeout(tryInit, 1000); return; }
  try {
    buildPanel();
    refreshPanel();
  } catch (e) {
    if (initTried < 10) setTimeout(tryInit, 1500);
  }
}
setTimeout(tryInit, 1000);
window.addEventListener('load', () => setTimeout(tryInit, 1500));

chrome.runtime.onMessage.addListener((message: CommandMessage) => {
  if (message.type !== 'COMMAND') return;
  if (message.command === 'START') start();
  else if (message.command === 'STOP') stop();
  else if (message.command === 'GET_STATUS') sendStatus(currentState);
});

// 全局拖动
document.addEventListener('mousemove', (e) => {
  if (!drag || !pnl) return;
  const nx = Math.max(0, Math.min(px + e.clientX - dx, window.innerWidth - pnl.offsetWidth));
  const ny = Math.max(0, Math.min(py + e.clientY - dy, window.innerHeight - 60));
  pnl.style.left = nx + 'px';
  pnl.style.top = ny + 'px';
});
document.addEventListener('mouseup', () => { drag = false; });

// 点击检测
document.addEventListener('click', (e) => {
  if (!inspectOn) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  doInspect(e.target as HTMLElement);
}, true);

// ============================================================
// 面板 HTML
// ============================================================

const CSS = `
#_b_{position:fixed;top:80px;right:16px;width:360px;background:#1a1a2e;color:#cdd6f4;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.55);z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:12px;user-select:none;display:flex;flex-direction:column;max-height:calc(100vh - 100px);}
#_b_ ._h{cursor:move;background:linear-gradient(135deg,#2d2d44,#252540);padding:10px 14px;display:flex;align-items:center;gap:8px;border-radius:14px 14px 0 0;flex-shrink:0;}
#_b_ ._hh{color:#e2a4f5;font-weight:700;font-size:13px;flex:1;}
#_b_ ._hb{font-size:10px;background:#3a3a55;color:#a6adc8;padding:2px 8px;border-radius:10px;}
#_b_ ._h button{width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:#a6adc8;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
#_b_ ._h button:hover{background:#3a3a55;color:#fff;}
#_b_ ._s{display:flex;border-bottom:1px solid #2a2a44;flex-shrink:0;}
#_b_ ._si{flex:1;text-align:center;padding:10px 4px;border-right:1px solid #2a2a44;}
#_b_ ._si:last-child{border-right:none;}
#_b_ ._sv{font-size:18px;font-weight:700;}
#_b_ ._sl{font-size:10px;color:#78789e;margin-top:2px;}
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
#_b_ ._out{flex:1;overflow-y:auto;padding:10px 14px;font-size:11px;line-height:1.65;color:#b4b8d0;min-height:60px;max-height:280px;}
#_b_ ._out b{color:#e2a4f5;}
#_b_ ._out ._d{color:#585b70;}
#_b_ ._out ._g{color:#a6e3a1;}
#_b_ ._out ._y{color:#f9e2af;}
#_b_ ._out ._r{color:#f38ba8;}
#_b_ ._out::-webkit-scrollbar{width:4px;}
#_b_ ._out::-webkit-scrollbar-thumb{background:#3a3a55;border-radius:2px;}
#_b_ ._na{background:#89b4fa!important;color:#1a1a2e!important;border-color:#89b4fa!important;font-weight:600;}
#_b_ ._nn{background:#a6e3a1!important;color:#1a1a2e!important;border-color:#a6e3a1!important;font-weight:600;}
#_b_ ._nd{background:#f38ba8!important;color:#1a1a2e!important;border-color:#f38ba8!important;}
#_b_ ._nx{background:#a6e3a1!important;color:#1a1a2e!important;border-color:#a6e3a1!important;font-weight:700;}
`;

const HTML = `
<div class="_h" id="__h__">
  <span>≡</span><span class="_hh">BOSS 自动投递 v8</span>
  <span class="_hb" id="__badge__">就绪</span>
  <button id="__cfg__" title="设置">⚙</button>
  <button id="__fold__" title="折叠">─</button>
</div>
<div class="_s" id="__stats__">
  <div class="_si"><div class="_sv" style="color:#a6e3a1" id="__cnt__">-</div><div class="_sl">检测到</div></div>
  <div class="_si"><div class="_sv" style="color:#f5c2e7" id="__sent__">0</div><div class="_sl">已投递</div></div>
  <div class="_si"><div class="_sv" style="color:#f9e2af" id="__idx__">-</div><div class="_sl">当前</div></div>
  <div class="_si"><div class="_sv" style="color:#f38ba8;font-size:11px" id="__st__">就绪</div><div class="_sl">状态</div></div>
</div>
<div class="_bt" id="__nav__">
  <button class="_na" id="__prev__" style="flex:.7;font-size:16px;">◀</button>
  <button class="_nn" id="__next__" style="flex:.7;font-size:16px;">▶</button>
  <button id="__insp__">🎯 OFF</button>
  <button class="_nx" id="__export__">📥 导出</button>
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

  // 拖动
  const hdr = $('__h__');
  hdr.addEventListener('mousedown', (e) => {
    const me = e as MouseEvent;
    if ((me.target as HTMLElement).tagName === 'BUTTON') return;
    drag = true;
    dx = me.clientX; dy = me.clientY;
    const r = pnl!.getBoundingClientRect();
    px = r.left; py = r.top;
    pnl!.style.transition = 'none';
  });

  // 按钮
  click('__prev__', () => navPanel(-1));
  click('__next__', () => navPanel(1));
  click('__insp__', () => {
    inspectOn = !inspectOn;
    const b = $<HTMLButtonElement>('__insp__');
    b.textContent = inspectOn ? '🎯 ON' : '🎯 OFF';
    b.className = inspectOn ? '_nd' : '';
    if (inspectOn) out('✅ 点击检测 ON — 点击页面元素查看DOM');
  });
  click('__export__', doExport);
  click('__cfg__', () => { cfgOpen = !cfgOpen; $('__cfgpnl__').classList.toggle('on', cfgOpen); });
  click('__fold__', () => {
    folded = !folded;
    ['__stats__','__nav__','__cfgpnl__','__out__'].forEach(id => {
      $(id).style.display = folded ? 'none' : '';
    });
    $<HTMLButtonElement>('__fold__').textContent = folded ? '□' : '─';
  });

  // 速度滑条
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
// 刷新面板
// ============================================================

function refreshPanel(): void {
  jobItems = getJobCards();
  const ai = findActiveIdx(jobItems);
  if (ai >= 0) curIdx = ai;

  setText('__cnt__', String(jobItems.length));
  setText('__sent__', String(subs.length));
  setText('__idx__', jobItems.length > 0 ? String(curIdx + 1) : '-');
  setText('__st__', currentState);

  const L: string[] = [];
  L.push(`📋 <b>${jobItems.length}</b> 个职位 | 已投递 <b class="_r">${subs.length}</b> | ${currentState}`);
  L.push('');
  if (jobItems.length > 0) {
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
    hlCard(curIdx);
  } else {
    L.push('⚠ 未检测到职位 — 请确保在搜索结果页');
  }
  out(L.join('\n'));
}

function navPanel(delta: number): void {
  if (jobItems.length === 0) { refreshPanel(); return; }
  const ni = curIdx + delta;
  if (ni < 0 || ni >= jobItems.length) return;
  curIdx = ni;
  hlCard(curIdx);
  setText('__idx__', String(curIdx + 1));
  refreshPanel();
}

function hlCard(idx: number): void {
  const card = jobItems[idx];
  if (!card) return;
  jobItems.forEach(e => { e.style.outline = ''; e.style.boxShadow = ''; });
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.outline = '3px solid #f5c2e7';
  card.style.boxShadow = '0 0 20px 4px rgba(245,194,231,0.5)';
  out(`📍 [${idx + 1}/${jobItems.length}] <b>${esc(txt(card, 'a.job-name'))}</b>\n公司: ${esc(txt(card, 'span.boss-name'))} | ${esc(txt(card, 'span.company-location'))}\n要求: ${esc(txt(card, 'ul.tag-list'))}`);
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
  if (![AutomationState.IDLE, AutomationState.STOPPED, AutomationState.NO_MORE_JOBS].includes(currentState)) return;
  stopped = false; lastClickedJobText = ''; processedCount = 0; consecutiveErrors = 0;
  setText('__badge__', '运行中');
  refreshPanel();
  go(AutomationState.FIND_COMMUNICATE, 500);
}

function stop(): void {
  stopped = true;
  if (transitionTimerId !== null) { clearTimeout(transitionTimerId); transitionTimerId = null; }
  currentState = AutomationState.STOPPED;
  sendStatus(AutomationState.STOPPED);
  setText('__badge__', '已停止');
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
  setText('__st__', state);
  setText('__badge__', '运行中');
  try {
    let next: AutomationState;
    switch (state) {
      case AutomationState.IDLE: next = AutomationState.IDLE; break;
      case AutomationState.STOPPED: next = AutomationState.IDLE; break;
      case AutomationState.NO_MORE_JOBS: {
        setText('__badge__', '完成');
        out(`✅ 全部完成！共投递 <b>${subs.length}</b> 个职位`);
        next = AutomationState.NO_MORE_JOBS; break;
      }
      case AutomationState.ERROR:
        consecutiveErrors++;
        next = consecutiveErrors >= CONFIG.MAX_ERROR_COUNT ? AutomationState.STOPPED : AutomationState.WAIT; break;
      case AutomationState.FIND_COMMUNICATE:
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
        const b = findBtn('留在此页');
        if (!b) { processedCount++; consecutiveErrors = 0; next = AutomationState.FIND_NEXT_JOB; break; }
        b.scrollIntoView({ behavior: 'smooth', block: 'center' }); hlEl(b);
        next = AutomationState.CLICK_DIALOG; break;
      }
      case AutomationState.CLICK_DIALOG: {
        const b = findBtn('留在此页');
        if (b) b.click();
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
  if (ai >= 0 && ai < cards.length - 1) return cards[ai + 1];
  if (lastClickedJobText) { const i = findJobByText(cards, lastClickedJobText); if (i >= 0 && i < cards.length - 1) return cards[i + 1]; }
  return cards[0];
}

// ============================================================
// 投递记录 & 导出
// ============================================================

function recordSub(status: string): void {
  const cards = getJobCards();
  let card: HTMLElement | null = null;
  const ai = findActiveIdx(cards);
  if (ai >= 0) card = cards[ai];
  else if (lastClickedJobText) { const i = findJobByText(cards, lastClickedJobText); if (i >= 0) card = cards[i]; }
  if (card) {
    subs.push({ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), title: txt(card, 'a.job-name'), company: txt(card, 'span.boss-name'), location: txt(card, 'span.company-location'), tags: txt(card, 'ul.tag-list'), status });
    setText('__sent__', String(subs.length));
  }
}

function doExport(): void {
  if (subs.length === 0) { out('⚠ 还没有投递记录'); return; }
  const lines = ['═══════════════════════════════════', '  BOSS直聘 投递记录', `  导出: ${new Date().toLocaleString('zh-CN')}`, `  共 ${subs.length} 个职位`, '═══════════════════════════════════', ''];
  subs.forEach((j, i) => { lines.push(`【${i + 1}】${j.title}`, `  公司: ${j.company}  地址: ${j.location}`, `  要求: ${j.tags}  状态: ${j.status}  时间: ${j.time}`, ''); });
  lines.push('═══════════════════════════════════');
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `BOSS投递记录-${new Date().toISOString().slice(0, 10)}.txt`; a.click();
  URL.revokeObjectURL(url);
  out(`✅ 已导出 ${subs.length} 条记录`);
}

// ============================================================
// 点击检测
// ============================================================

function doInspect(el: HTMLElement): void {
  const L: string[] = [];
  L.push('══════════ 🔍 ══════════');
  L.push(`Tag: <b>${esc(el.tagName.toLowerCase())}</b>`);
  L.push(`Class: ${esc(el.className || '(无)')}`);
  const r = el.getBoundingClientRect();
  L.push(`Rect: (${R(r.left)},${R(r.top)}) ${R(r.width)}×${R(r.height)}`);
  L.push(`CSS: <code>${esc(cssPath(el))}</code>`);
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
  setTimeout(() => { el.style.outline = o; el.style.boxShadow = s; el.style.transition = tr; }, spd.highlightMs);
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
    if (par) { const sibs = Array.from(par.children).filter(x => x.tagName === c!.tagName); if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(c) + 1})`; }
    p.unshift(s); c = par;
  }
  return p.join(' > ');
}

function txt(el: HTMLElement, sel: string): string { const e = el.querySelector(sel); return e ? (e.textContent || '').trim() : ''; }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// 微型工具
// ============================================================

function $<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function click(id: string, fn: () => void): void { $(id).addEventListener('click', fn); }
function setText(id: string, text: string): void { const el = document.getElementById(id); if (el) el.textContent = text; }
function out(html: string): void { const el = document.getElementById('__out__'); if (el) el.innerHTML = html.replace(/\n/g, '<br>'); }
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function R(n: number): string { return Math.round(n).toString(); }

function sendStatus(state: AutomationState): void {
  setText('__st__', state); setText('__sent__', String(subs.length));
  chrome.runtime.sendMessage({ type: 'STATUS', state, processedCount } satisfies StatusMessage).catch(() => {});
}

function log(level: 'info' | 'warn' | 'error', msg: string): void {
  const m = `[BOSS] ${msg}`;
  switch (level) { case 'warn': console.warn(m); break; case 'error': console.error(m); break; default: console.log(m); break; }
  chrome.runtime.sendMessage({ type: 'LOG', level, message: msg } satisfies LogMessage).catch(() => {});
}

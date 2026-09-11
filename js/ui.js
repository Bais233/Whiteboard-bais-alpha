/**
 * ui.js —— DOM 装配：工具条、样式面板、数学面板、快捷键、状态栏
 */

import { state, BOARD_PRESETS, screenToWorld } from './state.js';
import { TOOL_LIST, setTool, onToolChange, zoomBy, zoomTo, deleteSelection, duplicateSelection, nudgeSelection, selectAll, reorderSelection, applyStyleToSelection } from './tools.js';
import { commit, undo, redo, onHistoryChange, canUndo, canRedo } from './history.js';
import { requestRender, fitToContent, onPaint, isDarkBoard } from './renderer.js';
import { startPlayback, stopPlayback, togglePause, seek, setSpeed, onPlaybackChange, playbackDuration } from './playback.js';
import { SYMBOL_GROUPS, TEX_EXAMPLES, texToUnicode } from './math.js';
import { NOTE_COLORS } from './model.js';
import { saveLocalNow, saveLocal, writeLocal } from './storage.js';
import { exportPNG, exportSVG, exportJSON, importJSONText, printDoc } from './export.js';
import { insertIntoEditor, isEditing } from './editor.js';
import { formatTime, nowMs } from './utils.js';

const PALETTE = [
  '#1f2937', '#ffffff', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#d946ef', '#ec4899', '#a16207', '#64748b', '#0f172a',
];

const $ = (id) => document.getElementById(id);
const el = {
  board: $('board'),
  toolbar: $('toolbar'),
  toolGrid: $('toolGrid'),
  stylebar: $('stylebar'),
  swatches: $('swatches'),
  colorInput: $('colorInput'),
  fillToggle: $('fillToggle'),
  sizeInput: $('sizeInput'),
  sizeOut: $('sizeOut'),
  opacityInput: $('opacityInput'),
  opacityOut: $('opacityOut'),
  fontInput: $('fontInput'),
  fontOut: $('fontOut'),
  mathPanel: $('mathPanel'),
  mathTabs: $('mathTabs'),
  mathGrid: $('mathGrid'),
  texInput: $('texInput'),
  texInsert: $('texInsert'),
  texPreview: $('texPreview'),
  playback: $('playback'),
  playScrub: $('playScrub'),
  playTime: $('playTime'),
  playSpeed: $('playSpeed'),
  statusTool: $('statusTool'),
  statusHint: $('statusHint'),
  statusSel: $('statusSel'),
  statusCount: $('statusCount'),
  statusCoord: $('statusCoord'),
  statusSave: $('statusSave'),
  helpModal: $('helpModal'),
  helpTools: $('helpTools'),
  toasts: $('toasts'),
  fileInput: $('fileInput'),
  fileMenu: $('fileMenu'),
  clock: $('clock'),
  zoomLabel: $('btnZoomLabel'),
  app: $('app'),
};

const UI_KEY = 'whiteboard-bais-alpha:ui';
let mathTab = SYMBOL_GROUPS[0].id;
let clockTimer = 0;
let saveState = 'saved';

/* -------------------------------------------------------------- 提示气泡 */

export function toast(message, kind = 'info', ms = 2200) {
  const node = document.createElement('div');
  node.className = `toast${kind === 'ok' ? ' toast--ok' : kind === 'err' ? ' toast--err' : ''}`;
  node.textContent = message;
  el.toasts.appendChild(node);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 300);
  }, ms);
}

/* ---------------------------------------------------------------- 工具条 */

function buildTools() {
  el.toolGrid.innerHTML = '';
  for (const tool of TOOL_LIST) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--tool';
    btn.type = 'button';
    btn.dataset.tool = tool.id;
    btn.title = `${tool.name} (${tool.key})\n${tool.hint}`;
    btn.setAttribute('aria-pressed', String(state.tool === tool.id));
    btn.innerHTML = `<svg class="icon"><use href="#${tool.icon}" /></svg><span>${tool.name}</span>`;
    btn.addEventListener('click', () => setTool(tool.id));
    el.toolGrid.appendChild(btn);
  }
}

function refreshToolUI() {
  const tool = TOOL_LIST.find((t) => t.id === state.tool);
  el.toolGrid.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.tool === state.tool));
  });
  el.statusTool.textContent = tool ? tool.name : state.tool;
  el.statusHint.textContent = tool ? tool.hint : '';
  el.board.dataset.tool = state.tool;
}

/* ---------------------------------------------------------------- 样式条 */

function buildSwatches() {
  el.swatches.innerHTML = '';
  for (const color of PALETTE) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = color;
    btn.dataset.color = color;
    btn.title = color;
    btn.setAttribute('aria-label', `颜色 ${color}`);
    btn.setAttribute('aria-pressed', String(color === state.style.color));
    btn.addEventListener('click', () => setColor(color));
    el.swatches.appendChild(btn);
  }
  // 便签色
  for (const color of NOTE_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = color;
    btn.dataset.note = color;
    btn.title = `便签色 ${color}`;
    btn.setAttribute('aria-label', `便签色 ${color}`);
    btn.setAttribute('aria-pressed', String(color === state.style.noteColor));
    btn.addEventListener('click', () => {
      state.style.noteColor = color;
      refreshStyleUI();
      persistUI();
    });
    el.swatches.appendChild(btn);
  }
}

function setColor(color) {
  state.style.color = color;
  el.colorInput.value = color.startsWith('#') ? color : '#000000';
  if (state.selection.size) applyStyleToSelection({ color });
  refreshStyleUI();
  persistUI();
  requestRender();
}

function setRangeFill(input) {
  const min = +input.min;
  const max = +input.max;
  const pct = ((+input.value - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

function refreshStyleUI() {
  el.swatches.querySelectorAll('[data-color]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.color === state.style.color))
  );
  el.swatches.querySelectorAll('[data-note]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.note === state.style.noteColor))
  );
  el.sizeInput.value = state.style.size;
  el.sizeOut.textContent = `${state.style.size}px`;
  el.opacityInput.value = Math.round(state.style.opacity * 100);
  el.opacityOut.textContent = `${Math.round(state.style.opacity * 100)}%`;
  el.fontInput.value = state.style.fontSize;
  el.fontOut.textContent = `${state.style.fontSize}px`;
  el.fillToggle.setAttribute('aria-pressed', String(!!state.style.fill));
  el.colorInput.value = state.style.color;
  [el.sizeInput, el.opacityInput, el.fontInput].forEach(setRangeFill);
}

function bindStyleInputs() {
  el.colorInput.addEventListener('input', (e) => setColor(e.target.value));
  el.fillToggle.addEventListener('click', () => {
    state.style.fill = !state.style.fill;
    if (state.selection.size) applyStyleToSelection({ fill: state.style.fill });
    refreshStyleUI();
    persistUI();
  });
  el.sizeInput.addEventListener('input', (e) => {
    state.style.size = +e.target.value;
    if (state.selection.size) applyStyleToSelection({ size: state.style.size });
    refreshStyleUI();
    persistUI();
  });
  el.opacityInput.addEventListener('input', (e) => {
    state.style.opacity = +e.target.value / 100;
    if (state.selection.size) applyStyleToSelection({ opacity: state.style.opacity });
    refreshStyleUI();
    persistUI();
  });
  el.fontInput.addEventListener('input', (e) => {
    state.style.fontSize = +e.target.value;
    if (state.selection.size) applyStyleToSelection({ fontSize: state.style.fontSize });
    refreshStyleUI();
    persistUI();
  });
}

/* ---------------------------------------------------------------- 视图按钮 */

function refreshZoomLabel() {
  el.zoomLabel.textContent = `${Math.round(state.camera.scale * 100)}%`;
}

function bindView() {
  $('btnZoomIn').addEventListener('click', () => { zoomBy(1.25); refreshZoomLabel(); });
  $('btnZoomOut').addEventListener('click', () => { zoomBy(1 / 1.25); refreshZoomLabel(); });
  el.zoomLabel.addEventListener('click', () => { zoomTo(1); refreshZoomLabel(); });
  $('btnFit').addEventListener('click', () => { fitToContent(60, true); refreshZoomLabel(); });
  $('btnGrid').addEventListener('click', () => {
    const order = ['dots', 'lines', 'none'];
    state.board.grid = order[(order.indexOf(state.board.grid) + 1) % order.length];
    $('btnGrid').setAttribute('aria-pressed', String(state.board.grid !== 'none'));
    requestRender();
    persistUI();
    toast(`网格：${{ dots: '点阵', lines: '方格', none: '关闭' }[state.board.grid]}`);
  });
  $('btnSnap').addEventListener('click', () => {
    state.board.snap = !state.board.snap;
    $('btnSnap').setAttribute('aria-pressed', String(state.board.snap));
    persistUI();
    toast(state.board.snap ? '已开启对齐网格' : '已关闭对齐网格');
  });
}

/* ------------------------------------------------------------ 录制与回放 */

function bindSession() {
  $('btnRecord').addEventListener('click', toggleRecording);
  $('btnPlay').addEventListener('click', () => {
    if (state.playback.active) {
      stopPlayback();
      el.playback.hidden = true;
      return;
    }
    if (!playbackDuration()) {
      toast('还没有可回放的笔迹，先打开录制（F9）再画几笔', 'err');
      return;
    }
    el.playback.hidden = false;
    startPlayback();
  });
  $('btnPlayToggle').addEventListener('click', togglePause);
  $('btnPlayClose').addEventListener('click', () => {
    stopPlayback();
    el.playback.hidden = true;
  });
  el.playScrub.addEventListener('input', (e) => seek(+e.target.value / 1000));
  el.playSpeed.addEventListener('change', (e) => setSpeed(+e.target.value));

  onPlaybackChange((p) => {
    el.playback.hidden = !p.active;
    el.playScrub.value = p.duration ? Math.round((p.t / p.duration) * 1000) : 0;
    el.playTime.textContent = `${formatTime(p.t)} / ${formatTime(p.duration)}`;
  });
}

export function toggleRecording() {
  const s = state.session;
  const btn = $('btnRecord');
  if (!s.recording) {
    s.recording = true;
    s.startedAt = nowMs();
    btn.setAttribute('aria-pressed', 'true');
    el.clock.classList.add('is-recording');
    toast('录制已开始，笔迹将带时间轴');
  } else {
    s.recording = false;
    s.elapsed += nowMs() - s.startedAt;
    btn.setAttribute('aria-pressed', 'false');
    el.clock.classList.remove('is-recording');
    toast(`录制已停止，共 ${formatTime(s.elapsed)}`);
  }
  saveLocal();
}

function tickClock() {
  const s = state.session;
  const t = s.recording ? s.elapsed + (nowMs() - s.startedAt) : s.elapsed;
  el.clock.textContent = formatTime(t);
}

/* ---------------------------------------------------------------- 数学面板 */

function buildMathPanel() {
  el.mathTabs.innerHTML = '';
  for (const group of SYMBOL_GROUPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = group.label;
    btn.dataset.tab = group.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(group.id === mathTab));
    btn.addEventListener('click', () => {
      mathTab = group.id;
      buildMathPanel();
    });
    el.mathTabs.appendChild(btn);
  }

  const group = SYMBOL_GROUPS.find((g) => g.id === mathTab) || SYMBOL_GROUPS[0];
  el.mathGrid.innerHTML = '';
  for (const sym of group.items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sym';
    btn.textContent = sym;
    btn.title = `插入 ${sym}`;
    btn.addEventListener('click', () => insertSymbol(sym));
    el.mathGrid.appendChild(btn);
  }

}

/** 速记示例只构建一次，放进固定容器，避免切换分组时重复追加 */
let examplesBuilt = false;
function buildExamples() {
  if (examplesBuilt) return;
  examplesBuilt = true;
  const ex = document.getElementById('mathExamples');
  ex.style.display = 'flex';
  ex.style.flexWrap = 'wrap';
  ex.style.gap = '4px';
  for (const t of TEX_EXAMPLES.slice(0, 4)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--sm';
    b.style.fontSize = '10.5px';
    b.textContent = t.length > 14 ? `${t.slice(0, 13)}…` : t;
    b.title = t;
    b.addEventListener('click', () => {
      el.texInput.value = t;
      updateTexPreview();
      el.texInput.focus();
    });
    ex.appendChild(b);
  }
}

function updateTexPreview() {
  const raw = el.texInput.value;
  el.texPreview.textContent = raw.trim() ? `预览：${texToUnicode(raw)}` : '预览：—';
}

function insertSymbol(sym) {
  if (insertIntoEditor(sym)) return;
  placeFormula(sym);
}

function placeFormula(text) {
  if (!text) return;
  const center = screenToWorld(state.viewport.w / 2, state.viewport.h / 2);
  const node = {
    id: `t${Date.now().toString(36)}`,
    type: 'text',
    x: center.x,
    y: center.y,
    text,
    color: state.style.color,
    opacity: state.style.opacity,
    fontSize: state.style.fontSize,
    fontFamily: state.style.fontFamily,
    align: 'left',
    meta: null,
    t: state.session.recording ? state.session.elapsed + (nowMs() - state.session.startedAt) : state.session.elapsed,
    dur: 0,
  };
  state.elements.push(node);
  state.selection = new Set([node.id]);
  commit('公式');
  setTool('select');
  requestRender();
  toast('已插入到画板中心，可用选择工具拖动');
}

function toggleMathPanel(force) {
  const open = force ?? !state.ui.mathOpen;
  state.ui.mathOpen = open;
  el.mathPanel.hidden = !open;
  $('btnMath').setAttribute('aria-pressed', String(open));
  if (open) el.texInput.focus();
}

/* ------------------------------------------------------------------ 菜单 */

function bindMenu() {
  const btn = $('btnMenu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = el.fileMenu.hidden;
    el.fileMenu.hidden = !hidden;
    btn.setAttribute('aria-expanded', String(!hidden));
  });
  document.addEventListener('click', (e) => {
    if (!el.fileMenu.hidden && !el.fileMenu.contains(e.target) && e.target !== btn) {
      el.fileMenu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
  el.fileMenu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    el.fileMenu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    runAction(item.dataset.act);
  });
}

export async function runAction(act) {
  try {
    switch (act) {
      case 'save-json':
        exportJSON();
        toast('已导出 .wbjson 工程', 'ok');
        break;
      case 'open-json':
        el.fileInput.click();
        break;
      case 'export-png': {
        const size = await exportPNG();
        toast(`已导出 PNG（${size.width}×${size.height}）`, 'ok');
        break;
      }
      case 'export-svg':
        exportSVG();
        toast('已导出 SVG', 'ok');
        break;
      case 'print':
        await printDoc();
        break;
      case 'board-white':
        setBoard('white');
        break;
      case 'board-eye':
        setBoard('eye');
        break;
      case 'board-dark':
        setBoard('dark');
        break;
      case 'clear':
        clearBoard();
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(err);
    toast(err.message || '操作失败', 'err');
  }
}

function setBoard(preset) {
  const conf = BOARD_PRESETS[preset];
  if (!conf) return;
  state.board.color = conf.color;
  state.board.gridColor = conf.grid;
  state.ui.theme = preset === 'dark' ? 'dark' : 'light';
  el.app.dataset.theme = state.ui.theme;
  // 深色板面上，默认笔色自动换成白色
  if (isDarkBoard() && state.style.color === '#1f2937') state.style.color = '#ffffff';
  if (!isDarkBoard() && state.style.color === '#ffffff') state.style.color = '#1f2937';
  refreshStyleUI();
  requestRender();
  persistUI();
  saveLocal();
  toast(`板面：${conf.name}`);
}

function clearBoard() {
  if (!state.elements.length) {
    toast('画板已经是空的');
    return;
  }
  if (!window.confirm(`确定清空 ${state.elements.length} 个元素？此操作可以撤销（Ctrl+Z）。`)) return;
  state.elements = [];
  state.selection.clear();
  commit('清空');
  requestRender();
  toast('已清空画板', 'ok');
}

/* ------------------------------------------------------------------ 帮助 */

function buildHelp() {
  el.helpTools.innerHTML = '';
  for (const tool of TOOL_LIST) {
    const li = document.createElement('li');
    li.innerHTML = `<span><kbd>${tool.key}</kbd></span><em>${tool.name}：${tool.hint}</em>`;
    el.helpTools.appendChild(li);
  }
  const open = (show) => {
    el.helpModal.hidden = !show;
  };
  el.helpModal.querySelectorAll('[data-close-modal]').forEach((n) =>
    n.addEventListener('click', () => open(false))
  );
  $('btnHelp').addEventListener('click', () => open(true));
}

/* ---------------------------------------------------------------- 面板拖动 */

function makeDraggable(panel) {
  const handle = panel.querySelector('[data-drag-handle]');
  if (!handle) return;
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    panel.classList.add('is-dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const x = Math.min(Math.max(4, e.clientX - start.x), window.innerWidth - panel.offsetWidth - 4);
    const y = Math.min(Math.max(4, e.clientY - start.y), window.innerHeight - 40);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  const end = () => {
    if (!start) return;
    start = null;
    panel.classList.remove('is-dragging');
    persistUI();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function persistUI() {
  const data = {
    tool: state.tool,
    style: { ...state.style },
    board: { grid: state.board.grid, snap: state.board.snap, color: state.board.color, gridColor: state.board.gridColor },
    theme: state.ui.theme,
    collapsed: state.ui.toolsCollapsed,
    panels: {
      toolbar: { left: el.toolbar.style.left, top: el.toolbar.style.top },
      stylebar: { left: el.stylebar.style.left, bottom: el.stylebar.style.bottom },
      mathPanel: { left: el.mathPanel.style.left, top: el.mathPanel.style.top },
    },
  };
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(data));
  } catch {
    /* 忽略 */
  }
}

function restoreUI() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
  } catch {
    data = null;
  }
  if (!data) return;
  if (data.style) Object.assign(state.style, data.style);
  if (data.board) Object.assign(state.board, data.board);
  if (data.theme) {
    state.ui.theme = data.theme;
    el.app.dataset.theme = data.theme;
  }
  if (data.tool) state.tool = data.tool;
  if (data.collapsed) {
    state.ui.toolsCollapsed = true;
    el.toolbar.classList.add('is-collapsed');
  }
  const apply = (node, pos) => {
    if (!pos) return;
    if (pos.left) node.style.left = pos.left;
    if (pos.top) node.style.top = pos.top;
    if (pos.bottom) node.style.bottom = pos.bottom;
    if (pos.left || pos.top) node.style.right = 'auto';
  };
  apply(el.toolbar, data.panels?.toolbar);
  apply(el.stylebar, data.panels?.stylebar);
  apply(el.mathPanel, data.panels?.mathPanel);
  $('btnGrid').setAttribute('aria-pressed', String(state.board.grid !== 'none'));
  $('btnSnap').setAttribute('aria-pressed', String(state.board.snap));
}

/* ---------------------------------------------------------------- 快捷键 */

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable || isEditing();
}

function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    // 空格平移
    if (e.code === 'Space' && !isTyping(e.target)) {
      if (!state.interaction.spaceDown) {
        state.interaction.spaceDown = true;
        document.body.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }

    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (undo()) { requestRender(); markDirty(); } else toast('没有可撤销的操作');
      return;
    }
    if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault();
      if (redo()) { requestRender(); markDirty(); } else toast('没有可重做的操作');
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      runAction('save-json');
      return;
    }
    if (mod && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      runAction('print');
      return;
    }
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleTools();
      return;
    }
    if (isTyping(e.target)) return;

    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      if (duplicateSelection().length) toast('已复制选中元素');
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setTool('select');
      selectAll();
      return;
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        if (deleteSelection()) toast('已删除选中元素');
        e.preventDefault();
        return;
      case 'Escape':
        if (state.playback.active) {
          stopPlayback();
          el.playback.hidden = true;
        }
        state.selection.clear();
        requestRender();
        return;
      case '+':
      case '=':
        zoomBy(1.25);
        return;
      case '-':
      case '_':
        zoomBy(1 / 1.25);
        return;
      case '0':
        zoomTo(1);
        return;
      case '1':
        fitToContent(60, true);
        return;
      case 'g':
        $('btnGrid').click();
        return;
      case 'G':
        $('btnSnap').click();
        return;
      case 'm':
        toggleMathPanel();
        return;
      case '?':
        el.helpModal.hidden = false;
        return;
      case 'F9':
        e.preventDefault();
        toggleRecording();
        return;
      case 'F10':
        e.preventDefault();
        $('btnPlay').click();
        return;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        const step = (e.shiftKey ? 10 : 1) / state.camera.scale;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (state.selection.size) {
          e.preventDefault();
          nudgeSelection(dx, dy);
        }
        return;
      }
      default:
        break;
    }

    const tool = TOOL_LIST.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
    if (tool && !mod) setTool(tool.id);
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      state.interaction.spaceDown = false;
      document.body.style.cursor = '';
    }
  });
  window.addEventListener('keydown', (e) => {
    state.interaction.altDown = e.altKey;
  });
  window.addEventListener('keyup', (e) => {
    state.interaction.altDown = e.altKey;
  });
  window.addEventListener('blur', () => {
    state.interaction.spaceDown = false;
    state.interaction.altDown = false;
  });
}

function toggleTools() {
  state.ui.toolsCollapsed = !state.ui.toolsCollapsed;
  el.toolbar.classList.toggle('is-collapsed', state.ui.toolsCollapsed);
  persistUI();
}

/* ---------------------------------------------------------------- 状态栏 */

function syncStatusBar() {
  refreshZoomLabel();
  el.statusCount.textContent = `${state.elements.length} 个元素`;
  if (state.selection.size) {
    el.statusSel.hidden = false;
    el.statusSel.textContent = `已选 ${state.selection.size}`;
  } else {
    el.statusSel.hidden = true;
  }
  const p = state.interaction.pointer;
  el.statusCoord.textContent = p ? `${Math.round(p.x)}, ${Math.round(p.y)}` : '—, —';
}

function markDirty() {
  saveState = 'dirty';
  el.statusSave.textContent = '保存中…';
  el.statusSave.classList.add('is-dirty');
  saveLocal();
}

function markSaved() {
  if (saveState === 'saved') return;
  saveState = 'saved';
  el.statusSave.textContent = '已保存';
  el.statusSave.classList.remove('is-dirty');
}

/* ---------------------------------------------------------------- 文件导入 */

function bindImport() {
  el.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = importJSONText(text);
      commit('导入');
      fitToContent(60, true);
      toast(`已导入 ${count} 个元素`, 'ok');
    } catch (err) {
      console.error(err);
      toast(`导入失败：${err.message}`, 'err', 3600);
    } finally {
      el.fileInput.value = '';
    }
  });

  // 拖拽文件到画板
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.(wb)?json$/i.test(file.name)) {
      toast('只支持 .wbjson / .json 工程文件', 'err');
      return;
    }
    try {
      const count = importJSONText(await file.text());
      commit('导入');
      fitToContent(60, true);
      toast(`已导入 ${count} 个元素`, 'ok');
    } catch (err) {
      toast(`导入失败：${err.message}`, 'err', 3600);
    }
  });
}

/* ------------------------------------------------------------------ 初始化 */

export function initUI() {
  restoreUI();
  buildTools();
  buildSwatches();
  buildMathPanel();
  buildExamples();
  buildHelp();
  bindStyleInputs();
  bindView();
  bindSession();
  bindMenu();
  bindShortcuts();
  bindImport();
  makeDraggable(el.toolbar);
  makeDraggable(el.stylebar);
  makeDraggable(el.mathPanel);

  $('btnCollapseTools').addEventListener('click', toggleTools);
  $('btnMath').addEventListener('click', () => toggleMathPanel());
  $('btnCloseMath').addEventListener('click', () => toggleMathPanel(false));
  $('btnUndo').addEventListener('click', () => { undo(); requestRender(); markDirty(); });
  $('btnRedo').addEventListener('click', () => { redo(); requestRender(); markDirty(); });

  el.quickActions?.addEventListener?.('click', () => {});
  document.getElementById('quickActions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick]');
    if (!btn) return;
    switch (btn.dataset.quick) {
      case 'undo': undo(); requestRender(); markDirty(); break;
      case 'redo': redo(); requestRender(); markDirty(); break;
      case 'duplicate': duplicateSelection(); break;
      case 'front': reorderSelection('front'); break;
      case 'back': reorderSelection('back'); break;
      case 'delete': deleteSelection(); break;
      default: break;
    }
  });

  el.texInput.addEventListener('input', updateTexPreview);
  el.texInsert.addEventListener('click', () => {
    const raw = el.texInput.value;
    if (!raw.trim()) return;
    const text = texToUnicode(raw);
    if (!insertIntoEditor(text)) placeFormula(text);
    el.texInput.value = '';
    updateTexPreview();
  });
  el.texInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.texInsert.click();
    e.stopPropagation();
  });

  onToolChange(() => {
    refreshToolUI();
    persistUI();
  });

  onHistoryChange(() => {
    $('btnUndo').disabled = !canUndo();
    $('btnRedo').disabled = !canRedo();
    markDirty();
  });

  onPaint(syncStatusBar);

  // 定期把“保存中”落盘并复位
  setInterval(() => {
    if (saveState === 'dirty' && writeLocal()) markSaved();
    tickClock();
  }, 500);

  window.addEventListener('beforeunload', () => saveLocalNow());

  refreshToolUI();
  refreshStyleUI();
  syncStatusBar();
  tickClock();
}

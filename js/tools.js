/**
 * tools.js —— 指针交互状态机
 * 负责：绘制、平移、缩放、框选、移动、缩放元素、橡皮擦、激光笔
 */

import {
  state,
  screenToWorld,
  zoomAt,
  panBy,
  setScale,
  selectedElements,
  clearSelection,
  MIN_SCALE,
  MAX_SCALE,
} from './state.js';
import {
  createStroke,
  addPoint,
  finalizeStroke,
  createShape,
  createNote,
  duplicateElements,
  eraseFromStroke,
  POINT_TOOLS,
  SHAPE_TOOLS,
} from './model.js';
import {
  pickElement,
  elementsInRect,
  elementBBox,
  bboxFromPoints,
  scaleElementToBBox,
  translateElement,
  hitTestElement,
} from './geometry.js';
import { commit } from './history.js';
import { requestRender, handlesFor } from './renderer.js';
import { isEditing } from './editor.js';
import { clamp, dist, nowMs, deepClone } from './utils.js';

/** 工具清单（UI 与快捷键共用） */
export const TOOL_LIST = [
  { id: 'select', name: '选择', icon: 'i-select', key: 'V', hint: '框选 / 移动 / 缩放元素，双击文字可编辑' },
  { id: 'hand', name: '抓手', icon: 'i-hand', key: 'H', hint: '拖动平移画布（等同按住 Space）' },
  { id: 'pen', name: '钢笔', icon: 'i-pen', key: 'P', hint: '自由书写，支持压感与书写速度' },
  { id: 'highlighter', name: '荧光笔', icon: 'i-highlighter', key: 'Y', hint: '半透明标记，叠加不加深' },
  { id: 'eraser', name: '橡皮', icon: 'i-eraser', key: 'E', hint: '擦除笔迹（可只擦掉一段）或整个图形' },
  { id: 'line', name: '直线', icon: 'i-line', key: 'L', hint: '按住 Shift 画水平/垂直线' },
  { id: 'arrow', name: '箭头', icon: 'i-arrow', key: 'A', hint: '按住 Shift 约束角度' },
  { id: 'rect', name: '矩形', icon: 'i-rect', key: 'R', hint: '按住 Shift 画正方形' },
  { id: 'ellipse', name: '椭圆', icon: 'i-ellipse', key: 'O', hint: '按住 Shift 画正圆' },
  { id: 'text', name: '文字', icon: 'i-text', key: 'T', hint: '点击落字，Esc 结束编辑' },
  { id: 'note', name: '便签', icon: 'i-note', key: 'N', hint: '拖出便签，双击可再次编辑' },
  { id: 'laser', name: '激光笔', icon: 'i-laser', key: 'Z', hint: '演示用，轨迹自动消失，不写入文档' },
];

const ERASE_SCREEN_RADIUS = 13;

let canvas = null;
let drag = null;
const pointers = new Map();
const toolListeners = new Set();
let openTextEditor = null; // 由 editor.js 注入，避免循环依赖

export function setEditorOpener(fn) {
  openTextEditor = fn;
}

export function onToolChange(fn) {
  toolListeners.add(fn);
  return () => toolListeners.delete(fn);
}

export function setTool(id) {
  if (!TOOL_LIST.some((t) => t.id === id)) return;
  if (state.tool === id) return;
  state.tool = id;
  if (id !== 'select') clearSelection();
  updateCursor();
  toolListeners.forEach((fn) => fn(id));
  requestRender();
}

export function updateCursor() {
  if (!canvas) return;
  const map = {
    select: 'select',
    hand: state.interaction.panning ? 'handing' : 'hand',
    eraser: 'eraser',
    text: 'text',
    note: 'text',
  };
  canvas.dataset.cursor = map[state.tool] || (state.interaction.spaceDown ? 'hand' : 'crosshair');
}

/* ------------------------------------------------------------ 坐标换算 */

function toScreen(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function sessionTime() {
  const s = state.session;
  if (!s.recording) return s.elapsed;
  return s.elapsed + (nowMs() - s.startedAt);
}

/* -------------------------------------------------------------- 橡皮擦 */

function eraseAt(wx, wy) {
  const r = ERASE_SCREEN_RADIUS / state.camera.scale;
  const hit = pickElement(state.elements, wx, wy, r);
  if (!hit) return false;
  if (POINT_TOOLS.has(hit.type)) {
    const { removed, pieces } = eraseFromStroke(hit, wx, wy, r);
    if (!removed) return false;
    const i = state.elements.indexOf(hit);
    state.elements.splice(i, 1, ...pieces);
    state.selection.delete(hit.id);
  } else {
    const i = state.elements.indexOf(hit);
    if (i < 0) return false;
    state.elements.splice(i, 1);
    state.selection.delete(hit.id);
  }
  return true;
}

/* ------------------------------------------------------------ 选择相关 */

export function deleteSelection() {
  if (!state.selection.size) return false;
  const ids = new Set(state.selection);
  const before = state.elements.length;
  state.elements = state.elements.filter((el) => !ids.has(el.id));
  state.selection.clear();
  if (state.elements.length !== before) commit('删除');
  requestRender();
  return true;
}

export function duplicateSelection() {
  const list = selectedElements();
  if (!list.length) return [];
  const copies = duplicateElements(list);
  state.elements.push(...copies);
  state.selection = new Set(copies.map((el) => el.id));
  commit('复制');
  requestRender();
  return copies;
}

export function nudgeSelection(dx, dy) {
  const list = selectedElements();
  if (!list.length) return;
  for (const el of list) {
    translateElement(el, dx, dy);
    el.meta = null;
  }
  commit('微调');
  requestRender();
}

export function selectAll() {
  state.selection = new Set(state.elements.map((el) => el.id));
  requestRender();
}

export function reorderSelection(mode) {
  const list = selectedElements();
  if (!list.length) return;
  const ids = new Set(list.map((el) => el.id));
  const rest = state.elements.filter((el) => !ids.has(el.id));
  state.elements = mode === 'front' ? [...rest, ...list] : [...list, ...rest];
  commit(mode === 'front' ? '置顶' : '置底');
  requestRender();
}

export function applyStyleToSelection(partial) {
  const list = selectedElements();
  if (!list.length) return;
  for (const el of list) {
    Object.assign(el, partial);
    el.meta = null;
  }
  commit('样式');
  requestRender();
}

/** 命中缩放手柄，返回 {el, handle} */
function pickHandle(sx, sy) {
  if (state.selection.size !== 1) return null;
  const el = selectedElements()[0];
  for (const h of handlesFor(el)) {
    if (Math.abs(h.x - sx) <= 8 && Math.abs(h.y - sy) <= 8) return { el, handle: h.id };
  }
  return null;
}

/* ---------------------------------------------------------------- 指针 */

function onPointerDown(e) {
  if (!canvas) return;
  canvas.setPointerCapture?.(e.pointerId);
  const sp = toScreen(e);
  const wp = screenToWorld(sp.x, sp.y);
  pointers.set(e.pointerId, sp);

  // 双指 → 捏合缩放
  if (pointers.size === 2) {
    drag = { mode: 'pinch', ...pinchState() };
    return;
  }

  const wantPan =
    state.tool === 'hand' ||
    state.interaction.spaceDown ||
    state.interaction.altDown ||
    e.button === 1 ||
    (e.button === 2 && state.tool !== 'select');

  if (wantPan) {
    drag = { mode: 'pan', last: sp };
    state.interaction.panning = true;
    updateCursor();
    return;
  }
  if (e.button !== 0) return;

  const tool = state.tool;

  if (tool === 'select') {
    const handle = pickHandle(sp.x, sp.y);
    if (handle) {
      drag = {
        mode: 'resize',
        handle: handle.handle,
        el: handle.el,
        origin: deepClone(handle.el),
        bbox: elementBBox(handle.el),
        start: wp,
        moved: false,
      };
      return;
    }
    const hit = pickElement(state.elements, wp.x, wp.y, 7 / state.camera.scale);
    if (hit) {
      if (e.shiftKey) {
        if (state.selection.has(hit.id)) state.selection.delete(hit.id);
        else state.selection.add(hit.id);
      } else if (!state.selection.has(hit.id)) {
        state.selection = new Set([hit.id]);
      }
      drag = { mode: 'move', start: wp, moved: false };
      requestRender();
      return;
    }
    if (!e.shiftKey) clearSelection();
    drag = { mode: 'marquee', start: wp, additive: e.shiftKey };
    state.interaction.marquee = { x: wp.x, y: wp.y, w: 0, h: 0 };
    requestRender();
    return;
  }

  if (tool === 'eraser') {
    drag = { mode: 'erase', changed: false };
    if (eraseAt(wp.x, wp.y)) drag.changed = true;
    requestRender();
    return;
  }

  if (tool === 'laser') {
    drag = { mode: 'laser', beam: { born: nowMs(), points: [wp] } };
    state.laser.push(drag.beam);
    keepAnimating();
    return;
  }

  if (POINT_TOOLS.has(tool)) {
    const el = createStroke(tool, state.style, { x: wp.x, y: wp.y, p: pressureOf(e) }, sessionTime());
    state.elements.push(el);
    drag = { mode: 'draw', el, start: sessionTime() };
    requestRender();
    return;
  }

  if (SHAPE_TOOLS.has(tool)) {
    const start = state.board.snap ? snapPoint(wp) : wp;
    const el = createShape(tool, start, { ...start }, state.style, sessionTime());
    state.elements.push(el);
    drag = { mode: 'shape', el, start };
    requestRender();
    return;
  }

  if (tool === 'note') {
    drag = { mode: 'note', start: wp };
    return;
  }

  if (tool === 'text') {
    drag = { mode: 'idle' };
    startTextAt(wp);
    return;
  }

  drag = { mode: 'idle' };
}

function pressureOf(e) {
  if (e.pointerType === 'pen' && e.pressure > 0) return clamp(e.pressure * 1.25, 0.15, 1);
  return 0.55;
}

function snapPoint(p) {
  const g = state.board.gridSize;
  return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
}

function pinchState() {
  const [a, b] = [...pointers.values()];
  return {
    dist: dist(a.x, a.y, b.x, b.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    scale: state.camera.scale,
  };
}

function onPointerMove(e) {
  const sp = toScreen(e);
  const wp = screenToWorld(sp.x, sp.y);
  state.interaction.pointer = wp;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sp);

  if (drag?.mode === 'pinch' && pointers.size === 2) {
    const next = pinchState();
    const factor = next.dist / Math.max(1, drag.dist);
    setScale(drag.scale * factor, drag.mid.x, drag.mid.y);
    panBy(next.mid.x - drag.mid.x, next.mid.y - drag.mid.y);
    requestRender();
    return;
  }

  if (!drag) {
    // 悬停：选择工具下显示可拖动/可缩放光标
    if (state.tool === 'select' && !state.interaction.spaceDown) {
      const handle = pickHandle(sp.x, sp.y);
      const hit = !handle && pickElement(state.elements, wp.x, wp.y, 7 / state.camera.scale);
      const next = handle ? 'move' : hit ? 'move' : 'select';
      if (canvas.dataset.cursor !== next) canvas.dataset.cursor = next;
    }
    return;
  }

  switch (drag.mode) {
    case 'pan': {
      panBy(sp.x - drag.last.x, sp.y - drag.last.y);
      drag.last = sp;
      requestRender();
      break;
    }
    case 'draw': {
      addPoint(drag.el, wp.x, wp.y, pressureOf(e), sessionTime() - drag.start);
      requestRender();
      break;
    }
    case 'erase': {
      if (eraseAt(wp.x, wp.y)) drag.changed = true;
      requestRender();
      break;
    }
    case 'shape': {
      let end = state.board.snap ? snapPoint(wp) : wp;
      if (e.shiftKey) end = constrainShape(drag.el.type, drag.start, end);
      drag.el.b = end;
      requestRender();
      break;
    }
    case 'move': {
      const dx = wp.x - drag.start.x;
      const dy = wp.y - drag.start.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) drag.moved = true;
      if (!drag.moved) break;
      for (const el of selectedElements()) {
        translateElement(el, dx, dy);
        el.meta = null;
      }
      drag.start = wp;
      requestRender();
      break;
    }
    case 'marquee': {
      const rect = bboxFromPoints(drag.start, wp);
      state.interaction.marquee = rect;
      const found = elementsInRect(state.elements, rect, 'intersect');
      const ids = new Set(found.map((el) => el.id));
      if (drag.additive) {
        for (const id of ids) state.selection.add(id);
      } else {
        state.selection = ids;
      }
      requestRender();
      break;
    }
    case 'resize': {
      applyResize(wp);
      requestRender();
      break;
    }
    case 'laser': {
      drag.beam.points.push(wp);
      requestRender();
      break;
    }
    case 'note': {
      drag.current = wp;
      state.interaction.marquee = bboxFromPoints(drag.start, wp);
      requestRender();
      break;
    }
    default:
      break;
  }
}

function constrainShape(type, a, b) {
  if (type === 'line' || type === 'arrow') {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 12; // 15°
    const snapped = Math.round(angle / step) * step;
    const len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
  }
  const size = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return {
    x: a.x + Math.sign(b.x - a.x || 1) * size,
    y: a.y + Math.sign(b.y - a.y || 1) * size,
  };
}

function applyResize(wp) {
  const { el, origin, bbox, handle } = drag;
  if (el.type === 'line' || el.type === 'arrow') {
    const target = handle === 'a' ? 'a' : 'b';
    const next = deepClone(origin);
    next[target] = state.board.snap ? snapPoint(wp) : { x: wp.x, y: wp.y };
    Object.assign(el, next);
    drag.moved = true;
    return;
  }
  if (!bbox) return;
  const x1 = bbox.x;
  const y1 = bbox.y;
  const x2 = bbox.x + bbox.w;
  const y2 = bbox.y + bbox.h;
  let nx1 = x1;
  let ny1 = y1;
  let nx2 = x2;
  let ny2 = y2;
  if (handle.includes('w')) nx1 = wp.x;
  if (handle.includes('e')) nx2 = wp.x;
  if (handle.includes('n')) ny1 = wp.y;
  if (handle.includes('s')) ny2 = wp.y;
  const target = bboxFromPoints({ x: nx1, y: ny1 }, { x: nx2, y: ny2 });
  if (target.w < 4 || target.h < 4) return;
  const next = deepClone(origin);
  scaleElementToBBox(next, bbox, target);
  // 只覆盖几何字段，保留 id 等
  for (const key of ['points', 'a', 'b', 'x', 'y', 'w', 'h', 'fontSize', 'maxW', 'meta']) {
    if (key in next) el[key] = next[key];
  }
  drag.moved = true;
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  canvas?.releasePointerCapture?.(e.pointerId);
  if (state.interaction.panning && pointers.size === 0) {
    state.interaction.panning = false;
    updateCursor();
  }
  if (!drag) return;

  switch (drag.mode) {
    case 'draw': {
      finalizeStroke(drag.el, sessionTime());
      // 只有一个点也保留（点一下就是一个点）
      commit('绘制');
      break;
    }
    case 'shape': {
      const len = dist(drag.el.a.x, drag.el.a.y, drag.el.b.x, drag.el.b.y);
      if (len < 2) {
        state.elements.pop(); // 误点，丢弃
      } else {
        drag.el.dur = 0;
        commit('图形');
        state.selection = new Set([drag.el.id]);
        setTool('select');
      }
      break;
    }
    case 'erase': {
      if (drag.changed) commit('擦除');
      break;
    }
    case 'move': {
      if (drag.moved) commit('移动');
      break;
    }
    case 'resize': {
      if (drag.moved) commit('缩放');
      break;
    }
    case 'marquee': {
      state.interaction.marquee = null;
      break;
    }
    case 'note': {
      state.interaction.marquee = null;
      const box = drag.current ? bboxFromPoints(drag.start, drag.current) : null;
      const w = box && box.w > 60 ? Math.round(box.w) : 180;
      const h = box && box.h > 48 ? Math.round(box.h) : 140;
      const el = createNote(drag.start.x, drag.start.y, state.style, '', w, h, sessionTime());
      // 不在这里提交：编辑器关闭时才写入历史，避免空便签留下记录
      state.elements.push(el);
      state.selection = new Set([el.id]);
      openTextEditor?.(el, true);
      break;
    }
    case 'laser': {
      drag.beam.born = drag.beam.born; // 保持出生时间
      break;
    }
    default:
      break;
  }
  drag = null;
  requestRender();
}

function onPointerCancel(e) {
  pointers.delete(e.pointerId);
  if (drag?.mode === 'draw' || drag?.mode === 'shape') {
    const el = drag.el;
    const i = state.elements.indexOf(el);
    if (i >= 0) state.elements.splice(i, 1);
  }
  drag = null;
  state.interaction.marquee = null;
  requestRender();
  void e;
}

/* -------------------------------------------------------------- 滚轮缩放 */

function onWheel(e) {
  e.preventDefault();
  const sp = toScreen(e);
  if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
    panBy(-e.deltaY, 0);
    requestRender();
    return;
  }
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const delta = e.deltaY * unit;
  const factor = Math.exp(-delta * 0.0016);
  zoomAt(factor, sp.x, sp.y);
  requestRender();
}

/* ------------------------------------------------------------ 双击编辑 */

function onDblClick(e) {
  const sp = toScreen(e);
  const wp = screenToWorld(sp.x, sp.y);
  const hit = pickElement(state.elements, wp.x, wp.y, 8 / state.camera.scale);
  if (hit && (hit.type === 'text' || hit.type === 'note')) {
    openTextEditor?.(hit, false);
    return;
  }
  if (!hit) {
    setTool('text');
    startTextAt(wp);
  }
}

function startTextAt(wp) {
  const el = {
    id: `tmp-${Date.now().toString(36)}`,
    type: 'text',
    x: wp.x,
    y: wp.y,
    text: '',
    color: state.style.color,
    opacity: state.style.opacity,
    fontSize: state.style.fontSize,
    fontFamily: state.style.fontFamily,
    align: 'left',
    meta: null,
    t: sessionTime(),
    dur: 0,
    pending: true,
  };
  openTextEditor?.(el, true);
}

/* ------------------------------------------------------------ 激光清理 */

let animating = false;
function keepAnimating() {
  if (animating) return;
  animating = true;
  const tick = () => {
    const now = nowMs();
    state.laser = state.laser.filter((b) => now - b.born < 900);
    requestRender();
    if (state.laser.length) requestAnimationFrame(tick);
    else animating = false;
  };
  requestAnimationFrame(tick);
}

/* -------------------------------------------------------------- 缩放 API */

export function zoomBy(factor) {
  const { w, h } = state.viewport;
  const s = zoomAt(factor, w / 2, h / 2);
  requestRender();
  return s;
}

export function zoomTo(scale) {
  const s = setScale(scale);
  requestRender();
  return s;
}

export function clampScaleValue(s) {
  return clamp(s, MIN_SCALE, MAX_SCALE);
}

export function hitTestAt(wx, wy) {
  return pickElement(state.elements, wx, wy, 8 / state.camera.scale);
}

export function isPointOnElement(el, wx, wy) {
  return hitTestElement(el, wx, wy, 8 / state.camera.scale);
}

/* ------------------------------------------------------------------ 初始化 */

export function initTools(canvasEl) {
  canvas = canvasEl;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', () => {
    state.interaction.pointer = null;
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  // 文字/便签工具或正在编辑时，阻止 mousedown 的默认行为把焦点从输入框抢回画布
  canvas.addEventListener('mousedown', (e) => {
    if (state.tool === 'text' || state.tool === 'note' || isEditing()) e.preventDefault();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  updateCursor();
}

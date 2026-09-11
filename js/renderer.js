/**
 * renderer.js —— Canvas 渲染
 * 场景 = 背景 + 网格 + 元素 + 选择框 + 激光笔
 */

import { state, worldToScreen } from './state.js';
import { elementBBox, bboxFromPoints, inflate } from './geometry.js';
import { ensureLayout, drawTextBlock, notePadding } from './text.js';
import { strokeWidth } from './model.js';
import { withAlpha, roundRectPath, clamp, luminance } from './utils.js';

let canvas = null;
let ctx = null;
let scheduled = false;
const paintListeners = new Set();

/** 订阅每帧绘制完成（UI 用它同步状态栏，避免常驻 rAF） */
export function onPaint(fn) {
  paintListeners.add(fn);
  return () => paintListeners.delete(fn);
}

export function initRenderer(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d', { alpha: false });
  resizeRenderer();
}

/** 按视口与 DPR 重设画布尺寸 */
export function resizeRenderer() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  state.viewport = { w, h, dpr };
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  requestRender();
}

export function requestRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    paint();
  });
}

export function getCtx() {
  return ctx;
}

/* ------------------------------------------------------------------ 网格 */

function drawGrid(ctx2, view, camera, board) {
  if (board.grid === 'none') return;
  const base = board.gridSize || 24;
  let step = base;
  while (step * camera.scale < 11) step *= 5;
  const s = step * camera.scale;
  if (s < 2) return;

  const offsetX = ((camera.x % s) + s) % s;
  const offsetY = ((camera.y % s) + s) % s;
  ctx2.fillStyle = board.gridColor;
  ctx2.strokeStyle = board.gridColor;

  if (board.grid === 'dots') {
    const r = clamp(s * 0.045, 0.6, 2.2);
    for (let x = offsetX; x < view.w + s; x += s) {
      for (let y = offsetY; y < view.h + s; y += s) {
        ctx2.beginPath();
        ctx2.arc(x, y, r, 0, Math.PI * 2);
        ctx2.fill();
      }
    }
  } else {
    ctx2.lineWidth = 1;
    ctx2.globalAlpha = 0.7;
    ctx2.beginPath();
    for (let x = offsetX; x < view.w + s; x += s) {
      ctx2.moveTo(Math.round(x) + 0.5, 0);
      ctx2.lineTo(Math.round(x) + 0.5, view.h);
    }
    for (let y = offsetY; y < view.h + s; y += s) {
      ctx2.moveTo(0, Math.round(y) + 0.5);
      ctx2.lineTo(view.w, Math.round(y) + 0.5);
    }
    ctx2.stroke();
    ctx2.globalAlpha = 1;
  }
}

/* ---------------------------------------------------------------- 元素绘制 */

/** 回放裁剪：返回该元素此刻可见的点数（null 表示全部可见） */
function visiblePointCount(el, cut) {
  if (cut == null) return null;
  if (el.t == null) return el.points?.length ?? null;
  if (cut < el.t) return 0;
  if (cut >= el.t + (el.dur ?? 0)) return el.points?.length ?? null;
  const rel = cut - el.t;
  let n = 0;
  const times = el.times ?? [];
  while (n < times.length && times[n] <= rel) n++;
  return Math.max(1, n);
}

function drawStroke(ctx2, el, cut) {
  const pts = el.points;
  if (!pts || !pts.length) return;
  const count = visiblePointCount(el, cut) ?? pts.length;
  const n = Math.min(count, pts.length);
  if (n === 0) return;

  const isHighlighter = el.type === 'highlighter';
  ctx2.save();
  ctx2.globalAlpha = el.opacity ?? 1;
  if (isHighlighter) ctx2.globalCompositeOperation = 'multiply';
  ctx2.strokeStyle = el.color;
  ctx2.lineCap = 'round';
  ctx2.lineJoin = 'round';

  if (n === 1) {
    ctx2.fillStyle = el.color;
    ctx2.beginPath();
    ctx2.arc(pts[0].x, pts[0].y, Math.max(0.6, strokeWidth(el, 0) / 2), 0, Math.PI * 2);
    ctx2.fill();
    ctx2.restore();
    return;
  }

  for (let i = 1; i < n; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const p0 = i === 1 ? prev : { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
    const next = pts[i + 1];
    const p1 = !next || i + 1 >= n ? cur : { x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2 };
    ctx2.beginPath();
    ctx2.moveTo(p0.x, p0.y);
    ctx2.quadraticCurveTo(cur.x, cur.y, p1.x, p1.y);
    ctx2.lineWidth = strokeWidth(el, i);
    ctx2.stroke();
  }
  ctx2.restore();
}

function drawShape(ctx2, el) {
  ctx2.save();
  ctx2.globalAlpha = el.opacity ?? 1;
  ctx2.strokeStyle = el.color;
  ctx2.fillStyle = el.color;
  ctx2.lineWidth = el.size;
  ctx2.lineCap = 'round';
  ctx2.lineJoin = 'round';

  if (el.type === 'line' || el.type === 'arrow') {
    const { a, b } = el;
    ctx2.beginPath();
    ctx2.moveTo(a.x, a.y);
    ctx2.lineTo(b.x, b.y);
    ctx2.stroke();
    if (el.type === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(10, el.size * 4.2);
      const spread = Math.PI / 7;
      ctx2.beginPath();
      ctx2.moveTo(b.x, b.y);
      ctx2.lineTo(b.x - head * Math.cos(angle - spread), b.y - head * Math.sin(angle - spread));
      ctx2.lineTo(b.x - head * 0.62 * Math.cos(angle), b.y - head * 0.62 * Math.sin(angle));
      ctx2.lineTo(b.x - head * Math.cos(angle + spread), b.y - head * Math.sin(angle + spread));
      ctx2.closePath();
      ctx2.fill();
    }
    ctx2.restore();
    return;
  }

  const box = bboxFromPoints(el.a, el.b);
  if (el.type === 'rect') {
    const r = Math.min(6, Math.min(box.w, box.h) / 6);
    ctx2.beginPath();
    roundRectPath(ctx2, box.x, box.y, box.w, box.h, r);
    if (el.fill) ctx2.fill();
    ctx2.stroke();
  } else if (el.type === 'ellipse') {
    ctx2.beginPath();
    ctx2.ellipse(
      box.x + box.w / 2,
      box.y + box.h / 2,
      Math.abs(box.w / 2),
      Math.abs(box.h / 2),
      0,
      0,
      Math.PI * 2
    );
    if (el.fill) ctx2.fill();
    ctx2.stroke();
  }
  ctx2.restore();
}

function drawNote(ctx2, el) {
  const meta = ensureLayout(el, ctx2);
  const w = el.w ?? 180;
  const h = el.h ?? 140;
  ctx2.save();
  ctx2.globalAlpha = el.opacity ?? 1;
  ctx2.shadowColor = 'rgba(15, 23, 42, 0.22)';
  ctx2.shadowBlur = 12;
  ctx2.shadowOffsetY = 4;
  ctx2.fillStyle = el.noteColor || '#fff3a3';
  ctx2.beginPath();
  roundRectPath(ctx2, el.x, el.y, w, h, 6);
  ctx2.fill();
  ctx2.shadowColor = 'transparent';
  ctx2.shadowBlur = 0;
  ctx2.shadowOffsetY = 0;
  // 顶部色条
  ctx2.fillStyle = 'rgba(0,0,0,0.06)';
  ctx2.fillRect(el.x, el.y, w, 4);
  drawTextBlock(ctx2, el, meta, { x: el.x + notePadding, y: el.y + notePadding + 4 });
  ctx2.restore();
}

function drawText(ctx2, el) {
  const meta = ensureLayout(el, ctx2);
  ctx2.save();
  ctx2.globalAlpha = el.opacity ?? 1;
  drawTextBlock(ctx2, el, meta);
  ctx2.restore();
}

export function drawElement(ctx2, el, cut = null) {
  if (el.hidden) return;
  switch (el.type) {
    case 'pen':
    case 'highlighter':
      drawStroke(ctx2, el, cut);
      break;
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      drawShape(ctx2, el);
      break;
    case 'note':
      drawNote(ctx2, el);
      break;
    case 'text':
      drawText(ctx2, el);
      break;
    default:
      break;
  }
}

/* -------------------------------------------------------------- 选择装饰 */

function drawSelection(ctx2, view) {
  const selected = state.elements.filter((el) => state.selection.has(el.id));
  if (!selected.length) return;
  const { scale } = state.camera;
  ctx2.save();
  ctx2.strokeStyle = '#2563eb';
  ctx2.fillStyle = '#2563eb';
  ctx2.lineWidth = 1.4;
  ctx2.setLineDash([5, 4]);

  for (const el of selected) {
    const bb = elementBBox(el);
    if (!bb) continue;
    const p1 = worldToScreen(bb.x, bb.y);
    const p2 = worldToScreen(bb.x + bb.w, bb.y + bb.h);
    ctx2.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  }
  ctx2.setLineDash([]);

  // 单个元素时画缩放手柄
  if (selected.length === 1) {
    const el = selected[0];
    const handles = handlesFor(el);
    for (const h of handles) {
      ctx2.beginPath();
      ctx2.rect(h.x - 4.5, h.y - 4.5, 9, 9);
      ctx2.fillStyle = '#fff';
      ctx2.fill();
      ctx2.stroke();
    }
  }
  void scale;
  void view;
  ctx2.restore();
}

/** 缩放手柄（屏幕坐标） */
export function handlesFor(el) {
  if (el.type === 'line' || el.type === 'arrow') {
    const a = worldToScreen(el.a.x, el.a.y);
    const b = worldToScreen(el.b.x, el.b.y);
    return [
      { id: 'a', x: a.x, y: a.y },
      { id: 'b', x: b.x, y: b.y },
    ];
  }
  const bb = elementBBox(el);
  if (!bb || el.type === 'pen' || el.type === 'highlighter') return [];
  const p1 = worldToScreen(bb.x, bb.y);
  const p2 = worldToScreen(bb.x + bb.w, bb.y + bb.h);
  return [
    { id: 'nw', x: p1.x, y: p1.y },
    { id: 'ne', x: p2.x, y: p1.y },
    { id: 'sw', x: p1.x, y: p2.y },
    { id: 'se', x: p2.x, y: p2.y },
  ];
}

function drawMarquee(ctx2) {
  const m = state.interaction.marquee;
  if (!m) return;
  const p1 = worldToScreen(m.x, m.y);
  const p2 = worldToScreen(m.x + m.w, m.y + m.h);
  ctx2.save();
  ctx2.fillStyle = 'rgba(37, 99, 235, 0.10)';
  ctx2.strokeStyle = '#2563eb';
  ctx2.lineWidth = 1;
  ctx2.setLineDash([4, 3]);
  ctx2.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  ctx2.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  ctx2.restore();
}

function drawLaser(ctx2, now) {
  if (!state.laser.length) return;
  ctx2.save();
  ctx2.lineCap = 'round';
  ctx2.lineJoin = 'round';
  ctx2.globalCompositeOperation = 'lighter';
  for (const beam of state.laser) {
    const age = now - beam.born;
    const life = 700;
    if (age > life) continue;
    const alpha = 1 - age / life;
    ctx2.strokeStyle = withAlpha('#ef4444', alpha * 0.9);
    ctx2.lineWidth = 4;
    ctx2.beginPath();
    beam.points.forEach((p, i) => (i ? ctx2.lineTo(p.x, p.y) : ctx2.moveTo(p.x, p.y)));
    ctx2.stroke();
  }
  ctx2.restore();
}

/* ------------------------------------------------------------------ 主帧 */

export function paint() {
  if (!ctx) return;
  const view = state.viewport;
  paintScene(ctx, {
    view,
    dpr: view.dpr,
    canvasW: canvas.width,
    canvasH: canvas.height,
    elements: state.elements,
    camera: state.camera,
    board: state.board,
    grid: true,
    overlay: true,
    cut: state.playback.active ? state.playback.t : null,
    now: performance.now(),
  });
  paintListeners.forEach((fn) => fn());
}

/**
 * 通用绘制入口，导出图片时复用。
 * @param {CanvasRenderingContext2D} ctx2
 */
export function paintScene(
  ctx2,
  { view, dpr = 1, canvasW, canvasH, elements, camera, board, grid = false, overlay = false, cut = null, now = 0 }
) {
  const W = canvasW ?? Math.round(view.w * dpr);
  const H = canvasH ?? Math.round(view.h * dpr);

  ctx2.setTransform(1, 0, 0, 1, 0, 0);
  ctx2.fillStyle = board.color;
  ctx2.fillRect(0, 0, W, H);

  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (grid) drawGrid(ctx2, view, camera, board);

  // 世界坐标系
  ctx2.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.x, dpr * camera.y);
  for (const el of elements) drawElement(ctx2, el, cut);

  // 覆盖层（屏幕坐标系）
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (overlay) {
    drawSelection(ctx2, view);
    drawMarquee(ctx2);
    drawLaser(ctx2, now);
  }
}

/** 板面是否偏暗（用于自动选择网格与 UI 主题） */
export const isDarkBoard = () => luminance(state.board.color) < 0.45;

/** 让内容适配视口，返回新的 scale */
export function fitToContent(padding = 48, animate = false) {
  const boxes = state.elements.map((el) => elementBBox(el)).filter(Boolean);
  const view = state.viewport;
  if (!boxes.length) {
    state.camera.scale = 1;
    state.camera.x = 0;
    state.camera.y = 0;
    requestRender();
    return 1;
  }
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);
  const scale = clamp(
    Math.min((view.w - padding * 2) / w, (view.h - padding * 2) / h),
    0.1,
    4
  );
  const target = {
    scale,
    x: view.w / 2 - ((x1 + x2) / 2) * scale,
    y: view.h / 2 - ((y1 + y2) / 2) * scale,
  };
  if (!animate) {
    Object.assign(state.camera, target);
    requestRender();
    return scale;
  }
  const from = { ...state.camera };
  const start = performance.now();
  const dur = 260;
  const step = (t) => {
    const k = clamp((t - start) / dur, 0, 1);
    const e = 1 - (1 - k) ** 3;
    state.camera.scale = from.scale + (target.scale - from.scale) * e;
    state.camera.x = from.x + (target.x - from.x) * e;
    state.camera.y = from.y + (target.y - from.y) * e;
    requestRender();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return scale;
}

/** 内容包围盒（世界坐标），无内容返回 null */
export function contentBBox(elements = state.elements, pad = 24) {
  const boxes = elements.map((el) => elementBBox(el)).filter(Boolean);
  if (!boxes.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return inflate({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, pad);
}

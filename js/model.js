/**
 * model.js —— 元素模型：创建、增点、橡皮擦分割、复制
 */

import { uid, dist, clamp, deepClone } from './utils.js';

/** 两点小于该距离（世界坐标）时不再记录，避免抖动产生海量点 */
const MIN_SEGMENT = 0.75;

export const POINT_TOOLS = new Set(['pen', 'highlighter']);
export const SHAPE_TOOLS = new Set(['line', 'arrow', 'rect', 'ellipse']);
export const TEXT_TOOLS = new Set(['text', 'note']);

/** 便签预设色 */
export const NOTE_COLORS = ['#fff3a3', '#ffd6a5', '#caffbf', '#a5d8ff', '#e6c9ff', '#ffc9de'];

export function styleSnapshot(style) {
  return {
    color: style.color,
    size: style.size,
    opacity: style.opacity,
    fill: !!style.fill,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    noteColor: style.noteColor,
  };
}

/** 创建笔迹元素 */
export function createStroke(type, style, point, t) {
  const el = {
    id: uid('s'),
    type, // pen | highlighter
    color: style.color,
    size: type === 'highlighter' ? Math.max(style.size * 3, 10) : style.size,
    opacity: type === 'highlighter' ? Math.min(style.opacity, 0.42) : style.opacity,
    points: [],
    times: [],
    t: t ?? 0,
    dur: 0,
  };
  addPoint(el, point.x, point.y, point.p, 0);
  return el;
}

/**
 * 追加一个点。压力 + 速度共同决定该点粗细（存归一化权重 0..1）。
 * 返回是否真的记录了新点。
 */
export function addPoint(el, x, y, pressure, tRel) {
  const pts = el.points;
  const last = pts[pts.length - 1];
  if (last) {
    const d = dist(x, y, last.x, last.y);
    if (d < MIN_SEGMENT) return false;
    // 速度越快线越细（模拟真实书写）
    const dt = Math.max(1, tRel - (el.times[el.times.length - 1] ?? 0));
    const speed = d / dt; // 世界单位 / ms
    const speedFactor = clamp(1 - speed * 0.55, 0.35, 1);
    const p = clamp((pressure ?? 0.5) * 0.7 + speedFactor * 0.3, 0.12, 1);
    const smoothed = last.p * 0.62 + p * 0.38;
    pts.push({ x, y, p: smoothed });
  } else {
    pts.push({ x, y, p: clamp(pressure ?? 0.5, 0.12, 1) });
  }
  el.times.push(tRel);
  return true;
}

/** 收尾：记录时长，压掉多余精度 */
export function finalizeStroke(el, tRel) {
  el.dur = Math.max(0, tRel - (el.t ?? 0));
  el.points = el.points.map((p) => ({
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    p: Math.round(p.p * 1000) / 1000,
  }));
  el.times = el.times.map((t) => Math.round(t));
  return el;
}

/** 第 i 个点的实际线宽（含起笔/收笔渐尖） */
export function strokeWidth(el, i) {
  const n = el.points.length;
  const p = el.points[i]?.p ?? 0.5;
  let factor = 0.5 + 0.5 * p;
  if (n > 3) {
    const taper = 2.2;
    if (i < taper) factor *= 0.45 + (0.55 * i) / taper;
    const fromEnd = n - 1 - i;
    if (fromEnd < taper) factor *= 0.45 + (0.55 * fromEnd) / taper;
  }
  return Math.max(0.4, el.size * factor);
}

/** 创建形状元素 */
export function createShape(type, a, b, style, t) {
  return {
    id: uid('g'),
    type,
    color: style.color,
    size: style.size,
    opacity: style.opacity,
    fill: !!style.fill,
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
    t: t ?? 0,
    dur: 0,
  };
}

/** 创建文字元素 */
export function createText(text, x, y, style, t) {
  return {
    id: uid('t'),
    type: 'text',
    x,
    y,
    text: text ?? '',
    color: style.color,
    opacity: style.opacity,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    align: 'left',
    meta: null,
    t: t ?? 0,
    dur: 0,
  };
}

/** 创建便签 */
export function createNote(x, y, style, text = '', w = 180, h = 140, t = 0) {
  return {
    id: uid('n'),
    type: 'note',
    x,
    y,
    w,
    h,
    text,
    color: '#1f2937',
    opacity: 1,
    fontSize: Math.max(14, Math.round(style.fontSize * 0.72)),
    fontFamily: style.fontFamily,
    noteColor: style.noteColor,
    align: 'left',
    meta: null,
    t,
    dur: 0,
  };
}

/** 复制一组元素（新 id，可选偏移） */
export function duplicateElements(list, dx = 16, dy = 16) {
  const copies = deepClone(list);
  const idMap = new Map();
  for (const el of copies) {
    const next = uid(el.type[0]);
    idMap.set(el.id, next);
    el.id = next;
    if (el.points) for (const p of el.points) { p.x += dx; p.y += dy; }
    if (el.a) { el.a.x += dx; el.a.y += dy; }
    if (el.b) { el.b.x += dx; el.b.y += dy; }
    if (typeof el.x === 'number') { el.x += dx; el.y += dy; }
    el.meta = null;
  }
  return copies;
}

/**
 * 橡皮擦：把笔迹中被擦到的点删掉，剩余部分拆成多段。
 * 返回 { removed:boolean, pieces:Element[] }
 */
export function eraseFromStroke(el, x, y, radius) {
  const pts = el.points;
  const keep = pts.map((p) => dist(p.x, p.y, x, y) > radius);
  if (keep.every(Boolean)) return { removed: false, pieces: [el] };
  if (keep.every((k) => !k)) return { removed: true, pieces: [] };

  const pieces = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const piece = { ...deepClone(el), id: uid('s'), points: [], times: [] };
      for (const idx of run) {
        piece.points.push(pts[idx]);
        piece.times.push(el.times[idx] ?? 0);
      }
      piece.meta = null;
      pieces.push(piece);
    }
    run = [];
  };
  for (let i = 0; i < keep.length; i++) {
    if (keep[i]) run.push(i);
    else flush();
  }
  flush();
  return { removed: true, pieces };
}

/** 元素的人类可读名称（用于提示） */
export function elementName(el) {
  return (
    {
      pen: '笔迹',
      highlighter: '荧光笔',
      line: '直线',
      arrow: '箭头',
      rect: '矩形',
      ellipse: '椭圆',
      text: '文字',
      note: '便签',
    }[el.type] || el.type
  );
}

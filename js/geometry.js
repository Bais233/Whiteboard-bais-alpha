/**
 * geometry.js —— 纯几何计算：包围盒、命中测试、变换
 * 所有坐标均为「世界坐标」，与相机无关。
 */

import { dist } from './utils.js';

/** 点到线段的最短距离 */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return dist(px, py, ax + t * dx, ay + t * dy);
}

/** 元素的“原始”几何包围盒（不含线宽、文字外边距），用于精确缩放 */
export function rawBBox(el) {
  switch (el.type) {
    case 'pen':
    case 'highlighter': {
      if (!el.points.length) return null;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const pt of el.points) {
        x1 = Math.min(x1, pt.x); y1 = Math.min(y1, pt.y);
        x2 = Math.max(x2, pt.x); y2 = Math.max(y2, pt.y);
      }
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return bboxFromPoints(el.a, el.b);
    case 'note':
      return { x: el.x, y: el.y, w: el.w ?? 180, h: el.h ?? 140 };
    case 'text':
      return { x: el.x, y: el.y, w: el.meta?.w ?? 0, h: el.meta?.h ?? 0 };
    default:
      return null;
  }
}

/** 两点构成的规范化包围盒 */
export function bboxFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function bboxOf(x, y, w, h) {
  return { x, y, w, h };
}

/** 合并多个包围盒 */
export function mergeBBoxes(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const b of list) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function inflate(b, pad) {
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

export function bboxContainsPoint(b, x, y, pad = 0) {
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
}

export function bboxIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function bboxFullyInside(a, b) {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

/**
 * 元素包围盒。
 * 依赖元素自带 meta.w / meta.h（文字、便签由 text.js 测量后写入）。
 */
export function elementBBox(el, fallback = { w: 0, h: 0 }) {
  switch (el.type) {
    case 'pen':
    case 'highlighter': {
      if (!el.points.length) return null;
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const p of el.points) {
        x1 = Math.min(x1, p.x);
        y1 = Math.min(y1, p.y);
        x2 = Math.max(x2, p.x);
        y2 = Math.max(y2, p.y);
      }
      const pad = (el.size || 2) / 2;
      return inflate({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, pad);
    }
    case 'line':
    case 'arrow': {
      const pad = (el.size || 2) / 2 + (el.type === 'arrow' ? el.size * 2.4 : 0);
      return inflate(bboxFromPoints(el.a, el.b), pad);
    }
    case 'rect':
    case 'ellipse': {
      const pad = (el.size || 2) / 2;
      return inflate(bboxFromPoints(el.a, el.b), pad);
    }
    case 'note':
      return { x: el.x, y: el.y, w: el.w ?? 180, h: el.h ?? 140 };
    case 'text': {
      const w = el.meta?.w ?? fallback.w;
      const h = el.meta?.h ?? fallback.h;
      return { x: el.x - 2, y: el.y - 2, w: w + 4, h: h + 4 };
    }
    default:
      return null;
  }
}

/** 把元素所有可控点整体平移 */
export function translateElement(el, dx, dy) {
  if (el.points) {
    for (const p of el.points) {
      p.x += dx;
      p.y += dy;
    }
  }
  if (el.a) {
    el.a.x += dx;
    el.a.y += dy;
  }
  if (el.b) {
    el.b.x += dx;
    el.b.y += dy;
  }
  if (typeof el.x === 'number') {
    el.x += dx;
    el.y += dy;
  }
  return el;
}

/**
 * 把元素缩放进目标包围盒（用于选择框的缩放手柄）。
 * from / to 都是“外框”（含线宽/外边距）。内部换算出原始几何盒，
 * 使得缩放后的外框恰好等于 to。
 */
export function scaleElementToBBox(el, from, to) {
  const raw = rawBBox(el);
  if (!raw || !from.w || !from.h) return el;
  // from 是外框（原始盒外扩 pad），推回原始盒
  const padX = raw.x - from.x;
  const padY = raw.y - from.y;
  const fromRaw = { x: raw.x, y: raw.y, w: Math.max(0.01, from.w - padX * 2), h: Math.max(0.01, from.h - padY * 2) };
  const toRaw = { x: to.x + padX, y: to.y + padY, w: Math.max(0.01, to.w - padX * 2), h: Math.max(0.01, to.h - padY * 2) };
  const sx = toRaw.w / fromRaw.w;
  const sy = toRaw.h / fromRaw.h;
  const map = (p) => ({
    x: toRaw.x + (p.x - fromRaw.x) * sx,
    y: toRaw.y + (p.y - fromRaw.y) * sy,
  });
  if (el.points) el.points = el.points.map((p) => ({ ...p, ...map(p) }));
  if (el.a) el.a = map(el.a);
  if (el.b) el.b = map(el.b);
  if (typeof el.x === 'number') {
    const m = map({ x: el.x, y: el.y });
    el.x = m.x;
    el.y = m.y;
    if (el.type === 'note') {
      el.w = Math.max(60, (el.w ?? 180) * sx);
      el.h = Math.max(48, (el.h ?? 140) * sy);
    } else if (el.type === 'text') {
      if (el.maxW) el.maxW = Math.max(24, el.maxW * sx);
      el.fontSize = Math.max(8, el.fontSize * Math.max(sx, sy));
    }
    el.meta = null; // 触发重新排版
  }
  return el;
}

/** 点是否命中元素 */
export function hitTestElement(el, x, y, tol = 6, textMetrics) {
  const t = Math.max(tol, (el.size || 2) / 2 + 2);
  switch (el.type) {
    case 'pen':
    case 'highlighter': {
      const pts = el.points;
      if (pts.length === 1) return dist(x, y, pts[0].x, pts[0].y) <= t;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= t) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return distToSegment(x, y, el.a.x, el.a.y, el.b.x, el.b.y) <= t;
    case 'rect': {
      const b = bboxFromPoints(el.a, el.b);
      if (el.fill) return bboxContainsPoint(b, x, y);
      return (
        distToSegment(x, y, b.x, b.y, b.x + b.w, b.y) <= t ||
        distToSegment(x, y, b.x + b.w, b.y, b.x + b.w, b.y + b.h) <= t ||
        distToSegment(x, y, b.x + b.w, b.y + b.h, b.x, b.y + b.h) <= t ||
        distToSegment(x, y, b.x, b.y + b.h, b.x, b.y) <= t
      );
    }
    case 'ellipse': {
      const b = bboxFromPoints(el.a, el.b);
      const rx = Math.max(b.w / 2, 0.5);
      const ry = Math.max(b.h / 2, 0.5);
      const cx = b.x + rx;
      const cy = b.y + ry;
      const k = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (el.fill) return k <= 1;
      // 椭圆环带：换算成大致的像素宽度
      const scale = (rx + ry) / 2;
      return Math.abs(Math.sqrt(k) - 1) * scale <= t;
    }
    case 'text':
    case 'note': {
      const bb = elementBBox(el, textMetrics);
      return bb ? bboxContainsPoint(bb, x, y) : false;
    }
    default:
      return false;
  }
}

/** 由上到下取第一个命中的元素（后画的在上层） */
export function pickElement(elements, x, y, tol = 6, textMetrics) {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (elements[i].hidden) continue;
    if (hitTestElement(elements[i], x, y, tol, textMetrics)) return elements[i];
  }
  return null;
}

/** 框选：返回与矩形相交（或完全包含）的元素 */
export function elementsInRect(elements, rect, mode = 'intersect', textMetrics) {
  const full = mode === 'contain';
  return elements.filter((el) => {
    if (el.hidden) return false;
    const bb = elementBBox(el, textMetrics);
    if (!bb) return false;
    return full ? bboxFullyInside(bb, rect) : bboxIntersects(bb, rect);
  });
}

/** 两点连线的角度（弧度） */
export const angleOf = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

/** 直线距离 */
export const lengthOf = (a, b) => dist(a.x, a.y, b.x, b.y);

/**
 * export.js —— 导出 PNG / SVG / JSON，导入与打印
 */

import { state } from './state.js';
import { contentBBox, paintScene } from './renderer.js';
import { ensureLayout, notePadding, lineHeightOf } from './text.js';
import { bboxFromPoints } from './geometry.js';
import { serialize, deserialize } from './storage.js';
import { canvasToBlob, downloadBlob, downloadText, stamp, withAlpha } from './utils.js';

/* ------------------------------------------------------------------ PNG */

export async function exportPNG({ background = true, scale = 2, padding = 32 } = {}) {
  const elements = state.elements;
  if (!elements.length) throw new Error('画板是空的，没有可导出的内容');

  const box = contentBBox(elements, padding);
  const maxSide = 4000;
  const fit = Math.min(scale, maxSide / Math.max(box.w, box.h));
  const s = Math.max(0.2, fit);
  const W = Math.max(1, Math.round(box.w * s));
  const H = Math.max(1, Math.round(box.h * s));

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const ctx = off.getContext('2d');
  const board = background ? state.board : { ...state.board, color: '#ffffff', grid: 'none' };

  paintScene(ctx, {
    view: { w: W, h: H, dpr: 1 },
    dpr: 1,
    canvasW: W,
    canvasH: H,
    elements,
    camera: { scale: s, x: -box.x * s, y: -box.y * s },
    board,
    grid: false,
    overlay: false,
  });

  const blob = await canvasToBlob(off, 'image/png');
  downloadBlob(blob, stamp('png'));
  return { width: W, height: H };
}

/* ------------------------------------------------------------------ SVG */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function strokePath(el) {
  const pts = el.points;
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x + 0.01} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const p0x = i === 1 ? prev.x : (prev.x + cur.x) / 2;
    const p0y = i === 1 ? prev.y : (prev.y + cur.y) / 2;
    const p1x = !next ? cur.x : (cur.x + next.x) / 2;
    const p1y = !next ? cur.y : (cur.y + next.y) / 2;
    d += ` M ${p0x} ${p0y} Q ${cur.x} ${cur.y} ${p1x} ${p1y}`;
  }
  return d;
}

function avgWidth(el) {
  const n = el.points.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += 0.5 + 0.5 * (el.points[i].p ?? 0.5);
  return el.size * (sum / Math.max(1, n));
}

function textLines(ctx, el) {
  const meta = ensureLayout(el, ctx);
  const lh = meta.lh || lineHeightOf(el);
  return meta.lines.map((l, i) => ({ text: l.text, y: el.y + i * lh + el.fontSize * 0.92 }));
}

export function exportSVG() {
  const elements = state.elements;
  if (!elements.length) throw new Error('画板是空的，没有可导出的内容');
  const box = contentBBox(elements, 24);
  const measure = document.createElement('canvas').getContext('2d');
  const parts = [];

  for (const el of elements) {
    const alpha = el.opacity ?? 1;
    if (el.type === 'pen' || el.type === 'highlighter') {
      parts.push(
        `<path d="${strokePath(el)}" fill="none" stroke="${esc(el.color)}" stroke-opacity="${
          el.type === 'highlighter' ? Math.min(alpha, 0.42) : alpha
        }" stroke-width="${(el.type === 'highlighter' ? el.size : avgWidth(el)).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    } else if (el.type === 'line') {
      parts.push(
        `<line x1="${el.a.x}" y1="${el.a.y}" x2="${el.b.x}" y2="${el.b.y}" stroke="${esc(el.color)}" stroke-opacity="${alpha}" stroke-width="${el.size}" stroke-linecap="round"/>`
      );
    } else if (el.type === 'arrow') {
      const angle = Math.atan2(el.b.y - el.a.y, el.b.x - el.a.x);
      const head = Math.max(10, el.size * 4.2);
      const spread = Math.PI / 7;
      const p1 = { x: el.b.x - head * Math.cos(angle - spread), y: el.b.y - head * Math.sin(angle - spread) };
      const p2 = { x: el.b.x - head * 0.62 * Math.cos(angle), y: el.b.y - head * 0.62 * Math.sin(angle) };
      const p3 = { x: el.b.x - head * Math.cos(angle + spread), y: el.b.y - head * Math.sin(angle + spread) };
      parts.push(
        `<line x1="${el.a.x}" y1="${el.a.y}" x2="${el.b.x}" y2="${el.b.y}" stroke="${esc(el.color)}" stroke-opacity="${alpha}" stroke-width="${el.size}" stroke-linecap="round"/>`,
        `<polygon points="${el.b.x},${el.b.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}" fill="${esc(el.color)}" fill-opacity="${alpha}"/>`
      );
    } else if (el.type === 'rect') {
      const b = bboxFromPoints(el.a, el.b);
      parts.push(
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(6, Math.min(b.w, b.h) / 6)}" fill="${el.fill ? esc(el.color) : 'none'}" fill-opacity="${alpha}" stroke="${esc(el.color)}" stroke-opacity="${alpha}" stroke-width="${el.size}"/>`
      );
    } else if (el.type === 'ellipse') {
      const b = bboxFromPoints(el.a, el.b);
      parts.push(
        `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${Math.abs(b.w / 2)}" ry="${Math.abs(b.h / 2)}" fill="${el.fill ? esc(el.color) : 'none'}" fill-opacity="${alpha}" stroke="${esc(el.color)}" stroke-opacity="${alpha}" stroke-width="${el.size}"/>`
      );
    } else if (el.type === 'note') {
      const w = el.w ?? 180;
      const h = el.h ?? 140;
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${w}" height="${h}" rx="6" fill="${esc(el.noteColor || '#fff3a3')}"/>`
      );
      const lines = textLines(measure, el);
      parts.push(
        `<g font-family="${esc(el.fontFamily)}" font-size="${el.fontSize}" fill="${esc(el.color)}" opacity="${alpha}">` +
          lines
            .map((l) => `<text x="${el.x + notePadding}" y="${l.y + notePadding + 4}">${esc(l.text)}</text>`)
            .join('') +
          '</g>'
      );
    } else if (el.type === 'text') {
      const lines = textLines(measure, el);
      parts.push(
        `<g font-family="${esc(el.fontFamily)}" font-size="${el.fontSize}" fill="${esc(el.color)}" opacity="${alpha}">` +
          lines.map((l) => `<text x="${el.x}" y="${l.y}">${esc(l.text)}</text>`).join('') +
          '</g>'
      );
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(box.w)}" height="${Math.round(box.h)}" ` +
    `viewBox="${box.x} ${box.y} ${box.w} ${box.h}">` +
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${esc(state.board.color)}"/>` +
    parts.join('') +
    '</svg>';

  downloadText(svg, stamp('svg'), 'image/svg+xml;charset=utf-8');
  return svg;
}

/* ----------------------------------------------------------------- JSON */

export function exportJSON() {
  downloadText(JSON.stringify(serialize(), null, 2), stamp('wbjson'), 'application/json;charset=utf-8');
}

export function importJSONText(text) {
  const data = JSON.parse(text);
  const count = deserialize(data);
  return count;
}

/* ----------------------------------------------------------------- 打印 */

export async function printDoc() {
  const elements = state.elements;
  if (!elements.length) throw new Error('画板是空的');
  const box = contentBBox(elements, 24);
  const s = Math.min(3, 2400 / Math.max(box.w, box.h));
  const W = Math.max(1, Math.round(box.w * s));
  const H = Math.max(1, Math.round(box.h * s));
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  paintScene(off.getContext('2d'), {
    view: { w: W, h: H, dpr: 1 },
    dpr: 1,
    canvasW: W,
    canvasH: H,
    elements,
    camera: { scale: s, x: -box.x * s, y: -box.y * s },
    board: { ...state.board, grid: 'none' },
    grid: false,
    overlay: false,
  });
  const area = document.getElementById('printArea');
  area.innerHTML = '';
  const img = document.createElement('img');
  img.src = off.toDataURL('image/png');
  area.appendChild(img);
  await new Promise((r) => {
    img.onload = r;
    img.onerror = r;
    setTimeout(r, 1200);
  });
  window.print();
}

/** 供菜单预览用的缩略图 dataURL */
export async function thumbnail(maxSize = 320) {
  const box = contentBBox(state.elements, 12);
  if (!box) return '';
  const s = Math.min(maxSize / box.w, maxSize / box.h, 3);
  const W = Math.max(1, Math.round(box.w * s));
  const H = Math.max(1, Math.round(box.h * s));
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  paintScene(off.getContext('2d'), {
    view: { w: W, h: H, dpr: 1 },
    dpr: 1,
    canvasW: W,
    canvasH: H,
    elements: state.elements,
    camera: { scale: s, x: -box.x * s, y: -box.y * s },
    board: state.board,
    grid: false,
    overlay: false,
  });
  return off.toDataURL('image/png');
}

export const boardTint = () => withAlpha(state.board.color, 1);

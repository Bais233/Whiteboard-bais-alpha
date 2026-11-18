/* ==========================================================================
   whiteboard.js —— Blazor WebAssembly 的 Canvas 渲染 / 输入 / 编辑浮层桥接
   业务状态在 C#，本文件只负责像素绘制与浏览器原生能力。
   ========================================================================== */

(function () {
  'use strict';

  const wb = (window.whiteboard = {});

  let canvas = null;
  let ctx = null;
  let dotNetRef = null;
  let scene = null;
  let scheduled = false;
  let view = { w: 0, h: 0, dpr: 1 };

  const layoutCache = new Map(); // id -> { key, meta }
  const metricsPosted = new Map(); // id -> key

  const NOTE_PADDING = 12;
  const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

  /* ---------------------------------------------------------------- 工具 */

  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function normalizeHex(color) {
    if (typeof color !== 'string') return '#000000';
    let c = color.trim();
    if (!c) return '#000000';
    if (c[0] !== '#') return c;
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) return '#000000';
    return c.toLowerCase();
  }

  function withAlpha(color, alpha) {
    const c = normalizeHex(color);
    if (c[0] !== '#') return color;
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
  }

  function roundRectPath(ctx2, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    const x2 = x + w;
    const y2 = y + h;
    ctx2.moveTo(x + rr, y);
    ctx2.lineTo(x2 - rr, y);
    ctx2.arcTo(x2, y, x2, y + rr, rr);
    ctx2.lineTo(x2, y2 - rr);
    ctx2.arcTo(x2, y2, x2 - rr, y2, rr);
    ctx2.lineTo(x + rr, y2);
    ctx2.arcTo(x, y2, x, y2 - rr, rr);
    ctx2.lineTo(x, y + rr);
    ctx2.arcTo(x, y, x + rr, y, rr);
    ctx2.closePath();
  }

  /* ---------------------------------------------------------------- 文字 */

  const fontOf = (el) => `${el.fontSize}px ${el.fontFamily || 'sans-serif'}`;
  const lineHeightOf = (el) => Math.round((el.fontSize || 24) * 1.35);

  function tokenize(line) {
    const tokens = [];
    let buf = '';
    const pushBuf = () => {
      if (buf) {
        tokens.push(buf);
        buf = '';
      }
    };
    for (const ch of line) {
      if (CJK.test(ch)) {
        pushBuf();
        tokens.push(ch);
      } else if (ch === ' ') {
        pushBuf();
        tokens.push(' ');
      } else {
        buf += ch;
      }
    }
    pushBuf();
    return tokens;
  }

  function layoutRaw(text, fontSize, fontFamily, maxWidth) {
    const key = `${text}|${fontSize}|${fontFamily}|${maxWidth ?? -1}`;
    if (!ctx) {
      return { key, w: 0, h: 0, lh: Math.round((fontSize || 24) * 1.35), lines: [] };
    }
    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily || 'sans-serif'}`;
    const measure = (s) => ctx.measureText(s).width;
    const limit = maxWidth && maxWidth > 0 ? maxWidth : Infinity;
    const lines = [];
    const paragraphs = String(text ?? '').split('\n');
    for (const paragraph of paragraphs) {
      const tokens = tokenize(paragraph);
      if (!tokens.length) {
        lines.push({ text: '', width: 0 });
        continue;
      }
      let current = '';
      let width = 0;
      for (const token of tokens) {
        const tw = measure(token);
        const isSpace = token === ' ';
        if (width + tw > limit && current && !isSpace) {
          lines.push({ text: current.replace(/\s+$/, ''), width });
          current = '';
          width = 0;
          if (isSpace) continue;
        }
        current += token;
        width += tw;
      }
      lines.push({ text: current.replace(/\s+$/, ''), width });
    }
    ctx.restore();
    const lh = Math.round((fontSize || 24) * 1.35);
    const w = lines.reduce((m, l) => Math.max(m, l.width), 0);
    return { key, w, h: lines.length * lh, lh, lines };
  }

  function layoutFor(el, maxWidth) {
    const cached = layoutCache.get(el.id);
    const key = `${el.text ?? ''}|${el.fontSize}|${el.fontFamily}|${maxWidth ?? -1}|${el.w ?? ''}`;
    if (cached && cached.key === key) return cached.meta;
    const meta = layoutRaw(el.text ?? '', el.fontSize || 24, el.fontFamily || 'sans-serif', maxWidth);
    meta.key = key;
    layoutCache.set(el.id, { key, meta });
    return meta;
  }

  function layoutOfElement(el) {
    if (el.type === 'note') {
      return layoutFor(el, Math.max(20, (el.w ?? 180) - NOTE_PADDING * 2));
    }
    return layoutFor(el, el.maxW);
  }

  function drawTextBlock(ctx2, el, meta, opts = {}) {
    const x = opts.x ?? el.x;
    const y = opts.y ?? el.y;
    const color = opts.color ?? el.color;
    ctx2.font = fontOf(el);
    ctx2.fillStyle = color;
    ctx2.textBaseline = 'top';
    const lh = meta.lh;
    meta.lines.forEach((line, i) => {
      let lx = x;
      if (el.align === 'center') lx = x + (meta.w - line.width) / 2;
      else if (el.align === 'right') lx = x + (meta.w - line.width);
      if (line.text) ctx2.fillText(line.text, lx, y + i * lh);
    });
  }

  /* ---------------------------------------------------------------- 几何 */

  function bboxFromPoints(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  function inflate(b, pad) {
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }

  function elementBBox(el) {
    switch (el.type) {
      case 'pen':
      case 'highlighter': {
        if (!el.points || !el.points.length) return null;
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const p of el.points) {
          x1 = Math.min(x1, p.x);
          y1 = Math.min(y1, p.y);
          x2 = Math.max(x2, p.x);
          y2 = Math.max(y2, p.y);
        }
        return inflate({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, (el.size || 2) / 2);
      }
      case 'line':
      case 'arrow': {
        const pad = (el.size || 2) / 2 + (el.type === 'arrow' ? (el.size || 2) * 2.4 : 0);
        return inflate(bboxFromPoints(el.a, el.b), pad);
      }
      case 'rect':
      case 'ellipse':
        return inflate(bboxFromPoints(el.a, el.b), (el.size || 2) / 2);
      case 'note':
        return { x: el.x, y: el.y, w: el.w ?? 180, h: el.h ?? 140 };
      case 'text': {
        const meta = layoutOfElement(el);
        return { x: el.x - 2, y: el.y - 2, w: meta.w + 4, h: meta.h + 4 };
      }
      default:
        return null;
    }
  }

  function contentBBox(elements, pad = 24) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    let any = false;
    for (const el of elements) {
      const b = elementBBox(el);
      if (!b) continue;
      any = true;
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w);
      y2 = Math.max(y2, b.y + b.h);
    }
    if (!any) return null;
    return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  }

  const worldToScreen = (p) => ({
    x: p.x * scene.camera.scale + scene.camera.x,
    y: p.y * scene.camera.scale + scene.camera.y,
  });

  function strokeWidth(el, i) {
    const n = el.points ? el.points.length : 0;
    const p = el.points && el.points[i] ? el.points[i].p ?? 0.5 : 0.5;
    let factor = 0.5 + 0.5 * p;
    if (n > 3) {
      const taper = 2.2;
      if (i < taper) factor *= 0.45 + (0.55 * i) / taper;
      const fromEnd = n - 1 - i;
      if (fromEnd < taper) factor *= 0.45 + (0.55 * fromEnd) / taper;
    }
    return Math.max(0.4, (el.size || 2) * factor);
  }

  /* ---------------------------------------------------------------- 网格 */

  const gridPatternCache = new Map();

  function dotPattern(ctx2, step, radius, color, dpr) {
    const tile = Math.max(2, Math.round(step * dpr));
    const key = `${tile}|${Math.round(radius * dpr * 100)}|${color}`;
    let pattern = gridPatternCache.get(key);
    if (pattern) return pattern;
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tile;
    tileCanvas.height = tile;
    const g = tileCanvas.getContext('2d');
    g.fillStyle = color;
    g.beginPath();
    g.arc(tile / 2, tile / 2, Math.max(0.6, radius * dpr), 0, Math.PI * 2);
    g.fill();
    pattern = ctx2.createPattern(tileCanvas, 'repeat');
    if (gridPatternCache.size > 24) gridPatternCache.clear();
    gridPatternCache.set(key, pattern);
    return pattern;
  }

  function drawGrid(ctx2, v, camera, board) {
    if (!board || board.grid === 'none') return;
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
      const dpr = v.dpr || 1;
      const pattern = dotPattern(ctx2, s, r, board.gridColor, dpr);
      if (!pattern) return;
      ctx2.save();
      ctx2.setTransform(1, 0, 0, 1, 0, 0);
      ctx2.translate(offsetX * dpr, offsetY * dpr);
      ctx2.fillStyle = pattern;
      ctx2.fillRect(-offsetX * dpr, -offsetY * dpr, ctx2.canvas.width, ctx2.canvas.height);
      ctx2.restore();
    } else {
      ctx2.lineWidth = 1;
      ctx2.globalAlpha = 0.7;
      ctx2.beginPath();
      for (let x = offsetX; x < v.w + s; x += s) {
        ctx2.moveTo(Math.round(x) + 0.5, 0);
        ctx2.lineTo(Math.round(x) + 0.5, v.h);
      }
      for (let y = offsetY; y < v.h + s; y += s) {
        ctx2.moveTo(0, Math.round(y) + 0.5);
        ctx2.lineTo(v.w, Math.round(y) + 0.5);
      }
      ctx2.stroke();
      ctx2.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------ 元素绘制 */

  function visiblePointCount(el, cut) {
    if (cut == null) return null;
    if (el.t == null) return el.points ? el.points.length : null;
    if (cut < el.t) return 0;
    if (cut >= el.t + (el.dur ?? 0)) return el.points ? el.points.length : null;
    const rel = cut - el.t;
    let n = 0;
    const times = el.times || [];
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
    const meta = layoutOfElement(el);
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
    ctx2.fillStyle = 'rgba(0,0,0,0.06)';
    ctx2.fillRect(el.x, el.y, w, 4);
    if (scene.editingId !== el.id) {
      drawTextBlock(ctx2, el, meta, { x: el.x + NOTE_PADDING, y: el.y + NOTE_PADDING + 4 });
    }
    ctx2.restore();
  }

  function drawText(ctx2, el) {
    if (scene.editingId === el.id) return;
    const meta = layoutOfElement(el);
    ctx2.save();
    ctx2.globalAlpha = el.opacity ?? 1;
    drawTextBlock(ctx2, el, meta);
    ctx2.restore();
  }

  function drawElement(ctx2, el, cut) {
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

  /* ------------------------------------------------------------ 选择装饰 */

  function handlesFor(el) {
    if (el.type === 'line' || el.type === 'arrow') {
      return [
        { id: 'a', ...worldToScreen(el.a) },
        { id: 'b', ...worldToScreen(el.b) },
      ];
    }
    if (el.type === 'pen' || el.type === 'highlighter') return [];
    const bb = elementBBox(el);
    if (!bb) return [];
    const p1 = worldToScreen({ x: bb.x, y: bb.y });
    const p2 = worldToScreen({ x: bb.x + bb.w, y: bb.y + bb.h });
    return [
      { id: 'nw', x: p1.x, y: p1.y },
      { id: 'ne', x: p2.x, y: p1.y },
      { id: 'sw', x: p1.x, y: p2.y },
      { id: 'se', x: p2.x, y: p2.y },
    ];
  }

  function drawSelection(ctx2) {
    const selected = (scene.selection || [])
      .map((id) => scene.elements.find((el) => el.id === id))
      .filter(Boolean);
    if (!selected.length) return;
    ctx2.save();
    ctx2.strokeStyle = '#2563eb';
    ctx2.fillStyle = '#2563eb';
    ctx2.lineWidth = 1.4;
    ctx2.setLineDash([5, 4]);

    for (const el of selected) {
      const bb = elementBBox(el);
      if (!bb) continue;
      const p1 = worldToScreen({ x: bb.x, y: bb.y });
      const p2 = worldToScreen({ x: bb.x + bb.w, y: bb.y + bb.h });
      ctx2.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    }
    ctx2.setLineDash([]);

    if (selected.length === 1) {
      for (const h of handlesFor(selected[0])) {
        ctx2.beginPath();
        ctx2.rect(h.x - 4.5, h.y - 4.5, 9, 9);
        ctx2.fillStyle = '#fff';
        ctx2.fill();
        ctx2.stroke();
      }
    }
    ctx2.restore();
  }

  function drawMarquee(ctx2) {
    const m = scene.marquee;
    if (!m) return;
    const p1 = worldToScreen({ x: m.x, y: m.y });
    const p2 = worldToScreen({ x: m.x + m.w, y: m.y + m.h });
    ctx2.save();
    ctx2.fillStyle = 'rgba(37, 99, 235, 0.10)';
    ctx2.strokeStyle = '#2563eb';
    ctx2.lineWidth = 1;
    ctx2.setLineDash([4, 3]);
    ctx2.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    ctx2.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    ctx2.restore();
  }

  function drawLaser(ctx2) {
    if (!scene.laser || !scene.laser.length) return;
    const now = scene.now ?? 0;
    ctx2.save();
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';
    ctx2.globalCompositeOperation = 'lighter';
    for (const beam of scene.laser) {
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

  /* ---------------------------------------------------------------- 主帧 */

  function paint() {
    if (!ctx || !scene) return;
    const dpr = view.dpr;
    const camera = scene.camera;
    const board = scene.board;
    const cut = scene.playback && scene.playback.active ? scene.playback.t : null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = board.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(ctx, view, camera, board);

    ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.x, dpr * camera.y);
    for (const el of scene.elements) drawElement(ctx, el, cut);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSelection(ctx);
    drawMarquee(ctx);
    drawLaser(ctx);

    postMetrics();
  }

  function postMetrics() {
    if (!dotNetRef || !scene) return;
    const metrics = [];
    for (const el of scene.elements) {
      if (el.type !== 'text' && el.type !== 'note') continue;
      const meta = layoutOfElement(el);
      const key = meta.key;
      if (metricsPosted.get(el.id) !== key) {
        metricsPosted.set(el.id, key);
        metrics.push({ id: el.id, key, w: meta.w, h: meta.h, lh: meta.lh, lines: meta.lines });
      }
    }
    if (metrics.length) {
      dotNetRef.invokeMethodAsync('TextMetrics', metrics).catch(() => {});
    }
  }

  function requestPaint() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      paint();
    });
  }

  /* ------------------------------------------------------------ 导出绘制 */

  function paintSceneTo(ctx2, elements, camera, board, W, H, cut) {
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
    ctx2.fillStyle = board.color;
    ctx2.fillRect(0, 0, W, H);
    ctx2.setTransform(camera.scale, 0, 0, camera.scale, camera.x, camera.y);
    for (const el of elements) drawElement(ctx2, el, cut);
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
  }

  function canvasToBlob(cnv, type = 'image/png', quality) {
    return new Promise((resolve, reject) => {
      cnv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 返回空'))), type, quality);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function stamp(ext = 'png', prefix = 'whiteboard') {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
      d.getMinutes()
    )}${p(d.getSeconds())}.${ext}`;
  }

  wb.exportPng = async function (sceneJson, opts) {
    try {
      const s = JSON.parse(sceneJson);
      const elements = s.elements || [];
      if (!elements.length) return { width: 0, height: 0, error: '画板是空的，没有可导出的内容' };
      const padding = opts?.padding ?? 32;
      const box = contentBBox(elements, padding);
      const maxSide = 4000;
      const fit = Math.min(opts?.scale ?? 2, maxSide / Math.max(box.w, box.h));
      const scale = Math.max(0.2, fit);
      const W = Math.max(1, Math.round(box.w * scale));
      const H = Math.max(1, Math.round(box.h * scale));
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const octx = off.getContext('2d');
      const board = opts?.background === false
        ? { ...s.board, color: '#ffffff', grid: 'none' }
        : s.board;
      paintSceneTo(octx, elements, { scale, x: -box.x * scale, y: -box.y * scale }, board, W, H, null);
      const blob = await canvasToBlob(off, 'image/png');
      downloadBlob(blob, stamp('png'));
      return { width: W, height: H };
    } catch (err) {
      return { width: 0, height: 0, error: err?.message || String(err) };
    }
  };

  wb.print = async function (sceneJson) {
    const s = JSON.parse(sceneJson);
    const elements = s.elements || [];
    if (!elements.length) return;
    const box = contentBBox(elements, 24);
    const scale = Math.min(3, 2400 / Math.max(box.w, box.h));
    const W = Math.max(1, Math.round(box.w * scale));
    const H = Math.max(1, Math.round(box.h * scale));
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    paintSceneTo(
      off.getContext('2d'),
      elements,
      { scale, x: -box.x * scale, y: -box.y * scale },
      { ...s.board, grid: 'none' },
      W,
      H,
      null
    );
    let area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      area.className = 'print-area';
      document.body.appendChild(area);
    }
    area.innerHTML = '';
    const img = document.createElement('img');
    img.src = off.toDataURL('image/png');
    area.appendChild(img);
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      setTimeout(resolve, 1200);
    });
    window.print();
  };

  /* ---------------------------------------------------------- 文字编辑浮层 */

  let editorNode = null;
  let editorOpen = false;
  let suppressBlur = false;

  function ensureEditor() {
    if (editorNode) return;
    editorNode = document.createElement('textarea');
    editorNode.className = 'text-editor';
    editorNode.id = 'textEditor';
    editorNode.spellcheck = false;
    editorNode.hidden = true;
    document.body.appendChild(editorNode);

    editorNode.addEventListener('input', () => {
      if (!editorOpen) return;
      autoGrow();
      dotNetRef?.invokeMethodAsync('EditorInput', editorNode.value).catch(() => {});
    });

    editorNode.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        hideEditor();
        dotNetRef?.invokeMethodAsync('EditorCancel').catch(() => {});
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        hideEditor();
        dotNetRef?.invokeMethodAsync('EditorCommit').catch(() => {});
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const s = editorNode.selectionStart;
        editorNode.value =
          editorNode.value.slice(0, s) + '  ' + editorNode.value.slice(editorNode.selectionEnd);
        editorNode.selectionStart = editorNode.selectionEnd = s + 2;
        autoGrow();
        dotNetRef?.invokeMethodAsync('EditorInput', editorNode.value).catch(() => {});
      }
    });

    editorNode.addEventListener('blur', () => {
      if (!editorOpen || suppressBlur) return;
      hideEditor();
      dotNetRef?.invokeMethodAsync('EditorCommit').catch(() => {});
    });
  }

  function hideEditor() {
    editorOpen = false;
    suppressBlur = true;
    if (editorNode) editorNode.hidden = true;
    setTimeout(() => {
      suppressBlur = false;
    }, 0);
  }

  function autoGrow() {
    if (!editorNode) return;
    const fontSize = parseFloat(editorNode.style.fontSize) || 24;
    editorNode.style.height = 'auto';
    editorNode.style.height = `${Math.max(editorNode.scrollHeight, fontSize * 1.5)}px`;
  }

  function applyEditorConfig(config) {
    if (!editorNode) return;
    const scale = config.scale ?? 1;
    editorNode.style.left = `${config.x ?? 0}px`;
    editorNode.style.top = `${config.y ?? 0}px`;
    editorNode.style.width = `${config.width ?? 160}px`;
    editorNode.style.fontSize = `${config.fontSize ?? 24}px`;
    editorNode.style.fontFamily = config.fontFamily || 'sans-serif';
    editorNode.style.color = config.color || '#111827';
    editorNode.style.lineHeight = '1.35';
    editorNode.style.textAlign = config.align || 'left';
    editorNode.style.transform = `scale(${scale})`;
    editorNode.style.background = config.isNote ? 'transparent' : 'rgba(37, 99, 235, 0.06)';
  }

  function focusEditor() {
    if (!editorNode) return;
    const place = () => {
      if (!editorOpen || !editorNode) return;
      editorNode.focus({ preventScroll: true });
      const end = editorNode.value.length;
      editorNode.setSelectionRange(end, end);
    };
    place();
    requestAnimationFrame(place);
  }

  wb.editorOpen = function (config) {
    ensureEditor();
    editorOpen = true;
    suppressBlur = false;
    editorNode.hidden = false;
    editorNode.value = config.text ?? '';
    applyEditorConfig(config);
    autoGrow();
    focusEditor();
    requestPaint();
  };

  wb.editorUpdate = function (config) {
    if (!editorOpen) return;
    applyEditorConfig(config);
    autoGrow();
  };

  wb.editorClose = function () {
    hideEditor();
  };

  wb.editorInsert = function (text) {
    if (!editorOpen || !editorNode) return;
    const s = editorNode.selectionStart;
    const e = editorNode.selectionEnd;
    editorNode.value = editorNode.value.slice(0, s) + text + editorNode.value.slice(e);
    editorNode.selectionStart = editorNode.selectionEnd = s + text.length;
    autoGrow();
    editorNode.focus();
    dotNetRef?.invokeMethodAsync('EditorInput', editorNode.value).catch(() => {});
  };

  /* ------------------------------------------------------------ 面板拖动 */

  const PANEL_KEY = 'whiteboard-bais-alpha:panels';

  function loadPanelPositions() {
    let data = {};
    try {
      data = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}');
    } catch {
      data = {};
    }
    for (const [id, pos] of Object.entries(data || {})) {
      const panel = document.getElementById(id);
      if (!panel || !pos) continue;
      if (pos.left) panel.style.left = pos.left;
      if (pos.top) panel.style.top = pos.top;
      if (pos.right) panel.style.right = pos.right;
      if (pos.bottom) panel.style.bottom = pos.bottom;
    }
  }

  function savePanelPositions() {
    const data = {};
    for (const id of ['toolbar', 'stylebar', 'mathPanel']) {
      const panel = document.getElementById(id);
      if (!panel) continue;
      data[id] = {
        left: panel.style.left,
        top: panel.style.top,
        right: panel.style.right,
        bottom: panel.style.bottom,
      };
    }
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function makePanelsDraggable() {
    document.querySelectorAll('.panel').forEach((panel) => {
      if (panel.dataset.dragReady === '1') return;
      const handle = panel.querySelector('[data-drag-handle]');
      if (!handle) return;
      panel.dataset.dragReady = '1';
      let start = null;

      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, input, select, textarea, a')) return;
        const rect = panel.getBoundingClientRect();
        start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        panel.classList.add('is-dragging');
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
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
        savePanelPositions();
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    loadPanelPositions();
  }

  /* ------------------------------------------------------------ 输入桥接 */

  function pointerPayload(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      pointerId: e.pointerId,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      button: e.button,
      pointerType: e.pointerType,
      pressure: e.pressure,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    };
  }

  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function attachInput() {
    canvas.addEventListener('pointerdown', (e) => {
      if (editorOpen) e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dotNetRef?.invokeMethodAsync('PointerDown', pointerPayload(e)).catch(() => {});
    });
    canvas.addEventListener('pointermove', (e) => {
      dotNetRef?.invokeMethodAsync('PointerMove', pointerPayload(e)).catch(() => {});
    });
    canvas.addEventListener('pointerup', (e) => {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dotNetRef?.invokeMethodAsync('PointerUp', pointerPayload(e)).catch(() => {});
    });
    canvas.addEventListener('pointercancel', (e) => {
      dotNetRef?.invokeMethodAsync('PointerCancel', pointerPayload(e)).catch(() => {});
    });
    canvas.addEventListener('pointerleave', () => {
      dotNetRef?.invokeMethodAsync('PointerLeave').catch(() => {});
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      dotNetRef?.invokeMethodAsync('Wheel', {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      }).catch(() => {});
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      dotNetRef?.invokeMethodAsync('DoubleClick', pointerPayload(e)).catch(() => {});
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (editorOpen) e.preventDefault();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault();
      const payload = {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        typing: isTyping(e.target),
      };
      dotNetRef?.invokeMethodAsync('KeyDown', payload).catch(() => {});
    });
    window.addEventListener('keyup', (e) => {
      const payload = {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        typing: isTyping(e.target),
      };
      dotNetRef?.invokeMethodAsync('KeyUp', payload).catch(() => {});
    });
    window.addEventListener('blur', () => {
      dotNetRef?.invokeMethodAsync('WindowBlur').catch(() => {});
    });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        dotNetRef?.invokeMethodAsync('FileDropped', file.name, String(reader.result || '')).catch(() => {});
      };
      reader.readAsText(file);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) dotNetRef?.invokeMethodAsync('SaveNow').catch(() => {});
    });
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    view = { w, h, dpr };
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    dotNetRef?.invokeMethodAsync('OnViewport', { w, h, dpr }).catch(() => {});
    requestPaint();
  }

  wb.init = function (canvasEl, ref) {
    canvas = canvasEl;
    dotNetRef = ref;
    ctx = canvas.getContext('2d', { alpha: false });
    ensureEditor();
    attachInput();
    makePanelsDraggable();
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    return true;
  };

  wb.getViewport = function () {
    return { w: view.w || window.innerWidth, h: view.h || window.innerHeight, dpr: view.dpr || 1 };
  };

  wb.render = function (json) {
    try {
      scene = JSON.parse(json);
    } catch (err) {
      console.error('[whiteboard] scene parse failed', err);
      return;
    }
    requestPaint();
  };

  wb.setCursor = function (cursor) {
    if (!canvas) return;
    if (canvas.dataset.cursor !== cursor) canvas.dataset.cursor = cursor;
  };

  wb.measureText = function (req) {
    return layoutRaw(req.text ?? '', req.fontSize || 24, req.fontFamily || 'sans-serif', req.maxWidth);
  };

  wb.downloadText = function (filename, text, mime) {
    downloadBlob(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }), filename);
  };

  wb.click = function (selector) {
    const node = document.querySelector(selector);
    if (node) node.click();
  };

  wb.focus = function (selector) {
    const node = document.querySelector(selector);
    if (node) node.focus();
  };

  wb.confirm = function (message) {
    return window.confirm(message);
  };

  wb.localGet = function (key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  wb.localSet = function (key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  wb.localRemove = function (key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  };
})();

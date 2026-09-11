/**
 * utils.js —— 通用小工具（无 DOM 依赖，可被 Node 直接测试）
 */

/** 生成短 id */
export function uid(prefix = 'e') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/** 单调递增的高精度时间（ms） */
export const nowMs = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

/** #rgb / #rrggbb -> #rrggbb */
export function normalizeHex(color) {
  if (typeof color !== 'string') return '#000000';
  let c = color.trim();
  if (c[0] !== '#') return c;
  if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return '#000000';
  return c.toLowerCase();
}

/** #rrggbb + alpha -> rgba() */
export function withAlpha(color, alpha) {
  const c = normalizeHex(color);
  if (c[0] !== '#') return color;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

/** 相对亮度，用于判断深色/浅色板面 */
export function luminance(color) {
  const c = normalizeHex(color);
  if (c[0] !== '#') return 1;
  const r = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const deepClone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

export function debounce(fn, wait = 300) {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

/** 触发浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/** canvas -> PNG Blob */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob 返回空'))),
      type,
      quality
    );
  });
}

/** 文件名时间戳：whiteboard-20260911-1530.png */
export function stamp(ext = 'png', prefix = 'whiteboard') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}.${ext}`;
}

/** ms -> mm:ss（超过一小时自动补小时位） */
export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 圆角矩形路径（不 begin，由调用方控制） */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  const x2 = x + w;
  const y2 = y + h;
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x2 - rr, y);
  ctx.arcTo(x2, y, x2, y + rr, rr);
  ctx.lineTo(x2, y2 - rr);
  ctx.arcTo(x2, y2, x2 - rr, y2, rr);
  ctx.lineTo(x + rr, y2);
  ctx.arcTo(x, y2, x, y2 - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 把值按步长吸附 */
export const snapTo = (v, step) => (step > 0 ? Math.round(v / step) * step : v);

/** 简易事件总线 */
export function createEmitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);
    },
    emit(type, payload) {
      map.get(type)?.forEach((fn) => fn(payload));
    },
  };
}

/**
 * text.js —— 文字测量、换行与缓存
 * 所有结果写入 el.meta，几何模块（包围盒、命中）直接读 meta。
 */

const NOTE_PADDING = 12;

/** 中日韩等需要逐字断行的字符 */
const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

/** 把一行文本切成可断行的最小单元 */
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

export function fontOf(el) {
  return `${el.fontSize}px ${el.fontFamily || 'sans-serif'}`;
}

/** 行高（CSS px） */
export const lineHeightOf = (el) => Math.round(el.fontSize * 1.35);

/**
 * 计算文字布局。结果：{ w, h, lines, key }
 * maxWidth 为 undefined 时不换行（仅按 \n 分段）。
 */
export function layoutText(el, ctx, maxWidth) {
  const key = `${el.text}|${el.fontSize}|${el.fontFamily}|${maxWidth ?? -1}`;
  if (el.meta && el.meta.key === key) return el.meta;

  ctx.font = fontOf(el);
  const measure = (s) => ctx.measureText(s).width;
  const limit = maxWidth && maxWidth > 0 ? maxWidth : Infinity;
  const lines = [];

  for (const paragraph of String(el.text ?? '').split('\n')) {
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

  const lh = lineHeightOf(el);
  const w = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const meta = { key, w, h: lines.length * lh, lines, lh };
  el.meta = meta;
  return meta;
}

/** 便签：固定宽度，按内边距换行 */
export function layoutNote(el, ctx) {
  return layoutText(el, ctx, Math.max(20, (el.w ?? 180) - NOTE_PADDING * 2));
}

/** 文字元素：有 maxW（被拖过尺寸）才换行 */
export function layoutTextElement(el, ctx) {
  return layoutText(el, ctx, el.maxW);
}

/** 统一入口：按类型布局并返回 meta */
export function ensureLayout(el, ctx) {
  if (el.type === 'note') return layoutNote(el, ctx);
  if (el.type === 'text') return layoutTextElement(el, ctx);
  return null;
}

/** 把文字画到 canvas（左上角为 el.x / el.y） */
export function drawTextBlock(ctx, el, meta, { x = el.x, y = el.y, color = el.color } = {}) {
  ctx.font = fontOf(el);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  const lh = meta.lh;
  meta.lines.forEach((line, i) => {
    let lx = x;
    if (el.align === 'center') lx = x + (meta.w - line.width) / 2;
    else if (el.align === 'right') lx = x + (meta.w - line.width);
    if (line.text) ctx.fillText(line.text, lx, y + i * lh);
  });
}

export const notePadding = NOTE_PADDING;

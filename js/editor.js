/**
 * editor.js —— 画布上的文字编辑浮层
 * textarea 以相机缩放做 transform，视觉上与落板后的文字完全一致。
 */

import { state, worldToScreen } from './state.js';
import { commit } from './history.js';
import { requestRender } from './renderer.js';
import { notePadding } from './text.js';
import { clamp } from './utils.js';

let textarea = null;
let current = null; // { el, isNew, originalText }
let onFinish = null;

export function initEditor(el, done) {
  textarea = el;
  onFinish = done;
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onKeydown);
  textarea.addEventListener('blur', () => commitEditor());
}

export const isEditing = () => !!current;

export function openEditor(el, isNew) {
  if (current) commitEditor();
  current = { el, isNew: !!isNew, originalText: el.text ?? '' };
  el.text = isNew ? '' : el.text;
  textarea.hidden = false;
  textarea.value = el.text;
  positionEditor();
  focusEditor();
  requestRender();
}

/** 立即聚焦，并在下一帧再确认一次（部分浏览器会在 pointerdown 之后重设焦点） */
function focusEditor() {
  const node = textarea;
  const place = () => {
    if (!current) return;
    node.focus({ preventScroll: true });
    const end = node.value.length;
    node.setSelectionRange(end, end);
  };
  place();
  requestAnimationFrame(place);
}

function positionEditor() {
  if (!current) return;
  const { el } = current;
  const scale = state.camera.scale;
  const pad = el.type === 'note' ? notePadding : 2;
  const offsetY = el.type === 'note' ? notePadding + 4 : 0;
  const origin = worldToScreen(el.x + pad, el.y + pad + offsetY);

  let worldW;
  if (el.type === 'note') worldW = Math.max(40, (el.w ?? 180) - pad * 2);
  else worldW = el.maxW ?? Math.max(160, (state.viewport.w - origin.x - 20) / scale);

  textarea.style.left = `${origin.x}px`;
  textarea.style.top = `${origin.y}px`;
  textarea.style.width = `${worldW}px`;
  textarea.style.fontSize = `${el.fontSize}px`;
  textarea.style.fontFamily = el.fontFamily;
  textarea.style.color = el.color;
  textarea.style.lineHeight = '1.35';
  textarea.style.textAlign = el.align || 'left';
  textarea.style.transform = `scale(${scale})`;
  textarea.style.background = el.type === 'note' ? 'transparent' : 'rgba(37, 99, 235, 0.06)';
  autoGrow();
}

function autoGrow() {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(textarea.scrollHeight, textarea.fontSize * 1.5)}px`;
}

function onInput() {
  if (!current) return;
  current.el.text = textarea.value;
  current.el.meta = null;
  autoGrow();
}

function onKeydown(e) {
  e.stopPropagation(); // 不让画布快捷键吃掉输入
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEditor();
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    commitEditor();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const s = textarea.selectionStart;
    textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(textarea.selectionEnd);
    textarea.selectionStart = textarea.selectionEnd = s + 2;
    onInput();
  }
}

/** 提交编辑；空文字的新元素直接丢弃 */
export function commitEditor() {
  if (!current) return;
  const { el, isNew, originalText } = current;
  current = null;
  textarea.hidden = true;
  textarea.value = '';
  const text = el.text ?? '';
  el.meta = null;

  if (isNew) {
    if (!text.trim()) {
      onFinish?.({ action: 'discard', el });
      requestRender();
      return;
    }
    el.pending = false;
    if (!state.elements.includes(el)) state.elements.push(el);
    state.selection = new Set([el.id]);
    commit(isNoteLike(el) ? '便签' : '文字');
  } else if (!text.trim()) {
    const i = state.elements.indexOf(el);
    if (i >= 0) state.elements.splice(i, 1);
    state.selection.delete(el.id);
    commit('删除空文字');
  } else if (text !== originalText) {
    commit('编辑文字');
  }
  onFinish?.({ action: 'commit', el });
  requestRender();
}

export function cancelEditor() {
  if (!current) return;
  const { el, isNew, originalText } = current;
  el.text = originalText;
  el.meta = null;
  if (isNew) {
    onFinish?.({ action: 'discard', el });
  } else {
    const i = state.elements.indexOf(el);
    if (i >= 0 && !originalText.trim() && el.type === 'text') state.elements.splice(i, 1);
  }
  current = null;
  textarea.hidden = true;
  textarea.value = '';
  onFinish?.({ action: 'cancel', el });
  requestRender();
}

/** 相机变化时同步浮层位置 */
export function syncEditor() {
  if (current) positionEditor();
}

/** 往正在编辑的文字里插入符号 */
export function insertIntoEditor(text) {
  if (!current) return false;
  const s = textarea.selectionStart;
  const e = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, s) + text + textarea.value.slice(e);
  textarea.selectionStart = textarea.selectionEnd = s + text.length;
  onInput();
  textarea.focus();
  return true;
}

const isNoteLike = (el) => el.type === 'note';

/** 视口变化时重新定位 */
export function onViewportChanged() {
  if (current) {
    positionEditor();
    void clamp;
  }
}

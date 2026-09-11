/**
 * storage.js —— 本地持久化（localStorage）与文档序列化
 */

import { state, STORAGE_KEY } from './state.js';
import { debounce, deepClone } from './utils.js';

export function serialize() {
  return {
    format: 'whiteboard-bais-alpha',
    version: 1,
    meta: { ...state.meta, updatedAt: Date.now() },
    board: { ...state.board },
    camera: { ...state.camera },
    session: { elapsed: state.session.elapsed },
    elements: deepClone(state.elements),
  };
}

/** 载入外部文档；对缺失字段做兜底，保证老文件也能打开 */
export function deserialize(data) {
  if (!data || !Array.isArray(data.elements)) throw new Error('不是有效的画板文件');
  state.elements = data.elements.map((el) => normalizeElement(el));
  state.meta = { ...state.meta, ...(data.meta || {}) };
  if (data.board) Object.assign(state.board, data.board);
  if (data.camera) Object.assign(state.camera, data.camera);
  state.session.elapsed = data.session?.elapsed ?? 0;
  state.session.recording = false;
  state.selection.clear();
  return state.elements.length;
}

function normalizeElement(el) {
  const out = { ...el };
  out.meta = null;
  if (out.points) {
    out.points = out.points.map((p) => ({ x: +p.x || 0, y: +p.y || 0, p: p.p ?? 0.5 }));
    if (!Array.isArray(out.times) || out.times.length !== out.points.length) {
      out.times = out.points.map((_, i) => i * 16);
    }
  }
  out.size = +out.size || 2;
  out.opacity = out.opacity ?? 1;
  if (typeof out.t !== 'number') out.t = 0;
  if (typeof out.dur !== 'number') out.dur = 0;
  return out;
}

export function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[whiteboard] 本地存档读取失败', err);
    return null;
  }
}

export function writeLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    return true;
  } catch (err) {
    console.warn('[whiteboard] 本地存档写入失败', err);
    return false;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略隐私模式等异常 */
  }
}

export const saveLocal = debounce(() => writeLocal(), 600);
export const saveLocalNow = () => writeLocal();

/** localStorage 大约可用配额（提示用） */
export function localSize() {
  try {
    return (localStorage.getItem(STORAGE_KEY) || '').length;
  } catch {
    return 0;
  }
}

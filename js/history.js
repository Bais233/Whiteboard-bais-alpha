/**
 * history.js —— 撤销 / 重做（快照式，简单可靠）
 */

import { state } from './state.js';
import { deepClone } from './utils.js';

/** 快照上限：每一步都保存整份文档，因此保守取值以控制内存 */
const LIMIT = 80;

let stack = [];
let index = -1;
const listeners = new Set();

const cloneElements = () => deepClone(state.elements);

function apply(snapshot) {
  state.elements = deepClone(snapshot);
  // 清掉已不存在元素的选中态
  const alive = new Set(state.elements.map((el) => el.id));
  for (const id of [...state.selection]) if (!alive.has(id)) state.selection.delete(id);
  for (const el of state.elements) el.meta = null; // 重新排版
}

function notify() {
  const info = { canUndo: index > 0, canRedo: index < stack.length - 1, depth: index };
  listeners.forEach((fn) => fn(info));
}

/** 用当前文档初始化历史栈 */
export function initHistory() {
  stack = [cloneElements()];
  index = 0;
  notify();
}

/** 提交一次可撤销的变更 */
export function commit(label = '') {
  const snapshot = cloneElements();
  // 与栈顶完全一致就不产生新记录
  if (index >= 0 && JSON.stringify(stack[index]) === JSON.stringify(snapshot)) {
    notify();
    return;
  }
  stack = stack.slice(0, index + 1);
  stack.push(snapshot);
  if (stack.length > LIMIT) stack.shift();
  index = stack.length - 1;
  state.meta.updatedAt = Date.now();
  notify();
  if (label) void label; // 预留：将来做“历史面板”
}

export function undo() {
  if (index <= 0) return false;
  index--;
  apply(stack[index]);
  notify();
  return true;
}

export function redo() {
  if (index >= stack.length - 1) return false;
  index++;
  apply(stack[index]);
  notify();
  return true;
}

export const canUndo = () => index > 0;
export const canRedo = () => index < stack.length - 1;
export const historyDepth = () => stack.length;

export function onHistoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 载入新文档后重建历史 */
export function resetHistory() {
  stack = [];
  index = -1;
  initHistory();
}

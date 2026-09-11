/**
 * state.js —— 全局单一状态源
 * 只做数据与小改动，不引入其它模块（避免循环依赖）。
 */

import { uid } from './utils.js';

export const STORAGE_KEY = 'whiteboard-bais-alpha:doc:v1';

export const BOARD_PRESETS = {
  white: { color: '#ffffff', grid: '#dbe3ee', name: '纯白' },
  eye: { color: '#fdf9ef', grid: '#e6dcc4', name: '护眼米色' },
  dark: { color: '#1b1f27', grid: '#333a47', name: '深色墨板' },
};

export const state = {
  /** 元素数组，索引越小越靠下 */
  elements: [],
  /** 相机：屏幕坐标 = 世界坐标 * scale + offset */
  camera: { x: 0, y: 0, scale: 1 },
  /** 当前绘制样式 */
  style: {
    color: '#1f2937',
    size: 3,
    opacity: 1,
    fill: false,
    fontSize: 24,
    fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    noteColor: '#fff3a3',
  },
  tool: 'pen',
  /** 选中元素 id 集合 */
  selection: new Set(),
  board: {
    color: BOARD_PRESETS.white.color,
    gridColor: BOARD_PRESETS.white.grid,
    grid: 'dots', // dots | lines | none
    gridSize: 24,
    snap: false,
  },
  /** 录制会话 */
  session: {
    recording: false,
    startedAt: 0, // performance.now()
    elapsed: 0, // 已录制时长（ms），暂停时冻结
  },
  /** 回放 */
  playback: {
    active: false,
    paused: false,
    t: 0, // 当前播放位置（ms）
    speed: 1,
    duration: 0,
    startedAt: 0,
  },
  /** 激光笔的临时轨迹 */
  laser: [],
  /** 视口尺寸（CSS px） */
  viewport: { w: 0, h: 0, dpr: 1 },
  /** 交互态 */
  interaction: {
    pointer: null, // {x, y} 世界坐标
    panning: false,
    spaceDown: false,
    altDown: false,
    marquee: null,
    hoverResize: false,
  },
  ui: {
    theme: 'light',
    mathOpen: false,
    toolsCollapsed: false,
  },
  meta: {
    id: uid('doc'),
    title: '未命名画板',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  },
};

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export function screenToWorld(sx, sy) {
  const { x, y, scale } = state.camera;
  return { x: (sx - x) / scale, y: (sy - y) / scale };
}

export function worldToScreen(wx, wy) {
  const { x, y, scale } = state.camera;
  return { x: wx * scale + x, y: wy * scale + y };
}

/** 以某个屏幕点为锚缩放 */
export function zoomAt(factor, sx, sy) {
  const before = screenToWorld(sx, sy);
  const scale = clampScale(state.camera.scale * factor);
  state.camera.scale = scale;
  state.camera.x = sx - before.x * scale;
  state.camera.y = sy - before.y * scale;
  return scale;
}

export function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function setScale(scale, sx = state.viewport.w / 2, sy = state.viewport.h / 2) {
  const before = screenToWorld(sx, sy);
  const next = clampScale(scale);
  state.camera.scale = next;
  state.camera.x = sx - before.x * next;
  state.camera.y = sy - before.y * next;
  return next;
}

export function panBy(dx, dy) {
  state.camera.x += dx;
  state.camera.y += dy;
}

export function selectedElements() {
  if (!state.selection.size) return [];
  const set = state.selection;
  return state.elements.filter((el) => set.has(el.id));
}

export function findElement(id) {
  return state.elements.find((el) => el.id === id) || null;
}

export function clearSelection() {
  state.selection.clear();
}

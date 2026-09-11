/**
 * playback.js —— 笔迹回放
 * 依据每个元素的 t（开始时刻）与 dur（时长）按时间裁剪渲染。
 */

import { state } from './state.js';
import { requestRender } from './renderer.js';
import { nowMs } from './utils.js';

let raf = 0;
let lastTick = 0;
const listeners = new Set();

export function playbackDuration() {
  let max = 0;
  for (const el of state.elements) {
    if (typeof el.t !== 'number') continue;
    max = Math.max(max, el.t + (el.dur || 0));
  }
  return max;
}

function notify() {
  const p = state.playback;
  listeners.forEach((fn) => fn({ ...p, duration: playbackDuration() }));
}

function tick() {
  const p = state.playback;
  if (!p.active) return;
  const now = nowMs();
  const dt = now - lastTick;
  lastTick = now;
  if (!p.paused) {
    p.t += dt * p.speed;
    if (p.t >= p.duration) {
      p.t = p.duration;
      stopPlayback();
      return;
    }
  }
  requestRender();
  notify();
  raf = requestAnimationFrame(tick);
}

export function startPlayback() {
  const duration = playbackDuration();
  if (duration <= 0) return false;
  const p = state.playback;
  p.active = true;
  p.paused = false;
  p.t = 0;
  p.duration = duration;
  p.startedAt = nowMs();
  lastTick = nowMs();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
  notify();
  requestRender();
  return true;
}

export function stopPlayback() {
  cancelAnimationFrame(raf);
  const p = state.playback;
  p.active = false;
  p.paused = false;
  notify();
  requestRender();
}

export function togglePause() {
  const p = state.playback;
  if (!p.active) return;
  p.paused = !p.paused;
  lastTick = nowMs();
  notify();
}

export function seek(ratio) {
  const p = state.playback;
  p.duration = playbackDuration() || p.duration;
  p.t = Math.max(0, Math.min(1, ratio)) * p.duration;
  lastTick = nowMs();
  requestRender();
  notify();
}

export function setSpeed(speed) {
  state.playback.speed = speed;
}

export function onPlaybackChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

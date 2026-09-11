/**
 * tools/unit.test.mjs —— 纯逻辑单元测试（不依赖浏览器）
 * 运行：npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { texToUnicode } from '../js/math.js';
import { distToSegment, elementBBox, bboxFromPoints, hitTestElement, translateElement, scaleElementToBBox, mergeBBoxes } from '../js/geometry.js';
import { createStroke, addPoint, eraseFromStroke, createShape } from '../js/model.js';
import { state } from '../js/state.js';
import { initHistory, commit, undo, redo, canUndo, canRedo } from '../js/history.js';
import { withAlpha, normalizeHex, formatTime, snapTo } from '../js/utils.js';

test('texToUnicode 基础运算与上下标', () => {
  assert.equal(texToUnicode('x^2 + y^2 = r^2'), 'x² + y² = r²');
  assert.equal(texToUnicode('a^2 + b^2 = c^2'), 'a² + b² = c²');
  assert.equal(texToUnicode('x_1 + x_2'), 'x₁ + x₂');
});

test('texToUnicode 分数 / 根号 / 求和 / 极限', () => {
  assert.equal(texToUnicode('\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'), '(-b ± √(b²-4ac))/(2a)');
  assert.equal(texToUnicode('\\sqrt[3]{8}'), '∛(8)');
  assert.equal(texToUnicode('\\sum_{i=1}^{n} i'), 'Σᵢ₌₁ⁿ i');
  assert.equal(texToUnicode('\\lim_{x \\to 0} x'), 'lim_(x → 0) x');
  assert.equal(texToUnicode('e^{i\\pi} + 1 = 0'), 'e^(iπ) + 1 = 0');
});

test('texToUnicode 希腊字母与集合', () => {
  assert.equal(texToUnicode('\\alpha + \\beta \\leq \\gamma'), 'α + β ≤ γ');
  assert.equal(texToUnicode('x \\in \\mathbb{R}'), 'x ∈ ℝ');
});

test('distToSegment 精确值', () => {
  assert.equal(distToSegment(0, 1, -1, 0, 1, 0), 1);
  assert.equal(distToSegment(2, 0, -1, 0, 1, 0), 1); // 投影到端点
  assert.equal(distToSegment(0.5, 0, 0, 0, 1, 0), 0);
});

test('elementBBox 笔迹含线宽 padding', () => {
  const el = createStroke('pen', { color: '#000', size: 4, opacity: 1 }, { x: 0, y: 0, p: 0.5 }, 0);
  addPoint(el, 10, 0, 0.5, 10);
  const bb = elementBBox(el);
  assert.equal(bb.x, -2);
  assert.equal(bb.y, -2);
  assert.equal(bb.w, 14);
  assert.equal(bb.h, 4);
});

test('bboxFromPoints 规范化', () => {
  const bb = bboxFromPoints({ x: 5, y: 8 }, { x: 1, y: 2 });
  assert.deepEqual(bb, { x: 1, y: 2, w: 4, h: 6 });
});

test('mergeBBoxes 合并', () => {
  const m = mergeBBoxes([{ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 2, h: 2 }]);
  assert.deepEqual(m, { x: 0, y: 0, w: 4, h: 4 });
});

test('hitTestElement 直线命中/不命中', () => {
  const el = createShape('line', { x: 0, y: 0 }, { x: 10, y: 0 }, { color: '#000', size: 2, opacity: 1 });
  assert.equal(hitTestElement(el, 5, 1, 2), true);
  assert.equal(hitTestElement(el, 5, 5, 2), false);
});

test('translateElement 平移笔迹', () => {
  const el = createStroke('pen', { color: '#000', size: 2, opacity: 1 }, { x: 0, y: 0, p: 0.5 }, 0);
  addPoint(el, 5, 5, 0.5, 10);
  translateElement(el, 3, -2);
  assert.equal(el.points[0].x, 3);
  assert.equal(el.points[1].y, 3);
});

test('scaleElementToBBox 缩放后包围盒≈目标', () => {
  const el = createShape('rect', { x: 0, y: 0 }, { x: 10, y: 10 }, { color: '#000', size: 2, opacity: 1 });
  const from = elementBBox(el);
  const to = { x: 0, y: 0, w: 40, h: 40 };
  scaleElementToBBox(el, from, to);
  const after = elementBBox(el);
  assert.ok(Math.abs(after.w - 40) <= 1, `w=${after.w}`);
  assert.ok(Math.abs(after.h - 40) <= 1, `h=${after.h}`);
});

test('eraseFromStroke 把笔迹切成两段', () => {
  const el = createStroke('pen', { color: '#000', size: 4, opacity: 1 }, { x: 0, y: 0, p: 0.5 }, 0);
  for (let i = 1; i <= 20; i++) addPoint(el, i * 2, 0, 0.5, i * 10);
  const { removed, pieces } = eraseFromStroke(el, 20, 0, 6);
  assert.equal(removed, true);
  assert.equal(pieces.length, 2);
  const total = pieces[0].points.length + pieces[1].points.length;
  assert.ok(total < el.points.length);
});

test('history 撤销/重做', () => {
  state.elements = [];
  initHistory();
  assert.equal(canUndo(), false);
  state.elements.push({ id: 'a', type: 'pen' });
  commit();
  assert.equal(canUndo(), true);
  undo();
  assert.equal(state.elements.length, 0);
  assert.equal(canRedo(), true);
  redo();
  assert.equal(state.elements.length, 1);
});

test('utils 颜色 / 时间 / 吸附', () => {
  assert.equal(normalizeHex('#f00'), '#ff0000');
  assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.equal(formatTime(65000), '01:05');
  assert.equal(snapTo(13, 5), 15);
});

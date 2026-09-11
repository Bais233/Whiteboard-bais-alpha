/**
 * main.js —— 启动入口
 * 顺序：渲染器 → 交互 → 文字编辑 → 载入本地存档 → 历史基线 → UI
 */

import { state } from './state.js';
import { initRenderer, resizeRenderer, requestRender, fitToContent } from './renderer.js';
import { initTools, setTool, setEditorOpener } from './tools.js';
import { initEditor, openEditor, syncEditor } from './editor.js';
import { initHistory, commit } from './history.js';
import { initUI, toast } from './ui.js';
import { readLocal, deserialize, saveLocalNow } from './storage.js';
import { onHistoryChange } from './history.js';
import * as history from './history.js';
import * as tools from './tools.js';
import * as renderer from './renderer.js';
import * as exporter from './export.js';
import { texToUnicode } from './math.js';

const FIRST_RUN_KEY = 'whiteboard-bais-alpha:seen';

function restoreDoc() {
  const data = readLocal();
  if (!data) return 0;
  try {
    return deserialize(data);
  } catch (err) {
    console.warn('[whiteboard] 存档格式不正确，已忽略', err);
    return 0;
  }
}

function boot() {
  const canvas = document.getElementById('board');
  const textarea = document.getElementById('textEditor');

  initRenderer(canvas);
  initTools(canvas);
  initEditor(textarea, onEditorFinish);
  setEditorOpener((el, isNew) => openEditor(el, isNew));

  const restored = restoreDoc();
  initHistory();
  initUI();

  if (restored) {
    fitToContent(72);
    toast(`已恢复上次画板（${restored} 个元素）`, 'ok');
  } else if (!localStorage.getItem(FIRST_RUN_KEY)) {
    seedWelcome();
    localStorage.setItem(FIRST_RUN_KEY, '1');
  } else {
    fitToContent(72);
  }

  setTool(state.tool || 'pen');
  requestRender();

  window.addEventListener('resize', () => {
    resizeRenderer();
    syncEditor();
  });
  window.addEventListener('orientationchange', () => resizeRenderer());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveLocalNow();
  });

  onHistoryChange(() => {
    /* 占位：将来在此接入协作/云端同步 */
  });

  // 首次进入把焦点交给画布，键盘快捷键立刻可用
  canvas.focus({ preventScroll: true });

  // 控制台 / 自动化调试入口：DevTools 里可用 window.whiteboard.state 直接查看
  window.whiteboard = {
    version: '0.1.0',
    state,
    tools,
    history,
    renderer,
    export: exporter,
    texToUnicode,
    saveLocalNow,
  };
}

/** 空存档时给一点内容，让人一眼看懂这块板子能做什么 */
function seedWelcome() {
  const { w, h } = state.viewport;
  const cx = w / 2;
  const cy = h / 2;
  const font = state.style.fontFamily;
  const ink = '#1f2937';

  state.elements.push(
    {
      id: 'seed-title',
      type: 'text',
      x: cx - 190,
      y: cy - 150,
      text: '白色画板 · Whiteboard bais alpha',
      color: ink,
      opacity: 1,
      fontSize: 34,
      fontFamily: font,
      align: 'left',
      meta: null,
      t: 0,
      dur: 0,
    },
    {
      id: 'seed-sub',
      type: 'text',
      x: cx - 190,
      y: cy - 96,
      text: '按 P 写字，M 打开数学面板，F9 录制，F10 回放，? 看全部快捷键',
      color: '#64748b',
      opacity: 1,
      fontSize: 18,
      fontFamily: font,
      align: 'left',
      meta: null,
      t: 0,
      dur: 0,
    },
    {
      id: 'seed-formula',
      type: 'text',
      x: cx - 190,
      y: cy - 40,
      text: 'x = (-b ± √(b²-4ac))/(2a)',
      color: '#2563eb',
      opacity: 1,
      fontSize: 26,
      fontFamily: font,
      align: 'left',
      meta: null,
      t: 0,
      dur: 0,
    },
    {
      id: 'seed-arrow',
      type: 'arrow',
      color: '#ef4444',
      size: 3,
      opacity: 1,
      fill: false,
      a: { x: cx + 120, y: cy - 20 },
      b: { x: cx + 190, y: cy + 30 },
      t: 0,
      dur: 0,
    },
    {
      id: 'seed-note',
      type: 'note',
      x: cx + 200,
      y: cy + 20,
      w: 190,
      h: 130,
      text: '便签可以拖出大小，\n双击再次编辑。',
      color: '#1f2937',
      opacity: 1,
      fontSize: 17,
      fontFamily: font,
      noteColor: '#fff3a3',
      align: 'left',
      meta: null,
      t: 0,
      dur: 0,
    }
  );
  commit('欢迎');
}

function onEditorFinish({ action, el }) {
  if (action === 'discard' || action === 'cancel') {
    // 便签在打开编辑器前已入列，内容为空时撤掉
    if (el.type === 'note' && !(el.text || '').trim()) {
      const i = state.elements.indexOf(el);
      if (i >= 0) {
        state.elements.splice(i, 1);
        state.selection.delete(el.id);
        requestRender();
      }
    }
  }
  syncEditor();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

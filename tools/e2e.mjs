/**
 * tools/e2e.mjs —— 真实浏览器端到端验证
 * 启动内置静态服务器 → 打开页面 → 模拟鼠标/键盘操作 → 校验状态、像素与导出产物
 *
 * 用法：npm run test:e2e
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync as readFile } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveBrowser } from './browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// 默认让系统分配空闲端口，避免与已运行的服务冲突
const PORT = Number(process.env.PORT ?? 0);
let BASE = '';
const SHOTS = process.env.SHOTS || '/tmp/wb-shots';
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` —— ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

const startServer = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOST: '127.0.0.1' },
    });
    child.stdout.on('data', (d) => {
      const m = /PORT=(\d+)/.exec(String(d));
      if (m) {
        BASE = `http://127.0.0.1:${m[1]}`;
        resolve(child);
      }
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`服务器退出 ${code}`)));
    setTimeout(() => reject(new Error('服务器启动超时')), 8000);
  });

async function newPage(browser, errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return { context, page };
}

/** 在画板上画一条折线 */
async function scribble(page, { x = 300, y = 300, len = 180, steps = 12 } = {}) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (len * i) / steps, y + Math.sin(i / 2) * 34);
  }
  await page.mouse.up();
  await page.waitForTimeout(60);
}

const count = (page) => page.evaluate(() => window.whiteboard.state.elements.length);
const types = (page) => page.evaluate(() => window.whiteboard.state.elements.map((e) => e.type));
const scale = (page) => page.evaluate(() => window.whiteboard.state.camera.scale);

async function main() {
  console.log('启动静态服务器…');
  const server = await startServer();
  const { executablePath, env } = await resolveBrowser();
  console.log(`使用浏览器：${executablePath}`);
  const browser = await chromium.launch({
    executablePath,
    env,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });

  const errors = [];
  const { page } = await newPage(browser, errors);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.whiteboard, null, { timeout: 8000 });

  console.log('\n[1] 首屏加载');
  check('暴露调试入口 window.whiteboard', await page.evaluate(() => window.whiteboard.version === '0.1.0'));
  check('画布已铺满视口', await page.evaluate(() => {
    const c = document.getElementById('board');
    return c.width > 1000 && c.height > 700;
  }));
  const seeded = await count(page);
  check(`首次进入写入引导内容（${seeded} 个元素）`, seeded >= 4, `实际 ${seeded}`);
  await page.screenshot({ path: join(SHOTS, '01-boot.png') });

  console.log('\n[2] 钢笔绘制');
  const before = await count(page);
  await page.keyboard.press('p');
  await scribble(page, { x: 220, y: 420 });
  const afterDraw = await count(page);
  check('新增一个笔迹元素', afterDraw === before + 1, `${before} → ${afterDraw}`);
  const stroke = await page.evaluate(() => {
    const s = window.whiteboard.state.elements.at(-1);
    return { type: s.type, points: s.points.length, size: s.size, color: s.color };
  });
  check('笔迹记录了轨迹点', stroke.type === 'pen' && stroke.points > 5, JSON.stringify(stroke));
  const inkPixels = await page.evaluate(() => {
    const c = document.getElementById('board');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(200 * 1, 400, 400, 120).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 200) dark++;
    return dark;
  });
  check('画布上确实出现了墨迹像素', inkPixels > 300, `深色像素 ${inkPixels}`);
  await page.screenshot({ path: join(SHOTS, '02-pen.png') });

  console.log('\n[3] 撤销 / 重做');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(50);
  check('撤销后元素数回到绘制前', (await count(page)) === before, `当前 ${await count(page)}`);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(50);
  check('重做后恢复绘制', (await count(page)) === afterDraw);

  console.log('\n[4] 图形工具（矩形 + Shift 约束）');
  await page.keyboard.press('r');
  await page.mouse.move(620, 420);
  await page.mouse.down();
  await page.mouse.move(760, 520, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  let last = await page.evaluate(() => window.whiteboard.state.elements.at(-1));
  check('生成矩形元素', last.type === 'rect', last.type);
  const rectBox = { w: Math.abs(last.b.x - last.a.x), h: Math.abs(last.b.y - last.a.y) };
  check('矩形尺寸正确', Math.round(rectBox.w) === 140 && Math.round(rectBox.h) === 100, JSON.stringify(rectBox));
  check('画完图形自动切到选择工具', (await page.evaluate(() => window.whiteboard.state.tool)) === 'select');
  check('新图形处于选中状态', (await page.evaluate(() => window.whiteboard.state.selection.size)) === 1);

  await page.keyboard.press('a'); // 箭头
  await page.mouse.move(620, 560);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(820, 640, { steps: 6 });
  await page.keyboard.up('Shift');
  await page.mouse.up();
  await page.waitForTimeout(60);
  last = await page.evaluate(() => window.whiteboard.state.elements.at(-1));
  const ang = Math.atan2(last.b.y - last.a.y, last.b.x - last.a.x);
  check('箭头按 15° 吸附', last.type === 'arrow' && Math.abs((ang * 180) / Math.PI % 15) < 0.01, `角度 ${((ang * 180) / Math.PI).toFixed(3)}`);

  console.log('\n[5] 橡皮擦');
  await page.keyboard.press('p');
  await page.evaluate(() => {
    window.whiteboard.state.elements = window.whiteboard.state.elements.filter((e) => e.type !== 'pen');
    window.whiteboard.state.selection.clear();
    window.whiteboard.renderer.requestRender();
  });
  // 画一条水平直线，方便擦除轨迹精确压上去
  await page.mouse.move(900, 250);
  await page.mouse.down();
  await page.mouse.move(1140, 250, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const beforeErase = await count(page);
  const strokesBefore = await page.evaluate(() => window.whiteboard.state.elements.filter((e) => e.type === 'pen').length);
  await page.keyboard.press('e');
  await page.mouse.move(980, 250);
  await page.mouse.down();
  await page.mouse.move(1060, 250, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const erased = await page.evaluate(() => {
    const list = window.whiteboard.state.elements.filter((e) => e.type === 'pen');
    return { count: window.whiteboard.state.elements.length, strokes: list.length, pts: list.map((s) => s.points.length) };
  });
  check('橡皮擦改变了元素结构', erased.count !== beforeErase, `${beforeErase} → ${erased.count}`);
  check(`笔迹被切断成多段（${strokesBefore} → ${erased.strokes}）`, erased.strokes >= 2, JSON.stringify(erased));
  await page.screenshot({ path: join(SHOTS, '03-eraser.png') });

  console.log('\n[6] 文字与便签');
  await page.keyboard.press('t');
  await page.mouse.click(430, 640);
  await page.waitForTimeout(120);
  const editorVisible = await page.evaluate(() => !document.getElementById('textEditor').hidden);
  check('文字工具打开了编辑浮层', editorVisible);
  const focused = await page.evaluate(() => document.activeElement?.id === 'textEditor');
  check('输入焦点在编辑浮层上', focused, await page.evaluate(() => document.activeElement?.tagName + '#' + document.activeElement?.id));
  await page.keyboard.type('勾股定理 a² + b² = c²');
  await page.keyboard.press('Escape'); // 取消
  await page.waitForTimeout(80);
  check('Escape 取消不会留下空文字', !(await page.evaluate(() =>
    window.whiteboard.state.elements.some((e) => e.type === 'text' && !e.text.trim()))));

  await page.keyboard.press('t');
  await page.mouse.click(430, 690);
  await page.waitForTimeout(120);
  await page.keyboard.type('余弦定理 c² = a² + b² - 2ab·cosC');
  await page.keyboard.press('Control+Enter'); // 提交
  await page.waitForTimeout(120);
  const texts = await page.evaluate(() => window.whiteboard.state.elements.filter((e) => e.type === 'text').map((e) => e.text));
  check('文字元素已落板', texts.some((t) => t.includes('余弦定理')), JSON.stringify(texts));
  check('提交后编辑浮层已关闭', await page.evaluate(() => document.getElementById('textEditor').hidden));

  await page.keyboard.press('n');
  await page.mouse.move(980, 380);
  await page.mouse.down();
  await page.mouse.move(1180, 520, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.keyboard.type('便签内容');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(120);
  const note = await page.evaluate(() => [...window.whiteboard.state.elements].reverse().find((e) => e.type === 'note'));
  check('便签已创建并带尺寸', !!note && note.w > 150 && note.h > 100, JSON.stringify(note && { w: Math.round(note.w), h: Math.round(note.h) }));
  check('便签文字已保存', note?.text === '便签内容', JSON.stringify(note?.text));

  // 空便签：Escape 应整块丢弃
  const notesBefore = await page.evaluate(() => window.whiteboard.state.elements.filter((e) => e.type === 'note').length);
  await page.keyboard.press('n');
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(860, 420, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const notesAfter = await page.evaluate(() => window.whiteboard.state.elements.filter((e) => e.type === 'note').length);
  check('空便签被丢弃', notesAfter === notesBefore, `便签数 ${notesBefore} → ${notesAfter}`);
  await page.screenshot({ path: join(SHOTS, '04-text-note.png') });

  console.log('\n[7] 数学面板');
  await page.keyboard.press('m');
  await page.waitForTimeout(60);
  check('数学面板已打开', await page.evaluate(() => !document.getElementById('mathPanel').hidden));
  const symCount = await page.evaluate(() => document.querySelectorAll('#mathGrid .sym').length);
  check(`符号网格渲染（${symCount} 个按钮）`, symCount > 10);
  await page.fill('#texInput', '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');
  await page.waitForTimeout(60);
  const preview = await page.textContent('#texPreview');
  check('LaTeX 速记实时预览', preview.includes('±') && preview.includes('√'), preview);
  const beforeFormula = await count(page);
  await page.click('#texInsert');
  await page.waitForTimeout(120);
  const formula = await page.evaluate(() => window.whiteboard.state.elements.at(-1));
  check('公式作为文字插入画板', formula.type === 'text' && formula.text.includes('√'), JSON.stringify(formula.text));
  check('插入后元素数 +1', (await count(page)) === beforeFormula + 1);
  await page.click('#mathTabs button:nth-child(2)');
  await page.waitForTimeout(50);
  const greek = await page.evaluate(() => [...document.querySelectorAll('#mathGrid .sym')].map((b) => b.textContent));
  check('切换到希腊字母分组', greek.includes('α') && greek.includes('Ω'), greek.slice(0, 5).join(' '));
  await page.screenshot({ path: join(SHOTS, '05-math.png') });
  await page.click('#btnCloseMath');

  console.log('\n[8] 选择 / 删除 / 层级');
  await page.keyboard.press('v');
  await page.mouse.move(300, 130);
  await page.mouse.down();
  await page.mouse.move(1250, 720, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const selCount = await page.evaluate(() => window.whiteboard.state.selection.size);
  check(`框选命中元素（${selCount} 个）`, selCount >= 3);
  const statusSel = await page.textContent('#statusSel');
  check('状态栏显示选中数量', statusSel.includes(String(selCount)), statusSel);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(80);
  check('Ctrl+D 复制选中', (await page.evaluate(() => window.whiteboard.state.selection.size)) === selCount);

  console.log('\n[9] 缩放与平移');
  const s0 = await scale(page);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(80);
  const s1 = await scale(page);
  check('滚轮放大', s1 > s0, `${s0.toFixed(3)} → ${s1.toFixed(3)}`);
  check('缩放标签同步', (await page.textContent('#btnZoomLabel')) === `${Math.round(s1 * 100)}%`);
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  check('“1” 适应内容', Math.abs((await scale(page)) - 1) < 3);
  await page.keyboard.press('0');
  await page.waitForTimeout(120);
  check('“0” 回到 100%', Math.abs((await scale(page)) - 1) < 1e-6, String(await scale(page)));
  const camBefore = await page.evaluate(() => ({ ...window.whiteboard.state.camera }));
  await page.keyboard.down('Space');
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(700, 460, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const cam = await page.evaluate(() => ({ ...window.whiteboard.state.camera }));
  check('Space + 拖动平移了相机', Math.abs(cam.x - camBefore.x - 100) < 2 && Math.abs(cam.y - camBefore.y - 60) < 2,
    `Δ=${(cam.x - camBefore.x).toFixed(1)}, ${(cam.y - camBefore.y).toFixed(1)}`);

  console.log('\n[10] 网格开关');
  await page.click('#btnGrid');
  await page.waitForTimeout(60);
  const gridMode = await page.evaluate(() => window.whiteboard.state.board.grid);
  check('网格模式切换', gridMode === 'lines', gridMode);

  console.log('\n[11] 导出');
  const svgDownload = page.waitForEvent('download');
  await page.evaluate(() => window.whiteboard.export.exportSVG());
  const dl = await svgDownload;
  await dl.saveAs(join(SHOTS, 'export.svg'));
  const svgText = await readFile(join(SHOTS, 'export.svg'), 'utf8');
  check('SVG 含路径与文字', svgText.startsWith('<svg') && svgText.includes('<path') && svgText.includes('<text'), `长度 ${svgText.length}`);
  const pngDownload = page.waitForEvent('download');
  const pngSize = await page.evaluate(() => window.whiteboard.export.exportPNG());
  const png = await pngDownload;
  await png.saveAs(join(SHOTS, 'export.png'));
  check('PNG 导出成功', png.suggestedFilename().endsWith('.png'), png.suggestedFilename());
  const pngBytes = (await readFile(join(SHOTS, 'export.png'))).length;
  check(`PNG 有实际像素数据（${pngSize.width}×${pngSize.height}，${pngBytes} 字节）`,
    pngBytes > 4000 && pngSize.width > 100 && pngSize.height > 100);
  const jsonText = await page.evaluate(() => JSON.stringify(window.whiteboard.state.elements.length));
  check('文档可序列化', Number(jsonText) > 0);

  console.log('\n[12] 录制与回放');
  await page.evaluate(() => {
    window.whiteboard.state.elements = [];
    window.whiteboard.state.selection.clear();
    window.whiteboard.history.resetHistory();
    window.whiteboard.renderer.requestRender();
  });
  await page.keyboard.press('F9');
  await page.waitForTimeout(60);
  check('进入录制状态', await page.evaluate(() => window.whiteboard.state.session.recording));
  await page.keyboard.press('p');
  await scribble(page, { x: 300, y: 300, len: 200, steps: 10 });
  await page.waitForTimeout(200);
  await scribble(page, { x: 300, y: 460, len: 200, steps: 10 });
  await page.keyboard.press('F9');
  await page.waitForTimeout(60);
  const timing = await page.evaluate(() =>
    window.whiteboard.state.elements.map((e) => ({ t: e.t, dur: e.dur }))
  );
  check('笔迹带时间轴', timing.length === 2 && timing[1].t > 0, JSON.stringify(timing));
  const duration = await page.evaluate(() => {
    const last = window.whiteboard.state.elements.at(-1);
    return last.t + (last.dur || 0);
  });
  await page.keyboard.press('F10');
  await page.waitForTimeout(150);
  check('回放已启动', await page.evaluate(() => window.whiteboard.state.playback.active));
  check('回放进度条可见', await page.evaluate(() => !document.getElementById('playback').hidden));
  const midVisible = await page.evaluate(() => {
    const c = document.getElementById('board');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 200) dark++;
    return dark;
  });
  await page.evaluate(() => window.whiteboard.state.playback.t = window.whiteboard.state.playback.duration);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, '06-playback.png') });
  check('回放期间画面有内容', midVisible > 100, `深色像素 ${midVisible}，总时长 ${duration.toFixed(0)}ms`);
  await page.evaluate(() => {
    if (!document.getElementById('playback').hidden) document.getElementById('btnPlayClose').click();
  });
  await page.waitForTimeout(80);
  check('可退出回放', await page.evaluate(() => !window.whiteboard.state.playback.active));

  console.log('\n[13] 本地持久化');
  await page.evaluate(() => window.whiteboard.saveLocalNow());
  const savedCount = await count(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.whiteboard, null, { timeout: 8000 });
  await page.waitForTimeout(200);
  const restoredCount = await count(page);
  check(`刷新后恢复文档（${savedCount} → ${restoredCount}）`, restoredCount === savedCount);
  await page.screenshot({ path: join(SHOTS, '07-restored.png') });

  console.log('\n[14] 面板拖动与折叠');
  const toolbarBefore = await page.evaluate(() => document.getElementById('toolbar').getBoundingClientRect().left);
  await page.mouse.move(toolbarBefore + 40, 90);
  await page.mouse.down();
  await page.mouse.move(toolbarBefore + 180, 200, { steps: 5 });
  await page.mouse.up();
  const toolbarAfter = await page.evaluate(() => document.getElementById('toolbar').getBoundingClientRect().left);
  check('工具条可拖动', toolbarAfter > toolbarBefore + 50, `${toolbarBefore.toFixed(0)} → ${toolbarAfter.toFixed(0)}`);
  await page.click('#btnCollapseTools');
  await page.waitForTimeout(60);
  check('工具条可折叠', await page.evaluate(() => document.getElementById('toolbar').classList.contains('is-collapsed')));
  await page.click('#btnCollapseTools');

  console.log('\n[15] 帮助弹窗');
  await page.keyboard.press('?');
  await page.waitForTimeout(80);
  check('帮助弹窗打开', await page.evaluate(() => !document.getElementById('helpModal').hidden));
  const keyRows = await page.evaluate(() => document.querySelectorAll('#helpTools li').length);
  check(`快捷键列表完整（${keyRows} 项）`, keyRows >= 10);
  await page.screenshot({ path: join(SHOTS, '08-help.png') });
  await page.click('#helpModal .modal__head [data-close-modal]');
  await page.waitForTimeout(80);
  check('帮助弹窗可关闭', await page.evaluate(() => document.getElementById('helpModal').hidden));

  console.log('\n[16] 运行期错误');
  check('无 console / page 错误', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  server.kill();

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    console.log('失败明细：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`截图保存在 ${SHOTS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

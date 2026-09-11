/**
 * tools/build.mjs —— 构建单文件离线版 dist/whiteboard.html
 * 把 CSS 与全部 JS 模块打包内联，生成后可双击直接用（无需服务器）。
 * 运行：npm run build
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 1) 打包 JS
  const jsResult = await build({
    entryPoints: [join(ROOT, 'js', 'main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    write: false,
    logLevel: 'silent',
  });
  // 防止打包产物中的字面量 </script> / <!-- 提前结束内联脚本
  const js = jsResult.outputFiles[0].text.replace(/<!--/g, '<\\!--').replace(/<\/script/gi, '<\\/script');

  // 2) 读取 CSS 与 HTML
  const css = await readFile(join(ROOT, 'assets', 'whiteboard.css'), 'utf8');
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');

  // 3) 内联替换
  html = html.replace(
    /<link rel="stylesheet" href="assets\/whiteboard.css"[^>]*\/?>/,
    `<style>\n${css}\n</style>`
  );
  html = html.replace(
    /<script type="module" src="js\/main.js"><\/script>/,
    `<script>\n${js}\n<\/script>`
  );

  const outPath = join(OUT, 'whiteboard.html');
  await writeFile(outPath, html);
  const bytes = (await readFile(outPath)).length;
  console.log(`已生成 ${outPath}（${(bytes / 1024).toFixed(1)} KB）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

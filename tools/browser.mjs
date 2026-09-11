/**
 * tools/browser.mjs —— 在受限网络下取得可用的 Chromium
 * 优先使用 CHROMIUM_PATH / 系统浏览器，否则从 npm 包 @sparticuz/chromium 解出二进制与依赖库。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

function works(path, env) {
  try {
    execFileSync(path, ['--version'], { env, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 解出 @sparticuz/chromium 自带的 nss/nspr 等动态库 */
function extractLibs() {
  const pkgDir = require.resolve('@sparticuz/chromium/package.json');
  const binDir = join(pkgDir, '..', 'bin');
  const outDir = join(tmpdir(), 'wb-chromium-libs');
  if (!existsSync(join(outDir, 'libnss3.so'))) {
    mkdirSync(outDir, { recursive: true });
    for (const name of ['al2023', 'al2']) {
      const tarPath = join(binDir, `${name}.tar.br`);
      if (!existsSync(tarPath)) continue;
      const tar = brotliDecompressSync(readFileSync(tarPath));
      writeFileSync(join(outDir, `${name}.tar`), tar);
      execFileSync('tar', ['-xf', join(outDir, `${name}.tar`), '-C', outDir]);
      break;
    }
  }
  return join(outDir, 'lib');
}

export async function resolveBrowser() {
  const baseEnv = { ...process.env };

  for (const path of CANDIDATES) {
    if (existsSync(path) && works(path, baseEnv)) return { executablePath: path, env: baseEnv };
  }

  let chromium;
  try {
    chromium = (await import('@sparticuz/chromium')).default;
  } catch {
    throw new Error('未找到 Chromium：请设置 CHROMIUM_PATH，或 npm i -D @sparticuz/chromium');
  }

  const executablePath = await chromium.executablePath();
  const libDir = extractLibs();
  const env = {
    ...baseEnv,
    LD_LIBRARY_PATH: [libDir, baseEnv.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  };
  if (!works(executablePath, env)) {
    throw new Error(`Chromium 无法运行：${executablePath}（缺少系统依赖库）`);
  }
  return { executablePath, env };
}

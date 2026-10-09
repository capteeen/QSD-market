/**
 * Renders the product video frame by frame.
 *
 *   pnpm --filter @qsd/video render                 1920×1080, 30 fps, 20 s → out/qsd-product-video.mp4
 *   VIDEO_FPS=60 VIDEO_OUT=out/x.mp4 …              options
 *   VIDEO_FROM=4 VIDEO_TO=8 …                       render a slice (seconds)
 *   VIDEO_STILLS=0,4.5,9,12,15,18 …                 only these instants, as PNGs in out/stills/
 *
 * Builds the page with Vite, opens it in headless Chromium (software GL),
 * freezes the page clock (performance.now / Date.now) and steps it one
 * frame at a time through window.__seek(t), screenshotting each frame into
 * ffmpeg. Deterministic: every frame is a pure function of t and of the
 * real XMSS run the page computed on load.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const fps = Number(process.env.VIDEO_FPS ?? 30);
const from = Number(process.env.VIDEO_FROM ?? 0);
const to = Number(process.env.VIDEO_TO ?? 20);
const outFile = resolve(pkg, process.env.VIDEO_OUT ?? 'out/qsd-product-video.mp4');
const stills = process.env.VIDEO_STILLS ? process.env.VIDEO_STILLS.split(',').map(Number) : null;
const W = 1920;
const H = 1080;

function findChromium(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const candidates = [join(base, 'chromium-1194', 'chrome-linux', 'chrome'), join(base, 'chromium', 'chrome-linux', 'chrome'), join(base, 'chromium_headless_shell-1194', 'chrome-linux', 'headless_shell')];
  return candidates.find((p) => existsSync(p));
}

function findFfmpeg(): string {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const candidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', join(base, 'ffmpeg-1011', 'ffmpeg-linux')];
  return candidates.find((p) => existsSync(p)) ?? 'ffmpeg';
}

async function main(): Promise<void> {
  const configFile = resolve(pkg, 'vite.config.ts');
  await build({ configFile, logLevel: 'error' });
  const server = await preview({ configFile, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 4178;
  const url = `http://127.0.0.1:${port}/`;

  const executablePath = findChromium();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  // Freeze the page clock: the page advances it through window.__seek.
  await context.addInitScript(`
    window.__now = 0;
    Object.defineProperty(performance, 'now', { value: function () { return window.__now; }, configurable: true });
    Date.now = function () { return 1760000000000 + window.__now; };
  `);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  // let the scene mount and settle at t = 0
  for (let i = 0; i < 3; i++) await page.evaluate((t) => window.__seek(t), 0);
  if (errors.length) console.error('[video] page errors:\n' + errors.join('\n'));

  mkdirSync(dirname(outFile), { recursive: true });
  if (stills) {
    const dir = resolve(pkg, 'out/stills');
    mkdirSync(dir, { recursive: true });
    for (const t of stills) {
      await page.evaluate((x) => window.__seek(x), t);
      const png = await page.screenshot({ type: 'png' });
      writeFileSync(join(dir, `t${t.toFixed(2).replace('.', '_')}.png`), png);
      console.error(`[video] still t=${t}`);
    }
  } else {
    const ffmpeg = spawn(findFfmpeg(), ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
    const frames = Math.round((to - from) * fps);
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = from + i / fps;
      await page.evaluate((x) => window.__seek(x), t);
      const png = await page.screenshot({ type: 'png' });
      if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
      if (i % fps === 0) console.error(`[video] t=${t.toFixed(2)}s (${i}/${frames}) ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed`);
    }
    ffmpeg.stdin.end();
    await new Promise<void>((res, rej) => ffmpeg.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
    console.error(`[video] wrote ${outFile}`);
  }
  if (errors.length) console.error('[video] page errors:\n' + errors.join('\n'));
  await browser.close();
  await server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

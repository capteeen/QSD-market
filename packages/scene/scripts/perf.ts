/**
 * Frame-time test.
 *
 *   pnpm --filter @qsd/scene perf                 software GL (SwiftShader), CPU 4× throttled
 *   PERF_GPU=1 pnpm --filter @qsd/scene perf      real GPU (the ≥ 55 fps gate), CPU 4× throttled
 *   PERF_THROTTLE=1 …                             no CPU throttling
 *   PERF_VIEWPORT=1280x800 …                      default 390x844 (phone)
 *   PERF_QUALITY=ultra|high|medium|low|auto       default auto
 *   PERF_MODE=full|empty                          default full; 'empty' feeds no events
 *   PERF_HEADED=1                                 show the browser
 *   PERF_DSF=1                                    device scale factor (default 2)
 *   PERF_PROFILE=1                                CPU-profile the run and print the top self-time functions
 *   PERF_TIMEOUT_MS=600000                        give up waiting for the sequence after this long
 *
 * Replays the recorded real event stream through the full <LaunchSequence />
 * and reports median / p5 / p95 fps per phase, measured from
 * requestAnimationFrame deltas inside the page. Exits 1 when the gate fails
 * (only enforced with PERF_GPU=1 — SwiftShader is a lower bound, not the gate).
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { FIXTURE_DIR, generateFixture, writeFixture } from '../test/fixtures/generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const gpu = process.env.PERF_GPU === '1';
const throttle = Number(process.env.PERF_THROTTLE ?? 4);
const [vw, vh] = (process.env.PERF_VIEWPORT ?? '390x844').split('x').map(Number) as [number, number];
const quality = process.env.PERF_QUALITY ?? 'auto';
const mode = process.env.PERF_MODE ?? 'full';
const gate = Number(process.env.PERF_GATE ?? 55);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;
}

function stats(frames: number[]): { n: number; medianFps: number; p5Fps: number; p95Fps: number; meanMs: number } {
  const dts = frames.filter((d) => d > 0 && d < 2).sort((a, b) => a - b);
  const fps = dts.map((d) => 1 / d).sort((a, b) => a - b);
  return {
    n: dts.length,
    medianFps: percentile(fps, 0.5),
    p5Fps: percentile(fps, 0.05),
    p95Fps: percentile(fps, 0.95),
    meanMs: dts.length ? (dts.reduce((a, b) => a + b, 0) / dts.length) * 1000 : Number.NaN,
  };
}

function findChromium(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const candidates = [
    join(base, 'chromium-1194', 'chrome-linux', 'chrome'),
    join(base, 'chromium', 'chrome-linux', 'chrome'),
    join(base, 'chromium_headless_shell-1194', 'chrome-linux', 'headless_shell'),
  ];
  return candidates.find((p) => existsSync(p));
}

async function main(): Promise<void> {
  if (!existsSync(join(FIXTURE_DIR, 'crypto.bin'))) {
    console.log('recording fixture (first run) …');
    writeFixture(await generateFixture());
  }

  // Build once and serve the static bundle: a dev server re-optimises
  // dependencies on first load and reloads the page, which would reset the
  // in-page measurement. Production bundle = what users run.
  const configFile = resolve(here, '../perf/vite.config.ts');
  await build({ configFile, logLevel: 'error' });
  const server = await preview({ configFile, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 4177;
  const url = `http://127.0.0.1:${port}/?mode=${mode}&quality=${quality}`;

  const swiftshader = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const real = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const executablePath = findChromium();
  const browser = await chromium.launch({
    headless: process.env.PERF_HEADED !== '1',
    ...(executablePath ? { executablePath } : {}),
    // rAF stays tied to presentation (no --disable-frame-rate-limit / --disable-gpu-vsync):
    // unthrottled rAF outruns the GPU on software GL and then blocks for seconds
    // when the command queue drains, producing fictitious frame rates.
    args: [...(gpu ? real : swiftshader), '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const dsf = Number(process.env.PERF_DSF ?? 2);
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dsf });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

  const profiling = process.env.PERF_PROFILE === '1';
  if (profiling) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 2000 });
    await cdp.send('Profiler.start');
  }
  const tStart = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  const firstFrame = await page.waitForFunction(() => window.__qsdPerf && window.__qsdPerf.frames.length > 0, null, { timeout: 60_000 }).then(() => Date.now() - tStart);
  // poll with progress on stderr (software GL can be very slow; this shows where it is)
  const deadline = Date.now() + Number(process.env.PERF_TIMEOUT_MS ?? 600_000);
  for (;;) {
    const p = await page.evaluate(() => {
      const r = window.__qsdPerf;
      if (!r) return null;
      const last = r.frames[r.frames.length - 1];
      return { done: r.done, frames: r.frames.length, lastMs: last ? Math.round(last * 1000) : null, stages: r.stages.map((s) => s.stage).join('→'), error: r.error };
    });
    console.error(`[perf] t=${((Date.now() - tStart) / 1000).toFixed(0)}s ${JSON.stringify(p)}`);
    if (p?.done) break;
    if (p === null) {
      console.error('[perf] window.__qsdPerf vanished — the page reloaded or navigated');
      process.exit(1);
    }
    if (Date.now() > deadline) {
      console.error('[perf] timeout waiting for the sequence to finish');
      process.exit(1);
    }
    await page.waitForTimeout(5000);
  }
  const perf = await page.evaluate(() => window.__qsdPerf);
  if (profiling) {
    const { profile } = (await cdp.send('Profiler.stop')) as {
      profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] };
    };
    const self = new Map<number, number>();
    profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    const byFn = new Map<string, number>();
    for (const n of profile.nodes) {
      const key = `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber}`;
      byFn.set(key, (byFn.get(key) ?? 0) + (self.get(n.id) ?? 0));
    }
    const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.error('[perf] top self-time (ms):');
    for (const [k, us] of top) console.error(`  ${(us / 1000).toFixed(0).padStart(7)}  ${k}`);
  }
  const glInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const gl = c?.getContext('webgl2') ?? c?.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  await browser.close();
  await server.close();

  const all = stats(perf.frames);
  const phases = Object.fromEntries(Object.entries(perf.phases).map(([k, v]) => [k, stats(v)]));
  // stalls: gaps between consecutive frames longer than 500 ms, with the phase they fell in
  const stalls: { atS: number; ms: number; phase: string }[] = [];
  for (let i = 1; i < perf.frameAt.length; i++) {
    const gap = (perf.frameAt[i] as number) - (perf.frameAt[i - 1] as number);
    if (gap > 500) stalls.push({ atS: Math.round(perf.frameAt[i - 1] as number) / 1000, ms: Math.round(gap), phase: perf.framePhase[i] ?? '?' });
  }
  const report = {
    method: {
      renderer: glInfo,
      gl: gpu ? 'real GPU' : 'SwiftShader (software GL) — a lower bound, NOT the gate',
      cpuThrottle: `${throttle}×`,
      viewport: `${vw}x${vh} @${dsf}x`,
      quality,
      mode,
      stream: 'recorded real createIdentity + sign + UNSAFE_DEV_RANDOM draw, replayed at recorded keygen rate',
    },
    firstFrameMs: firstFrame,
    overall: all,
    phases,
    stages: perf.stages,
    stalls,
    finalState: perf.finalState,
    errors,
    pageError: perf.error,
  };
  console.log(JSON.stringify(report, null, 2));

  if (perf.error) {
    console.error(`page error: ${perf.error}`);
    process.exit(1);
  }
  if (mode === 'full' && perf.finalState) {
    const f = perf.finalState;
    const ok = f.stage === 8 && f.chainSteps === 274_432 && f.leaves === 256 && f.fused === 255 && f.stops === 67 && f.auth === 8;
    if (!ok) {
      console.error('correctness failure: the replayed stream did not reproduce the full counts');
      process.exit(1);
    }
  }
  if (gpu && all.medianFps < gate) {
    console.error(`GATE FAILED: median ${all.medianFps.toFixed(1)} fps < ${gate}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

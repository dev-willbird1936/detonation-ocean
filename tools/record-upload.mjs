// Records one upload through the local demo (start-hackathon-demo.bat) as an MP4: main menu, drop panel, the ocean show step by step (octopus,
// clam, fish, dive), then the full report page. Usage: node tools/record-upload.mjs <file> <out.mp4>. Needs playwright-core, its headless shell and ffmpeg.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [file, out] = process.argv.slice(2).map((p) => resolve(p));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || 'C:/Temp/pw-kimi/node_modules/playwright-core');
const shell = 'C:/Users/warcr/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const dir = mkdtempSync(join(tmpdir(), 'record-'));
const size = { width: 1280, height: 800 };

const browser = await chromium.launch({ executablePath: shell, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.waitForTimeout(6000); // the dive-in intro
  await page.setInputFiles('.drop-file', file);
  await page.check('#drop-consent');
  await page.waitForTimeout(1000);
  await page.click('.drop-go');
  await page.waitForSelector('.os-bar', { timeout: 30000 });
  // The ocean show: let each step play, then press Next once the sandbox has reached the following one.
  const dwell = [9000, 5500, 6000, 5500, 9000, 6500];
  for (const ms of dwell) {
    await page.waitForTimeout(ms);
    await page.waitForSelector('.os-next:not([disabled])', { timeout: 240000 });
    await page.click('.os-next');
  }
  await page.waitForTimeout(4500); // teardown step: receipt and the report buttons
  await Promise.all([page.waitForURL(/\/job\//, { timeout: 30000 }), page.click('.os-primary')]);
  await page.waitForFunction(() => /Sandbox destroyed|Teardown/i.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(7000); // the full report page
  console.log('final URL', page.url());
  console.log('verdict text:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 400));
} finally {
  await context.close(); // flushes the video
  await browser.close();
}
const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
rmSync(dir, { recursive: true, force: true });
console.log('saved', out, errors.length ? `page errors: ${errors.slice(0, 3)}` : 'no page errors');

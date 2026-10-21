// Headless check of the live world stream (docs/desktop-parity/BACKEND.md): a sandbox controller POSTs events to
// /api/desktop/events and both final shells show them live, before and after an OS swap. Real Chromium, real shells,
// every non-loopback request aborted. Not part of `node --test` (it needs Chromium); run it directly:
//   node tests/desktop-world-stream-e2e.mjs
// Ports default to 4470/4471 so it can run beside tools/e2e/desktops-e2e.mjs. Screens: screens/final-stream-*.png.
process.env.E2E_PARENT_PORT ||= '4470';
process.env.E2E_SHELLS_PORT ||= '4471';
const { start, openScene, OUT, PARENT, FAIL_DIR } = await import('../tools/e2e/desktops-e2e-lib.mjs');

const RUN = 'stream-e2e';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const post = async event => {
  const response = await fetch(`${PARENT}/api/desktop/events?run=${RUN}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  return { status: response.status, body: await response.json() };
};
const shot = (s, name) => s.page.screenshot({ path: `${OUT}/final-stream-${name}.png` });
const shellWorld = (s, os) => s.frame(os).evaluate(() => window.OceanWorldAdapter.world);
const waitShell = async (s, os, test, label) => {
  for (const end = Date.now() + 10000; Date.now() < end; await s.page.waitForTimeout(150)) if (test(await shellWorld(s, os))) return true;
  throw new Error(`timed out: ${label} in ${os}`);
};
const visible = (s, os, text) => s.frame(os).getByText(text, { exact: false }).first().isVisible({ timeout: 6000 }).catch(() => false);
const mail = (id, subject, to, time) => ({ id, folder: 'inbox', from: 'Sandbox Controller <controller@northwind.example>', to, subject,
  body: 'Fictional event pushed by the local sandbox controller.', time, read: false, flagged: false, attachments: [] });

const { ctx, external, stop } = await start();
const s = await openScene(ctx, `deception-midnight&run=${RUN}`);
try {
  await s.page.waitForSelector('body[data-world-stream="open"]', { timeout: 15000 });
  check('parent subscribed to the run', true);

  // Sign in on Windows (as the main e2e does).
  const win = s.frame('windows');
  await win.locator('[data-testid=lock-screen]').waitFor({ timeout: 20000 });
  await s.page.waitForTimeout(1200);
  await s.page.mouse.click(720, 450);
  await s.page.waitForTimeout(800);
  await win.getByRole('button', { name: 'Sign in' }).click();
  await s.waitScene(state => state.auth === 'desktop', 'signed in');
  await s.page.waitForTimeout(1500);

  // 1. A process observed in the sandbox, plus a new mail, while Windows is visible.
  let world = await s.world();
  const first = await post({ type: 'patch', patch: { data: {
    processes: [{ id: 'ev-proc', name: 'LedgerSync Helper (simulated)', cpu: 63, mem: 212, publisher: 'Unknown publisher', suspicious: true }],
    mail: { messages: [...world.data.mail.messages, mail('ev-mail-1', 'Sandbox: process observed (simulated)', world.user.email, '2026-11-02T09:40:00Z')] },
  } } });
  check('POST patch accepted and delivered', first.status === 202 && first.body.delivered === 1, JSON.stringify(first.body));
  await waitShell(s, 'windows', w => w.data.processes?.some(p => p.id === 'ev-proc'), 'process');
  await s.emit('windows', { kind: 'open-app', app: 'taskmanager' });
  await s.page.waitForTimeout(1500);
  check('Windows Task Manager lists the pushed process live', await visible(s, 'windows', 'LedgerSync Helper (simulated)'));
  await shot(s, '01-process-windows');

  // 2. Swap to macOS: the same world, and Activity Monitor shows the same process.
  await s.swap('macos');
  await waitShell(s, 'macos', w => w.data.processes?.some(p => p.id === 'ev-proc'), 'process after swap');
  check('macOS has the pushed process and mail after the swap', (await shellWorld(s, 'macos')).data.mail.messages.some(m => m.id === 'ev-mail-1'));
  await s.page.waitForTimeout(800);
  check('macOS Activity Monitor lists the pushed process', await visible(s, 'macos', 'LedgerSync Helper (simulated)'));
  await shot(s, '02-process-after-swap-macos');

  // 3. While macOS is visible: a file encrypted (new mail + Downloads file) arrives live.
  world = await s.world();
  const second = await post({ type: 'patch', patch: {
    data: { mail: { messages: [...world.data.mail.messages, mail('ev-mail-2', 'Sandbox: Q4-ledger.xlsx encrypted (simulated)', world.user.email, '2026-11-02T09:41:00Z')] },
      contents: { 'c-ev-file': { text: 'Fictional: this file was encrypted in the sandbox.' } } },
    fs: { nodes: { 'ev-file': { id: 'ev-file', parentId: 'downloads', name: 'Q4-ledger.xlsx.locked', kind: 'file', mime: 'text/plain', size: 52, modified: '2026-11-02T09:41:00Z', trashed: false, contentId: 'c-ev-file' } } },
  } });
  check('second POST accepted', second.status === 202, JSON.stringify(second.body));
  await waitShell(s, 'macos', w => w.data.mail.messages.some(m => m.id === 'ev-mail-2'), 'live mail');
  await s.frame('macos').locator('button[aria-label=Mail].dock-icon').click();
  await s.page.waitForTimeout(1500);
  check('macOS Mail shows the mail pushed while it was visible', await visible(s, 'macos', 'Q4-ledger.xlsx encrypted'));
  await shot(s, '03-live-mail-macos');

  // 4. Back to Windows: the event pushed during macOS is there too.
  await s.swap('windows');
  await waitShell(s, 'windows', w => w.data.mail.messages.some(m => m.id === 'ev-mail-2') && w.fs.nodes['ev-file'], 'mail and file after swap');
  await s.emit('windows', { kind: 'open-app', app: 'mail' });
  await s.page.waitForTimeout(1500);
  check('Windows Mail shows the mail pushed during macOS', await visible(s, 'windows', 'Q4-ledger.xlsx encrypted'));
  await shot(s, '04-mail-after-swap-windows');
  await s.emit('windows', { kind: 'open-app', app: 'files', payload: { folderId: 'downloads' } });
  await s.page.waitForTimeout(1500);
  check('Windows File Explorer shows the pushed file', await visible(s, 'windows', 'Q4-ledger.xlsx.locked'));
  await shot(s, '05-file-windows');

  // 5. An invalid event is refused by the server and never reaches either shell.
  const before = (await s.world()).revision;
  const refused = await post({ type: 'patch', patch: { sys: { wallpaperUrl: 'https://cdn.example/x.png' } } });
  await s.page.waitForTimeout(500);
  check('invalid patch refused with 422 and not applied', refused.status === 422 && (await s.world()).revision === before, JSON.stringify(refused.body));
  check('no page errors', s.errors.length === 0, s.errors.join(' | '));
} catch (error) {
  check('completed', false, error.message.split('\n').slice(0, 8).join(' / '));
  await s.page.screenshot({ path: `${FAIL_DIR}/fail-stream.png` });
}
check('zero non-loopback requests', external.length === 0, external.slice(0, 5).join(' '));
await s.page.close();
await stop();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exitCode = passed === results.length ? 0 : 1;

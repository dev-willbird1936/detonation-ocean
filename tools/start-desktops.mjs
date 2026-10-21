// Loopback launcher for the training desktops: app (default 4173) plus final Windows/macOS shells (default 4189).
// A project server already on either port is reused only when its GET /api/health buildId equals the files on disk;
// otherwise it is stopped and both servers start fresh in this process. Any other listener is refused, never stopped.
import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeDesktopBuildId } from '../backend/desktop-world-build.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_APP_PORT = 4173;
export const DEFAULT_SHELLS_PORT = 4189;
export const FLAGSHIP_PROFILE = 'network-abuse-abyss';
const HOST = '127.0.0.1';
const SHELL_PAGES = { windows: '/previews/win11-final/index.html', macos: '/previews/macos-final/index.html' };
const PROJECT_SCRIPT_RE = /(?:^|[\s"'/\\])(?:desktop-comparison[/\\])?(?:server|tools[/\\]start-desktops|start-desktops)\.mjs(?:["'\s]|$)/i;

// The files on disk, hashed by the same function server.mjs uses for its GET /api/health buildId.
export const computeBuildId = (root = ROOT) => computeDesktopBuildId(root);

export function readPorts(env = process.env) {
  const port = (value, fallback, name) => {
    const number = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isInteger(number) || number < 1024 || number > 65535) throw new Error(`${name} must be an integer from 1024 through 65535.`);
    return number;
  };
  const appPort = port(env.PORT, DEFAULT_APP_PORT, 'PORT');
  const shellsPort = port(env.SHELLS_PORT, DEFAULT_SHELLS_PORT, 'SHELLS_PORT');
  if (appPort === shellsPort) throw new Error('PORT and SHELLS_PORT must differ.');
  return { appPort, shellsPort };
}

const normalise = text => text.replaceAll('\\', '/').toLowerCase();

// A listener belongs to this project only if it is node running one of our server scripts, and either its command line
// names this project folder or the port answers with this project's routes (`signature`).
export function isProjectProcess(owner, root = ROOT) {
  if (!owner || !/^node(?:\.exe)?$/i.test(owner.name || '')) return false;
  const commandLine = owner.commandLine || '';
  if (!PROJECT_SCRIPT_RE.test(commandLine)) return false;
  return normalise(commandLine).includes(`${normalise(resolve(root)).replace(/\/$/, '')}/`) || owner.signature === true;
}

const describe = (port, owner) => `port ${port} is held by PID ${owner.pid} (${owner.name || 'unknown process'}: ${owner.commandLine || 'command line unavailable'})`;

// Decide what to do with whatever holds the two ports. Pure: all system facts are passed in.
export function planLaunch({ appPort, shellsPort, app, shells, health, currentBuildId, root = ROOT }) {
  const foreign = [[appPort, app], [shellsPort, shells]].filter(([, owner]) => owner && !isProjectProcess(owner, root));
  if (foreign.length) {
    return { action: 'refuse', stop: [], reason: `${foreign.map(([port, owner]) => describe(port, owner)).join('; ')}. It is not this project's server, so it was not stopped. Close it or choose other ports (PORT, SHELLS_PORT).` };
  }
  if (!app && !shells) return { action: 'start', stop: [], reason: 'Both ports are free.' };
  const stop = [...new Set([app?.pid, shells?.pid].filter(pid => pid !== undefined))];
  if (!app || !shells) return { action: 'restart', stop, reason: `Only ${app ? `port ${appPort}` : `port ${shellsPort}`} is held by a project server; restarting both together.` };
  if (app.pid !== shells.pid) return { action: 'restart', stop, reason: 'The app and shells ports are held by different project processes; restarting both together.' };
  if (!health?.buildId) return { action: 'restart', stop, reason: `The running server (PID ${app.pid}) has no /api/health buildId, so it predates the current build check; treating it as stale.` };
  if (health.buildId !== currentBuildId) return { action: 'restart', stop, reason: `The running server (PID ${app.pid}) has build ${health.buildId}; the files on disk are build ${currentBuildId}.` };
  return { action: 'reuse', stop: [], reason: `The running server (PID ${app.pid}) is current (build ${currentBuildId}).` };
}

const run = (file, args) => new Promise(done => execFile(file, args, { windowsHide: true, timeout: 15000 }, (error, stdout) => done(error ? '' : String(stdout))));

// PID, image name and command line of the process listening on a loopback-reachable TCP port, or null.
export async function findListener(port) {
  let pid;
  if (process.platform === 'win32') {
    for (const line of (await run('netstat.exe', ['-ano', '-p', 'TCP'])).split(/\r?\n/)) {
      const [, local, , state, owner] = line.trim().split(/\s+/);
      if (state === 'LISTENING' && /^(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d+)$/.test(local || '') && local.endsWith(`:${port}`)) { pid = Number(owner); break; }
    }
    if (!pid) return null;
    const info = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object Name,CommandLine | ConvertTo-Json -Compress`]);
    let parsed = {};
    try { parsed = JSON.parse(info) ?? {}; } catch { /* process exited or access denied */ }
    return { pid, name: parsed.Name || '', commandLine: parsed.CommandLine || '' };
  }
  pid = Number((await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])).split('\n')[0]);
  if (!pid) return null;
  return { pid, name: (await run('ps', ['-o', 'comm=', '-p', String(pid)])).trim().split('/').pop(), commandLine: (await run('ps', ['-o', 'args=', '-p', String(pid)])).trim() };
}

async function getJson(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function answers(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(2000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

// Route fingerprints of this project: /api/healthz on the app server, the bridge script route on the comparison server.
export async function probeSignature(origin, role, fetchImpl = fetch) {
  if (role === 'shells') return answers(`${origin}/previews/ocean-scenes.js`, fetchImpl);
  const body = await getJson(`${origin}/api/healthz`, fetchImpl);
  return body?.ok === true && typeof body.mode === 'string' && 'externalNetwork' in body;
}

export const probeHealth = (origin, fetchImpl = fetch) => getJson(`${origin}/api/health`, fetchImpl);

export function demoUrls(appOrigin, shellsOrigin) {
  return {
    matrix: `${appOrigin}/ocean-profiles.html`,
    flagship: `${appOrigin}/desktop.html?profile=${FLAGSHIP_PROFILE}`,
    windows: `${shellsOrigin}${SHELL_PAGES.windows}`,
    macos: `${shellsOrigin}${SHELL_PAGES.macos}`,
  };
}

// Fetch both shell pages and the world; throws with every failed check listed.
export async function smokeCheck(appOrigin, shellsOrigin, fetchImpl = fetch) {
  const failures = [];
  const check = async (label, url, test) => {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      const body = await response.text();
      if (!response.ok) failures.push(`${label}: HTTP ${response.status} from ${url}`);
      else if (!test(body, response)) failures.push(`${label}: unexpected body from ${url}`);
    } catch (error) {
      failures.push(`${label}: ${error.message} (${url})`);
    }
  };
  const isHtml = body => /<html[\s>]/i.test(body);
  const isWorld = body => { try { const world = JSON.parse(body); return Boolean(world && typeof world === 'object' && world.sys && world.installed); } catch { return false; } };
  await Promise.all([
    check('Windows shell', `${shellsOrigin}${SHELL_PAGES.windows}`, isHtml),
    check('macOS shell', `${shellsOrigin}${SHELL_PAGES.macos}`, isHtml),
    check('World', `${appOrigin}/api/desktop/world`, isWorld),
    check('Flagship world', `${appOrigin}/api/desktop/world?profile=${FLAGSHIP_PROFILE}`, isWorld),
    check('Shell origin', `${appOrigin}/api/desktop-templates/status`, body => {
      try { const status = JSON.parse(body); return status.enabled === true && status.shellOrigin === shellsOrigin; } catch { return false; }
    }),
  ]);
  if (failures.length) throw new Error(`Smoke check failed:\n  ${failures.join('\n  ')}`);
}

const portFree = port => new Promise(done => {
  const socket = connect(port, HOST);
  socket.once('connect', () => { socket.destroy(); done(false); });
  socket.once('error', () => done(true));
});

export async function waitForPortsFree(ports, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await Promise.all(ports.map(portFree))).every(Boolean)) return;
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error(`Ports ${ports.join(' and ')} are still in use after stopping the stale server.`);
}

// Both servers in this process. The comparison server lets only 127.0.0.1:4173 frame the shells; on other app ports
// the CSP header (not the body) is widened to this app origin, as tools/e2e does.
export async function startServers({ appPort, shellsPort }) {
  for (const key of Object.keys(process.env)) if (key.startsWith('VULTR_')) delete process.env[key];
  const appOrigin = `http://${HOST}:${appPort}`;
  const shellsOrigin = `http://${HOST}:${shellsPort}`;
  const { createAppServer } = await import(pathToFileURL(join(ROOT, 'server.mjs')).href);
  const { createComparisonServer } = await import(pathToFileURL(join(ROOT, 'desktop-comparison/server.mjs')).href);
  const shells = createComparisonServer();
  if (appPort !== DEFAULT_APP_PORT) {
    const [handler] = shells.listeners('request');
    shells.removeListener('request', handler);
    shells.on('request', (request, response) => {
      const writeHead = response.writeHead;
      response.writeHead = (status, headers) => {
        if (headers?.['Content-Security-Policy']) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replaceAll(`http://${HOST}:${DEFAULT_APP_PORT}`, appOrigin);
        return writeHead.call(response, status, headers);
      };
      handler(request, response);
    });
  }
  const app = createAppServer({ templateShellsEnabled: true, shellOrigin: shellsOrigin });
  const listen = (server, port) => new Promise((done, reject) => {
    server.once('error', error => reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} was taken while starting; run the launcher again.`) : error));
    server.listen(port, HOST, done);
  });
  try {
    await listen(shells, shellsPort);
    await listen(app, appPort);
  } catch (error) {
    for (const server of [app, shells]) if (server.listening) server.close();
    app.teardownTrainingSessions?.();
    throw error;
  }
  const stop = async () => {
    try {
      await app.teardownActiveScenario();
    } catch {
      console.error('Teardown is unconfirmed; inspect the local execution environment before another run.');
    }
    for (const server of [app, shells]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  };
  return { appOrigin, shellsOrigin, stop };
}

function printUrls(appOrigin, shellsOrigin) {
  const urls = demoUrls(appOrigin, shellsOrigin);
  console.log(`Open:
  Creature matrix   ${urls.matrix}
  Flagship scene    ${urls.flagship}
  Windows 11 shell  ${urls.windows}
  macOS shell       ${urls.macos}
If a page is blank, hard-refresh it (Ctrl+Shift+R). See docs/desktop-parity/RUNNING.md.`);
}

async function main() {
  const { appPort, shellsPort } = readPorts();
  const appOrigin = `http://${HOST}:${appPort}`;
  const shellsOrigin = `http://${HOST}:${shellsPort}`;
  const currentBuildId = computeBuildId();
  const [app, shells] = await Promise.all([findListener(appPort), findListener(shellsPort)]);
  if (app) app.signature = await probeSignature(appOrigin, 'app');
  if (shells) shells.signature = await probeSignature(shellsOrigin, 'shells');
  const plan = planLaunch({ appPort, shellsPort, app, shells, health: app ? await probeHealth(appOrigin) : null, currentBuildId });
  console.log(plan.reason);
  if (plan.action === 'refuse') throw new Error('Launch refused.');
  if (plan.action === 'reuse') {
    await smokeCheck(appOrigin, shellsOrigin);
    console.log('Smoke check passed. Using the running server.');
    printUrls(appOrigin, shellsOrigin);
    return;
  }
  for (const pid of plan.stop) {
    console.log(`Stopping stale project server PID ${pid}.`);
    try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (plan.stop.length) await waitForPortsFree([appPort, shellsPort]);
  const servers = await startServers({ appPort, shellsPort });
  console.log(`Started build ${currentBuildId}: app ${appOrigin}, shells ${shellsOrigin}. Local synthetic only.`);
  try {
    await smokeCheck(appOrigin, shellsOrigin);
  } catch (error) {
    await servers.stop();
    throw error;
  }
  console.log('Smoke check passed.');
  printUrls(appOrigin, shellsOrigin);
  console.log('Keep this window open; Ctrl+C stops both servers.');
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; servers.stop(); } };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

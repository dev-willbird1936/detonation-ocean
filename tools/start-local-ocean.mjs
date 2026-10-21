// Durable, loopback-only ocean desktop. Always load source; never reuse an old server.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../local-ocean/', import.meta.url));
export const OCEAN_PORT = 4188;

export function oceanRevision() {
  const hash = createHash('sha256');
  function add(relative) {
    const full = join(root, relative);
    for (const entry of readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(relative, entry.name);
      if (entry.isDirectory()) add(file);
      else if (entry.isFile()) hash.update(file.replaceAll('\\', '/')).update('\0').update(readFileSync(join(root, file)));
      else throw new Error('Ocean runtime requires regular source files.');
    }
  }
  for (const file of ['server.mjs', 'build.mjs']) hash.update(readFileSync(join(root, file)));
  hash.update(readFileSync(fileURLToPath(import.meta.url)));
  for (const directory of ['backend', 'data', 'ui']) add(directory);
  return hash.digest('hex');
}

export async function createLocalOceanServer() {
  for (const key of Object.keys(process.env)) if (key.startsWith('VULTR_')) delete process.env[key];
  process.env.VULTR_SANDBOX_MODE = 'local';
  const revision = oceanRevision();
  const { createAppServer } = await import(pathToFileURL(join(root, 'server.mjs')).href);
  const server = createAppServer({
    browserContainerRunner: async () => { throw new Error('Container execution is disabled in the local ocean desktop.'); },
  });
  const [handler] = server.listeners('request');
  server.removeListener('request', handler);
  server.on('request', (request, response) => {
    if (request.method === 'GET' && ['/', '/index.html'].includes(request.url)) {
      response.writeHead(302, { Location: '/desktop.html', 'Cache-Control': 'no-store' });
      response.end();
    } else if (request.method === 'GET' && request.url === '/api/local-ocean-version') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify({ mode: 'local-synthetic', theme: 'ocean', revision }));
    } else handler(request, response);
  });
  return server;
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--no-browser')) throw new Error('Only --no-browser is supported.');
  const server = await createLocalOceanServer();
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(OCEAN_PORT, '127.0.0.1', ready);
  }).catch(async error => {
    await server.teardownActiveResources();
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${OCEAN_PORT} is occupied. Close the previous ocean server window, then run start.bat again. No existing server was reused or stopped.`);
    throw error;
  });
  const url = `http://127.0.0.1:${OCEAN_PORT}/desktop.html`;
  console.log(`Ocean desktop: ${url}\nSource revision: ${oceanRevision()}\nLocal synthetic only. Keep this window open; Ctrl+C stops the server.`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await server.teardownActiveResources();
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    } catch {
      console.error('Local cleanup is unconfirmed; the listener was retained.');
      stopping = false;
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (process.platform === 'win32' && !process.argv.includes('--no-browser')) {
    const browser = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.error(`Browser could not open automatically. Open ${url} manually.`));
    browser.unref();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

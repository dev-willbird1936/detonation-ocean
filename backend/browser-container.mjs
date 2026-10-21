import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { findPersona, loadPersonas } from './personas.mjs';

export const DEFAULT_BROWSER_IMAGE = 'vultr-oauth-browser:local';
export const BROWSER_CONTAINER_TIMEOUT_MS = 90_000;
const MAX_INPUT_BYTES = 4096;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 512 * 1024;
const MAX_EVENTS = 100;
const EXPECTED_SCREENSHOTS = ['desktop-before-optin', 'consent-ready', 'receipt'];
const PERSONAS = loadPersonas();

export class BrowserContainerError extends Error {
  constructor(code, { containerTeardown = 'unconfirmed', cause } = {}) {
    super(code, { cause });
    this.name = 'BrowserContainerError';
    this.code = code;
    this.containerTeardown = containerTeardown;
  }
}

function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BrowserContainerError('invalid_request');
  }
  const allowedKeys = new Set(['optIn', 'decision', 'personaId', 'viewport']);
  if (Object.keys(input).some(key => !allowedKeys.has(key))) {
    throw new BrowserContainerError('unexpected_request_field');
  }
  if (input.optIn !== true) throw new BrowserContainerError('explicit_opt_in_required');
  if (!['allow', 'deny'].includes(input.decision)) throw new BrowserContainerError('invalid_decision');
  if (typeof input.personaId !== 'string' || findPersona(PERSONAS, input.personaId)?.synthetic !== true) {
    throw new BrowserContainerError('invalid_synthetic_persona');
  }

  let viewport = { width: 1280, height: 900 };
  if (input.viewport !== undefined) {
    if (!input.viewport || typeof input.viewport !== 'object' || Array.isArray(input.viewport) ||
        Object.keys(input.viewport).some(key => !['width', 'height'].includes(key))) {
      throw new BrowserContainerError('invalid_viewport');
    }
    const { width, height } = input.viewport;
    if (!Number.isInteger(width) || width < 375 || width > 1440 ||
        !Number.isInteger(height) || height < 667 || height > 1200) {
      throw new BrowserContainerError('invalid_viewport');
    }
    viewport = { width, height };
  }
  const payload = { schemaVersion: 1, optIn: true, decision: input.decision, personaId: input.personaId, viewport };
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_INPUT_BYTES) throw new BrowserContainerError('request_too_large');
  return payload;
}

function validateImage(image) {
  if (typeof image !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(image)) {
    throw new BrowserContainerError('invalid_browser_image');
  }
  return image;
}

function localDockerEndpoint() {
  return process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
}

function dockerCommand(args, { input = '', timeoutMs = 10_000, maxOutputBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
        .filter(key => process.env[key] !== undefined)
        .map(key => [key, process.env[key]]));
      child = spawn('docker', ['--host', localDockerEndpoint(), ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env,
      });
    } catch (cause) {
      reject(new BrowserContainerError('docker_cli_unavailable', { cause }));
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let oversized = false;
    let settled = false;
    let killTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
      killTimer.unref?.();
    }, timeoutMs);

    const append = (list, chunk, channel) => {
      if (channel === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes > maxOutputBytes) {
        oversized = true;
        child.kill('SIGTERM');
        return;
      }
      list.push(chunk);
    };
    child.stdout.on('data', chunk => append(stdout, chunk, 'stdout'));
    child.stderr.on('data', chunk => append(stderr, chunk, 'stderr'));
    child.stdin.on('error', () => {});
    child.on('error', cause => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      reject(new BrowserContainerError('docker_cli_unavailable', { cause }));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      if (timedOut) {
        reject(new BrowserContainerError('docker_command_timeout'));
      } else if (oversized) {
        reject(new BrowserContainerError('docker_output_too_large'));
      } else {
        resolve({
          code: code ?? 1,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      }
    });
    child.stdin.end(input);
  });
}

function isCompleteJpeg(bytes) {
  if (bytes.length < 12 || !bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) ||
      !bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) return false;

  let offset = 2;
  let hasFrame = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || marker === 0xd9) return false;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length - 2) return false;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 6 || offset + segmentLength > bytes.length - 2 || !hasFrame) return false;
      offset += segmentLength;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) continue;
        while (bytes[offset] === 0xff) offset++;
        const scanMarker = bytes[offset++];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) continue;
        return scanMarker === 0xd9 && offset === bytes.length;
      }
      return false;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length - 2) return false;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2) return false;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (segmentLength < 11) return false;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7];
      if (width === 0 || height === 0 || components === 0 || segmentLength !== 8 + components * 3) return false;
      hasFrame = true;
    }
    offset += segmentLength;
  }
  return false;
}

function validateRuntimeResult(output, request) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new BrowserContainerError('invalid_browser_result');
  }
  if (!result || result.schemaVersion !== 1 || result.ok !== true || result.decision !== request.decision ||
      result.personaId !== request.personaId || result.status !== (request.decision === 'allow' ? 'complete' : 'denied')) {
    throw new BrowserContainerError('browser_run_failed');
  }

  const receipt = result.receipt;
  if (!receipt || receipt.decision !== request.decision || receipt.status !== result.status ||
      receipt.tokenIssued !== (request.decision === 'allow') || !Array.isArray(receipt.exposedMessages) ||
      receipt.exposedMessageCount !== receipt.exposedMessages.length ||
      (request.decision === 'allow' ? receipt.exposedMessageCount < 1 : receipt.exposedMessageCount !== 0)) {
    throw new BrowserContainerError('browser_receipt_mismatch');
  }
  if (!Array.isArray(result.events) || result.events.length > MAX_EVENTS ||
      result.events.some(event => !event || typeof event.type !== 'string')) {
    throw new BrowserContainerError('invalid_browser_events');
  }
  if (!result.network || result.network.policy !== 'docker-none-and-same-origin' || result.network.blockedRequests !== 0) {
    throw new BrowserContainerError('browser_network_policy_failed');
  }
  if (!result.browser || result.browser.name !== 'chromium' ||
      result.browser.viewport?.width !== request.viewport.width || result.browser.viewport?.height !== request.viewport.height) {
    throw new BrowserContainerError('invalid_browser_metadata');
  }

  const screenshots = result.screenshots;
  if (!Array.isArray(screenshots) || screenshots.length !== EXPECTED_SCREENSHOTS.length ||
      screenshots.some((screenshot, index) => screenshot?.stage !== EXPECTED_SCREENSHOTS[index] ||
        screenshot.mimeType !== 'image/jpeg' || typeof screenshot.base64 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(screenshot.sha256))) {
    throw new BrowserContainerError('invalid_browser_screenshots');
  }
  for (const screenshot of screenshots) {
    const bytes = Buffer.from(screenshot.base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES ||
        bytes.toString('base64') !== screenshot.base64 ||
        !isCompleteJpeg(bytes) ||
        createHash('sha256').update(bytes).digest('hex') !== screenshot.sha256) {
      throw new BrowserContainerError('invalid_browser_screenshots');
    }
  }
  return result;
}

async function removeContainer(docker, name) {
  try {
    const removed = await docker(['rm', '-f', name], { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
    if (removed.code === 0) return 'confirmed';
  } catch {}

  try {
    const remaining = await docker(['ps', '-a', '-q', '--filter', `name=^/${name}$`], {
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
    if (remaining.code === 0 && remaining.stdout.trim() === '') return 'confirmed';
  } catch {}
  return 'unconfirmed';
}

/**
 * Run the bundled application and Chromium in one disposable, network-disabled
 * Docker container. The caller supplies only a synthetic persona and decision;
 * no URL, HTML, shell, mount, or environment passthrough is accepted.
 */
export async function runBrowserOAuthInContainer(input, {
  image = process.env.OAUTH_BROWSER_IMAGE || DEFAULT_BROWSER_IMAGE,
  docker = dockerCommand,
  timeoutMs = BROWSER_CONTAINER_TIMEOUT_MS,
  runIdFactory = randomUUID,
} = {}) {
  const request = validateRequest(input);
  const imageName = validateImage(image);
  if (typeof docker !== 'function') throw new BrowserContainerError('invalid_docker_runner');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > BROWSER_CONTAINER_TIMEOUT_MS) {
    throw new BrowserContainerError('invalid_runtime_timeout');
  }
  const runId = runIdFactory();
  if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/i.test(runId)) throw new BrowserContainerError('invalid_run_id');
  const name = `oauth-training-${runId}`;
  const args = [
    'run', '--rm', '--pull', 'never', '--interactive', '--name', name,
    '--label', 'training.role=oauth-browser',
    '--label', `training.run=${runId}`,
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m',
    '--shm-size', '128m',
    '--memory', '768m',
    '--cpus', '1',
    '--pids-limit', '64',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--env', 'HOME=/tmp',
    '--user', '1000:1000',
    imageName,
  ];
  let result;
  let failure;
  try {
    const run = await docker(args, {
      input: JSON.stringify(request),
      timeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
    });
    if (!run || run.code !== 0) throw new BrowserContainerError('docker_run_failed');
    result = validateRuntimeResult(run.stdout, request);
  } catch (error) {
    failure = error instanceof BrowserContainerError ? error : new BrowserContainerError('docker_run_failed', { cause: error });
  }

  const containerTeardown = await removeContainer(docker, name);
  if (failure) {
    failure.containerTeardown = containerTeardown;
    throw failure;
  }
  if (containerTeardown !== 'confirmed') {
    throw new BrowserContainerError('container_teardown_unconfirmed', { containerTeardown });
  }
  return { ...result, runId, executionMode: 'docker-browser-requested', containerTeardown };
}

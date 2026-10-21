// Detonation HTTP routes (docs/SPEC.md 4.2, 15.4). `handle` returns true when it answered the request, so server.mjs can
// dispatch to it before its own routes. An upload reserves a slot (global and per-address caps) before its body is read, is
// streamed to a temp file under a deadline with the size cap enforced as it arrives, and is parsed from that file without
// dependencies; the job controller gets the byte range of the file part and streams it into its encrypted copy, so the upload
// is never one buffer. The controller deletes the temp file once the job is accepted.
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { JobError, createJobController } from './jobs.mjs';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_CONCURRENT_UPLOADS = 4;
export const BODY_DEADLINE_MS = 60_000;
const MULTIPART_SLACK_BYTES = 64 * 1024;
const MAX_PARTS = 8;
const MAX_PART_HEADER_BYTES = 8 * 1024;
const MAX_CONSENT_BYTES = 16;
const SCAN_BLOCK_BYTES = 1024 * 1024;
const ROUTE_RE = /^\/api\/jobs\/(j-[0-9a-f]{16})(?:\/(events)|\/artifacts\/([^/]+))?$/;
const ARTIFACT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|svg|json|txt|csv)$/;
const ARTIFACT_TYPES = {
  png: 'image/png', svg: 'image/svg+xml', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
};
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const ARTIFACT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'";
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const securityHeaders = (csp = API_CSP) => ({
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': csp,
});

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...securityHeaders(), ...headers });
  response.end(body);
}

// Replies sent before the request body is read close the connection so the rest of the upload is dropped.
const sendEarly = (response, status, error, headers = {}) => sendJson(response, status, { error }, { Connection: 'close', ...headers });

function originAllowed(request, publicOrigin, required) {
  const origin = request.headers.origin;
  if (origin === undefined) return !required;
  if (publicOrigin && origin === publicOrigin) return true;
  const host = request.headers.host;
  return typeof host === 'string' && /^127\.0\.0\.1:\d+$/.test(host) && origin === `http://${host}`;
}

// Behind Caddy the peer is loopback and the last X-Forwarded-For entry is the address Caddy saw.
function clientIp(request) {
  const peer = request.socket.remoteAddress ?? '';
  if (!LOOPBACK_PEERS.has(peer)) return peer;
  return String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim() || peer;
}

function bearerToken(request) {
  return /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1] ?? null;
}

// Streams the request body to `file`. Resolves `{outcome, size}` with outcome 'ok', 'too-large' (the cap, declared or counted),
// 'timeout' (`deadlineMs` passed), 'aborted' (the client went away or the request errored) or 'write-failed'. The file is closed
// first. After every outcome but 'aborted' the rest of the request is drained so the caller can still answer on the socket.
const receiveBody = (request, file, cap, deadlineMs) => new Promise(resolve => {
  if (Number(request.headers['content-length']) > cap) { resolve({ outcome: 'too-large', size: 0 }); return; }
  const out = createWriteStream(file, { flags: 'wx', mode: 0o600 });
  let size = 0;
  let settled = false;
  const finish = outcome => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    request.off('data', onData);
    if (outcome === 'ok') out.end();
    else { out.destroy(); if (outcome !== 'aborted') request.resume(); }
    out.once('close', () => resolve({ outcome, size }));
  };
  const onData = chunk => {
    size += chunk.length;
    if (size > cap) finish('too-large');
    else if (!out.write(chunk)) { request.pause(); out.once('drain', () => request.resume()); }
  };
  const timer = setTimeout(() => finish('timeout'), deadlineMs);
  request.on('data', onData);
  request.on('end', () => finish('ok'));
  request.on('error', () => finish('aborted'));
  request.on('aborted', () => finish('aborted'));
  request.on('close', () => { if (!request.complete) finish('aborted'); });
  out.on('error', () => finish('write-failed'));
});

// Position of `needle` in the file between `from` and `limit`, or -1. Reads one block at a time.
async function findInFile(handle, needle, from, limit) {
  const block = Buffer.allocUnsafe(SCAN_BLOCK_BYTES + needle.length);
  let position = from;
  while (position < limit) {
    const { bytesRead } = await handle.read(block, 0, Math.min(block.length, limit - position), position);
    const at = block.subarray(0, bytesRead).indexOf(needle);
    if (at !== -1) return position + at;
    if (position + bytesRead >= limit || bytesRead < needle.length) return -1;
    position += bytesRead - needle.length + 1;
  }
  return -1;
}

async function readRange(handle, start, end) {
  const data = Buffer.allocUnsafe(end - start);
  for (let filled = 0; filled < data.length;) {
    const { bytesRead } = await handle.read(data, filled, data.length - filled, start + filled);
    if (bytesRead === 0) throw new Error('Upload file ended early.');
    filled += bytesRead;
  }
  return data;
}

/** Parts `{name, filename, start, end}` (byte range of the data in the file) of a multipart/form-data body, or null when it is malformed. */
export async function parseMultipartFile(handle, size, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerEnd = Buffer.from('\r\n\r\n');
  const partEnd = Buffer.from(`\r\n--${boundary}`);
  const parts = [];
  let position = await findInFile(handle, delimiter, 0, size);
  while (position !== -1) {
    position += delimiter.length;
    const marker = (await readRange(handle, position, Math.min(position + 2, size))).toString('latin1');
    if (marker === '--') return parts;
    if (marker !== '\r\n' || parts.length >= MAX_PARTS) return null;
    const headersEnd = await findInFile(handle, headerEnd, position + 2, Math.min(size, position + 2 + MAX_PART_HEADER_BYTES + headerEnd.length));
    if (headersEnd === -1) return null;
    const next = await findInFile(handle, partEnd, headersEnd + 4, size);
    if (next === -1) return null;
    const disposition = /^content-disposition:\s*form-data;(.*)$/im.exec((await readRange(handle, position + 2, headersEnd)).toString('latin1'))?.[1] ?? '';
    parts.push({
      name: /(?:^|[;\s])name="([^"]*)"/.exec(disposition)?.[1],
      filename: /(?:^|[;\s])filename="([^"]*)"/.exec(disposition)?.[1],
      start: headersEnd + 4,
      end: next,
    });
    position = next + 2;
  }
  return null;
}

/**
 * `controller` defaults to a job controller built on first use from `env`; with DETONATION_ENABLED=true it is built
 * and started at once. `maxUploadBytes`, `maxConcurrentUploads`, `bodyDeadlineMs` and `uploadDir` (temp files of uploads
 * being received; default `<data dir>/uploads`, emptied when first used) are injectable for tests.
 */
export function createDetonationRoutes({
  env = process.env, controller: provided, maxUploadBytes = MAX_UPLOAD_BYTES, maxConcurrentUploads = MAX_CONCURRENT_UPLOADS, bodyDeadlineMs = BODY_DEADLINE_MS,
  publicOrigin: fixedOrigin, uploadDir: fixedUploadDir, ...controllerOptions
} = {}) {
  const uploadDir = fixedUploadDir ?? join(controllerOptions.dataDir || env.DETONATION_DATA_DIR || '/var/lib/detonation-ocean', 'uploads');
  let controller = provided;
  let uploadDirReady;
  let uploadsActive = 0;
  const uploadingIps = new Set();
  const streams = new Set();
  const getController = () => (controller ??= createJobController({ env, ...controllerOptions }));
  if (!provided && env.DETONATION_ENABLED === 'true') getController().start().catch(error => console.error(`Detonation controller failed to start: ${error?.name ?? 'Error'}`));

  // Reserves an upload slot before any body byte is read: at most `maxConcurrentUploads` at once and one per address.
  // Returns the release function, or `{status, message}` when refused.
  function reserveUpload(ip) {
    if (uploadsActive >= maxConcurrentUploads) return { status: 503, message: 'The server is receiving other uploads. Try again shortly.' };
    if (uploadingIps.has(ip)) return { status: 429, message: 'Finish the upload in progress before starting another.' };
    uploadsActive += 1;
    uploadingIps.add(ip);
    return () => { uploadsActive -= 1; uploadingIps.delete(ip); };
  }

  // Receives, stores and parses one upload. Returns `{source: {path, start, end}, claimedName}` (the temp file stays for the job
  // controller to take over) or `{status, message, early}` with the temp file deleted (`early`: the body was not fully read, so
  // close the connection); status 0 means the client is gone and nothing is sent.
  async function receiveUpload(request, boundary) {
    uploadDirReady ??= rm(uploadDir, { recursive: true, force: true }).then(() => mkdir(uploadDir, { recursive: true, mode: 0o700 }));
    await uploadDirReady;
    const path = join(uploadDir, `upload-${randomBytes(8).toString('hex')}.part`);
    let kept = false;
    try {
      const { outcome, size } = await receiveBody(request, path, maxUploadBytes + MULTIPART_SLACK_BYTES, bodyDeadlineMs);
      if (outcome === 'aborted') return { status: 0 };
      if (outcome === 'too-large') return { status: 413, message: 'The file is over 100 MB.', early: true };
      if (outcome === 'timeout') return { status: 408, message: 'The upload took too long.', early: true };
      if (outcome === 'write-failed') return { status: 500, message: 'The upload could not be stored.', early: true };
      const handle = await open(path, 'r');
      try {
        const parts = await parseMultipartFile(handle, size, boundary);
        const file = parts?.find(part => part.name === 'file' && part.filename !== undefined);
        const consent = parts?.find(part => part.name === 'consent');
        if (!file || file.end === file.start) return { status: 400, message: 'Send one non-empty file in the "file" field.' };
        if (!consent || consent.end - consent.start > MAX_CONSENT_BYTES || (await readRange(handle, consent.start, consent.end)).toString('utf8') !== 'true') {
          return { status: 400, message: 'Consent is required.' };
        }
        if (file.end - file.start > maxUploadBytes) return { status: 413, message: 'The file is over 100 MB.' };
        kept = true;
        return { source: { path, start: file.start, end: file.end }, claimedName: file.filename };
      } finally {
        await handle.close();
      }
    } finally {
      if (!kept) await rm(path, { force: true });
    }
  }

  async function createJob(request, response) {
    const jobs = getController();
    const ip = clientIp(request);
    const refusal = jobs.admit(ip);
    if (refusal) { sendEarly(response, refusal.status, refusal.message); return; }
    const type = String(request.headers['content-type'] ?? '');
    const boundary = /^multipart\/form-data\s*;.*boundary=(?:"([^"]{1,70})"|([^;\s]{1,70}))/i.exec(type);
    if (!boundary) { sendEarly(response, 400, 'Expected a multipart/form-data upload.'); return; }
    const slot = reserveUpload(ip);
    if (typeof slot !== 'function') { sendEarly(response, slot.status, slot.message); return; }
    let upload;
    try {
      upload = await receiveUpload(request, boundary[1] ?? boundary[2]);
    } finally {
      slot(); // before the reply: a client that sends its next upload on seeing the answer must find the slot free
    }
    if (upload.status === 0) return;
    if (upload.early) { sendEarly(response, upload.status, upload.message); return; }
    if (upload.message) { sendJson(response, upload.status, { error: upload.message }); return; }
    let created;
    try {
      created = jobs.submit({ source: upload.source, claimedName: upload.claimedName, ip });
    } catch (error) {
      await rm(upload.source.path, { force: true }); // a refused job never owns the temp file
      if (!(error instanceof JobError)) throw error;
      sendJson(response, error.status, { error: error.message });
      return;
    }
    sendJson(response, 202, created);
  }

  function streamEvents(request, response, job) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...securityHeaders() });
    const last = Number.parseInt(request.headers['last-event-id'] ?? '', 10);
    streams.add(response);
    const unsubscribe = getController().subscribe(job, last > 0 ? last : 0, record => {
      if (record === null) response.end();
      else response.write(`id: ${record.id}\nevent: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`);
    });
    response.on('close', () => { streams.delete(response); unsubscribe(); });
  }

  function sendArtifact(response, job, name) {
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const data = ARTIFACT_NAME_RE.test(name) && name.includes('.') ? getController().artifact(job, name) : null;
    if (!data || !(extension in ARTIFACT_TYPES)) { sendJson(response, 404, { error: 'Not found.' }); return; }
    response.writeHead(200, {
      'Content-Type': ARTIFACT_TYPES[extension], 'Content-Length': data.length, ...securityHeaders(ARTIFACT_CSP),
      'Content-Disposition': extension === 'png' ? 'inline' : `attachment; filename="${name}"`,
    });
    response.end(data);
  }

  async function route(request, response, pathname, { publicOrigin = fixedOrigin, buildId } = {}) {
    const match = ROUTE_RE.exec(pathname);
    const name = pathname === '/api/jobs' ? 'create' : match ? 'job' : pathname === '/api/ocean' ? 'ocean' : pathname === '/api/health' && env.DETONATION_ENABLED === 'true' ? 'health' : null;
    if (!name) return false;
    const post = name === 'create';
    if (!originAllowed(request, publicOrigin, post)) { sendEarly(response, 403, 'Trusted application origin required.'); return true; }
    if (request.method !== (post ? 'POST' : 'GET')) { sendEarly(response, 405, 'Method not allowed.', { Allow: post ? 'POST' : 'GET' }); return true; }
    if (post) { await createJob(request, response); return true; }
    if (name === 'ocean') { sendJson(response, 200, getController().oceanView()); return true; }
    if (name === 'health') { sendJson(response, 200, { ok: true, buildId, ...getController().health() }); return true; }
    const jobs = getController();
    const token = bearerToken(request);
    const job = jobs.getJob(match[1]);
    if (!job || !token || !jobs.authorise(job, token)) { sendJson(response, 401, { error: 'A valid job token is required.' }, { 'WWW-Authenticate': 'Bearer' }); return true; }
    if (match[2]) streamEvents(request, response, job);
    else if (match[3] !== undefined) sendArtifact(response, job, match[3]);
    else sendJson(response, 200, jobs.status(job));
    return true;
  }

  // A failure inside a route answers 500, or drops a half-sent response, instead of rejecting into the server's request listener.
  async function handle(request, response, pathname, options) {
    try {
      return await route(request, response, pathname, options);
    } catch (error) {
      console.error(`Detonation route failed: ${error?.name ?? 'Error'}`);
      if (!response.headersSent) sendEarly(response, 500, 'Something went wrong.');
      else response.destroy();
      return true;
    }
  }

  return {
    handle,
    get controller() { return getController(); },
    stop() {
      controller?.stop();
      for (const response of streams) response.end();
    },
  };
}

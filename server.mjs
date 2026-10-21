import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createOAuthPlan,
  executeOAuthScenario,
  LocalSyntheticAdapter,
  ScenarioInputError,
  validateScenarioRequest,
} from './backend/oauth-scenario.mjs';
import { runBrowserOAuthInContainer } from './backend/browser-container.mjs';
import { runHackathonPatternB } from './backend/hackathon-proof.mjs';
import { validateVisionScreenshots, visionGate } from './backend/vultr-inference.mjs';
import { createApprovedVultrAdapterFactory } from './backend/vultr-adapter.mjs';
import { loadPersonas } from './backend/personas.mjs';
import { loadAbyssAssets } from './backend/abyss-assets.mjs';
import { loadOceanProfiles } from './backend/ocean-profiles.mjs';
import { OceanProfileSessionStore } from './backend/ocean-profile-simulation.mjs';
import { TrainingSessionError, TrainingSessionStore } from './backend/training-session.mjs';
import { createDesktopWorldSource, DesktopWorldError, parseAllowHosts, PROFILE_SLUG_RE } from './backend/desktop-world-source.mjs';
import { DesktopEventHub, EVENT_MAX_BYTES, EVENTS_TOKEN_MIN_LENGTH, parseDesktopEvent, RUN_ID_RE, tokenMatches } from './backend/desktop-world-events.mjs';
import { computeDesktopBuildId } from './backend/desktop-world-build.mjs';
import { readAvatar } from './backend/desktop-avatars.mjs';
import { runScenario, SANDBOX_MODES, vultrGateReport } from './backend/sandbox/controller.mjs';
import { createDetonationRoutes } from './backend/detonation/routes.mjs';
import { loadScenarioKinds } from './backend/sandbox/scenarios.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_JSON_BYTES = 2048;
// Behind Caddy the peer is loopback and the last X-Forwarded-For entry is the address Caddy saw (same rule as backend/detonation/routes.mjs).
function peerAddress(request) {
  const peer = request.socket.remoteAddress ?? '';
  if (!LOOPBACK_PEERS.has(peer)) return peer;
  return String(request.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim() || peer;
}
// Detonation replay runs (backend/detonation/jobs.mjs newReplayId) are 40 random characters of a-z2-7. Only the controller creates one, by
// publishing; a subscriber to an unknown one gets 404 and no hub entry, so callers cannot fill the hub's run slots.
const REPLAY_RUN_RE = /^[a-z2-7]{40}$/;
const REPLAY_SUBSCRIBERS_PER_RUN = 4;
const REPLAY_SUBSCRIBERS_PER_IP = 4;
const TRAINING_ROUTES = new Set([
  '/api/training/scenarios', '/api/training/start', '/api/training/view',
  '/api/training/action', '/api/training/reset', '/api/training/close',
]);
const HACKATHON_PROOF_PATH = '/api/hackathon/proof';
const OCEAN_PROFILE_SESSION_ROUTES = new Set([
  '/api/ocean/session/start', '/api/ocean/session/action', '/api/ocean/session/view', '/api/ocean/session/close',
]);
// Old training, OAuth, hackathon-proof and ocean-session routes: answered 404 when the production flag is set (SPEC 4.2).
const PRODUCTION_DISABLED_ROUTES = new Set([
  ...TRAINING_ROUTES, ...OCEAN_PROFILE_SESSION_ROUTES, HACKATHON_PROOF_PATH,
  '/api/scenarios/oauth/plan', '/api/scenarios/oauth/execute', '/api/desktop/sandbox/run',
]);
// Detonation pages (SPEC 4.1). `/upload` is the main menu: the Drop a file panel is on it.
const PAGE_FILES = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/upload', 'index.html'],
  ['/bestiary', 'bestiary.html'], ['/about', 'about.html'],
]);
const JOB_PAGE_RE = /^\/job\/[A-Za-z0-9_-]{1,64}\/?$/;
const PAGE_STATIC_RE = /^\/ui\/(job|bestiary)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const MOCK_EVENTS_RE = /^\/tests\/fixtures\/detonation\/events\/([a-z0-9-]{1,40})\.json$/;
const DATA_FILES = new Set(['/data/creatures.json', '/data/fish.json']);
const STATIC_MIME = {
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff': 'font/woff',
};
const DO_ENV_META_RE = /<meta name="do-env" content="[^"]*">/;
const MAX_HACKATHON_PROOF_RUNS = 10;
// Page-started sandbox runs (POST /api/desktop/sandbox/run): at most this many at once across all run ids.
const MAX_ACTIVE_SANDBOX_RUNS = 4;
const SANDBOX_SCENARIO_ID_RE = /^[a-z0-9-]{1,40}$/;
const PROOF_SCREENSHOT_STAGES = ['desktop-before-optin', 'consent-ready', 'receipt'];
// The final OS shells (WORLD-CONTRACT v3) come from the local comparison server, a loopback origin only.
const DEFAULT_SHELL_ORIGIN = 'http://127.0.0.1:4189';
const SHELL_ORIGIN_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
const FINAL_SHELL_PAGES = ['/previews/win11-final/index.html', '/previews/macos-final/index.html'];
const DESKTOP_ASSETS = new Map([
  ['/desktop.html', { file: join(root, 'ui/desktop/index.html'), mime: 'text/html; charset=utf-8' }],
  ['/desktop.css', { file: join(root, 'ui/desktop/desktop.css'), mime: 'text/css; charset=utf-8' }],
  ['/desktop.js', { file: join(root, 'ui/desktop/desktop.js'), mime: 'text/javascript; charset=utf-8' }],
  ['/desktop-model.js', { file: join(root, 'ui/desktop/desktop-model.js'), mime: 'text/javascript; charset=utf-8' }],
  ['/world-model.js', { file: join(root, 'ui/desktop/world-model.js'), mime: 'text/javascript; charset=utf-8' }],
  ['/scenario-profile.js', { file: join(root, 'ui/desktop/scenario-profile.js'), mime: 'text/javascript; charset=utf-8' }],
  ['/scene-world.js', { file: join(root, 'ui/desktop/scene-world.js'), mime: 'text/javascript; charset=utf-8' }],
  ['/ocean-profiles.html', { file: join(root, 'ui/desktop/ocean-profiles.html'), mime: 'text/html; charset=utf-8' }],
  ['/ocean-profiles.css', { file: join(root, 'ui/desktop/ocean-profiles.css'), mime: 'text/css; charset=utf-8' }],
  ['/ocean-profiles.js', { file: join(root, 'ui/desktop/ocean-profiles.js'), mime: 'text/javascript; charset=utf-8' }],
  ['/ocean-entry.html', { file: join(root, 'ui/desktop/ocean-entry.html'), mime: 'text/html; charset=utf-8' }],
  ['/ocean-entry.css', { file: join(root, 'ui/desktop/ocean-entry.css'), mime: 'text/css; charset=utf-8' }],
  ['/ocean-entry.js', { file: join(root, 'ui/desktop/ocean-entry.js'), mime: 'text/javascript; charset=utf-8' }],
]);
// The two authored scene scripts the parent desktop hosts itself. Exact routes, local template mode only; never the template files.
const OCEAN_SCENE_SCRIPTS = new Map([
  ['/ocean-scenes.js', { file: join(root, 'desktop-comparison/previews/ocean-scenes.js'), mime: 'text/javascript; charset=utf-8' }],
  ['/ocean-fx.js', { file: join(root, 'desktop-comparison/previews/ocean-fx.js'), mime: 'text/javascript; charset=utf-8' }],
  // One scenario data script per depth (SCENARIOS-60-CONTRACT §2).
  ...['sunlight', 'twilight', 'midnight', 'abyss', 'trench'].map(depth => [`/ocean-scenarios/${depth}.js`,
    { file: join(root, `desktop-comparison/previews/ocean-scenarios/${depth}.js`), mime: 'text/javascript; charset=utf-8' }]),
]);
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const DESKTOP_CSP = CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
// Trusted local graphics require WebAssembly decoding and embedded glTF image blobs. No JS eval or external hosts.
const RENDER_CSP = CSP.replace("'unsafe-inline'", "'unsafe-inline' 'wasm-unsafe-eval'").replace("img-src 'self' data:", "img-src 'self' data: blob:").replace("connect-src 'self'", "connect-src 'self' blob:") + "; worker-src 'self'";

function assertTrainingRequestKeys(input, allowed, label) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TrainingSessionError('INVALID_INPUT', `${label} must be a JSON object.`);
  }
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TrainingSessionError('INVALID_INPUT', `Unexpected ${label} field.`);
  }
}

// NODE_ENV=production or DETONATION_PRODUCTION=true marks the public site.
const productionFlag = env => env.NODE_ENV === 'production' || env.DETONATION_PRODUCTION === 'true';

// Page CSP (SPEC 15.4): scripts come from this origin; an inline script runs only when its SHA-256 is listed.
function pageCsp(html, base) {
  const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, code]) => ` 'sha256-${createHash('sha256').update(code).digest('base64')}'`).join('');
  return base.replace("script-src 'self' 'unsafe-inline'", `script-src 'self'${hashes}`);
}

function sendBody(response, body, mime, csp) {
  response.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': csp,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

// A regular file under `root` by an already validated relative path, or null.
function readRegularFile(relativePath) {
  try {
    const full = join(root, relativePath);
    const stat = lstatSync(full);
    return stat.isFile() ? readFileSync(full) : null;
  } catch {
    return null;
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

async function readJsonRequest(request, maxBytes = MAX_JSON_BYTES) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new ScenarioInputError('Expected application/json.', 415);

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new ScenarioInputError('Request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ScenarioInputError('Malformed JSON.');
  }
}

function originIsLocal(request) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^127\.0\.0\.1:\d+$/.test(host)) return false;
  const origin = request.headers.origin;
  return !origin || origin === `http://${host}`;
}

function parsePublicOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originIsAllowed(request, publicOrigin) {
  if (originIsLocal(request)) return true;
  return Boolean(publicOrigin && request.headers.origin === publicOrigin && request.headers.host === new URL(publicOrigin).host);
}

function publicProofResult(proof) {
  const vision = proof?.vision;
  const decision = ['allow', 'deny'].includes(proof?.decision) ? proof.decision : null;
  const tokenIssued = proof?.tokenIssued === true;
  const exposedMessageCount = Number.isInteger(proof?.exposedMessageCount) ? proof.exposedMessageCount : null;
  const outcomeMatches = decision === 'allow'
    ? tokenIssued && exposedMessageCount > 0
    : decision === 'deny' && !tokenIssued && exposedMessageCount === 0;
  const screenshots = validateVisionScreenshots(proof?.screenshots) ? proof.screenshots : [];
  const contractMet = proof?.contractMet === true && proof?.submissionValid === false && outcomeMatches && screenshots.length === 3 &&
    proof?.evidenceClass === 'host-docker' && proof?.containerTeardown === 'confirmed' &&
    vision?.status === 'passed' && vision.provider === 'vultr-serverless-inference' &&
    vision.providerCall === 'completed' && vision.live === true;
  return {
    schemaVersion: 1,
    pattern: 'B',
    scenarioId: 'oauth-2023',
    decision,
    executionMode: 'vultr-hackathon',
    contractMet,
    submissionValid: false,
    submissionGap: 'This proof does not establish a public Vultr VM deployment or submission readiness.',
    evidenceClass: proof?.evidenceClass === 'host-docker' ? 'host-docker' : 'injected',
    containerTeardown: ['confirmed', 'unconfirmed', 'not_started'].includes(proof?.containerTeardown) ? proof.containerTeardown : 'unconfirmed',
    exposedMessageCount,
    tokenIssued,
    screenshotStages: Array.isArray(proof?.screenshotStages)
      ? proof.screenshotStages.filter(stage => PROOF_SCREENSHOT_STAGES.includes(stage))
      : [],
    screenshots,
    vision: {
      status: ['passed', 'failed', 'not_run'].includes(vision?.status) ? vision.status : 'not_run',
      provider: 'vultr-serverless-inference',
      providerCall: ['not_made', 'completed', 'failed'].includes(vision?.providerCall) ? vision.providerCall : 'not_made',
      live: vision?.live === true,
      reason: typeof vision?.reason === 'string' ? vision.reason : null,
    },
    vultrCompute: 'not_run',
    oceanDesktop: 'out_of_scope',
    error: typeof proof?.error === 'string' ? proof.error : null,
  };
}

export function createAppServer({
  personas = loadPersonas(),
  adapterFactory,
  browserContainerRunner = runBrowserOAuthInContainer,
  hackathonProofRunner = runHackathonPatternB,
  hackathonControllerMode = process.env.VULTR_HACKATHON_MODE === 'true',
  hackathonProofEnabled = process.env.VULTR_HACKATHON_PROOF_ENABLED === 'true' && visionGate(process.env).approved,
  publicOrigin: configuredPublicOrigin = parsePublicOrigin(process.env.APP_PUBLIC_ORIGIN),
  templateShellsEnabled: requestedTemplateShells = false,
  shellOrigin = DEFAULT_SHELL_ORIGIN,
  trainingSessionStore = new TrainingSessionStore(),
  desktopWorldDir = process.env.DESKTOP_WORLD_DIR,
  desktopWorldUrl = process.env.DESKTOP_WORLD_URL,
  desktopWorldAllowHosts = process.env.DESKTOP_WORLD_ALLOW_HOSTS,
  desktopEventsToken = process.env.DESKTOP_EVENTS_TOKEN,
  desktopSandboxMode = process.env.DESKTOP_SANDBOX_MODE,
  sandboxRunner = runScenario,
  sandboxEnv = process.env,
  desktopEvents = new DesktopEventHub(),
  detonation = createDetonationRoutes({ desktopHub: desktopEvents }),
  production = productionFlag(process.env),
} = {}) {
  const publicOrigin = parsePublicOrigin(configuredPublicOrigin);
  const worldSource = createDesktopWorldSource({
    dir: desktopWorldDir || (desktopWorldUrl ? undefined : join(root, 'data')),
    url: desktopWorldUrl || undefined,
    allowHosts: Array.isArray(desktopWorldAllowHosts) ? desktopWorldAllowHosts : parseAllowHosts(desktopWorldAllowHosts),
  });
  if (desktopEventsToken && String(desktopEventsToken).length < EVENTS_TOKEN_MIN_LENGTH) {
    throw new TypeError(`DESKTOP_EVENTS_TOKEN must be at least ${EVENTS_TOKEN_MIN_LENGTH} characters.`);
  }
  const sandboxMode = desktopSandboxMode || 'simulated';
  if (!SANDBOX_MODES.includes(sandboxMode)) throw new TypeError(`DESKTOP_SANDBOX_MODE must be one of: ${SANDBOX_MODES.join(', ')}.`);
  const activeSandboxRuns = new Map();
  const replaySubscribersByIp = new Map();
  const buildId = computeDesktopBuildId(root);
  const templateShellsEnabled = requestedTemplateShells === true && !hackathonControllerMode && !production && process.env.VULTR_SANDBOX_MODE !== 'vultr';
  if (!SHELL_ORIGIN_RE.test(shellOrigin)) throw new TypeError('shellOrigin must be an http://127.0.0.1:<port> origin.');
  const desktopCsp = `${DESKTOP_CSP}; frame-src 'self'${templateShellsEnabled ? ` ${shellOrigin}` : ''}`;
  const vultrMode = !hackathonControllerMode && process.env.VULTR_SANDBOX_MODE === 'vultr';
  const createAdapter = adapterFactory ?? (vultrMode
    ? createApprovedVultrAdapterFactory({ env: process.env, oauthApp: personas.oauth_app })
    : () => new LocalSyntheticAdapter({ allowedScopes: personas.oauth_app.requested_scopes }));
  const rendererAssets = loadAbyssAssets(root);
  const oceanProfileCatalog = loadOceanProfiles(root);
  const oceanProfileSessions = new OceanProfileSessionStore({ profiles: oceanProfileCatalog.profiles });
  let scenarioRunning = false;
  let browserContainerCleanupUnconfirmed = false;
  let hackathonCleanupUnconfirmed = false;
  let hackathonProofRuns = 0;
  let activeAdapter = null;
  const handleRequest = async (request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    } catch {
      sendJson(response, 400, { error: 'Invalid request path.' });
      return;
    }

    if (await detonation.handle(request, response, pathname, { publicOrigin, buildId })) return;

    if (production && PRODUCTION_DISABLED_ROUTES.has(pathname)) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (request.method === 'GET') {
      // Detonation pages. The public site marks itself production in the page, so the menu never shows development controls.
      const pageFile = PAGE_FILES.get(pathname) ?? (JOB_PAGE_RE.test(pathname) ? 'job.html' : undefined);
      if (pageFile) {
        const pageSource = readRegularFile(pageFile)?.toString('utf8');
        if (pageSource === undefined) {
          sendJson(response, 500, { error: 'Run `node build.mjs` to generate the local page first.' });
          return;
        }
        const html = production ? pageSource.replace(DO_ENV_META_RE, '<meta name="do-env" content="production">')
          : pageFile !== 'index.html' ? pageSource
          : pageSource.replace('<a href="#legend">Legend</a>', '<a href="/ocean-profiles.html">Creature matrix</a><a href="#legend">Legend</a>');
        sendBody(response, Buffer.from(html), 'text/html; charset=utf-8', pageCsp(html, pageFile === 'index.html' ? RENDER_CSP : CSP));
        return;
      }
      // Read-only files for those pages; fixture events only on a loopback socket outside production.
      const pageStatic = PAGE_STATIC_RE.exec(pathname);
      const mockName = MOCK_EVENTS_RE.exec(pathname)?.[1];
      const staticPath = pageStatic ? `ui/${pageStatic[1]}/${pageStatic[2]}` : DATA_FILES.has(pathname) ? pathname.slice(1)
        : mockName && !production && LOOPBACK_PEERS.has(request.socket.localAddress) ? `tests/fixtures/detonation/events/${mockName}.json` : undefined;
      const mime = staticPath && STATIC_MIME[staticPath.slice(staticPath.lastIndexOf('.'))];
      const body = mime && readRegularFile(staticPath);
      if (body) {
        sendBody(response, body, mime, CSP);
        return;
      }
    }

    if (pathname === HACKATHON_PROOF_PATH) {
      if (!originIsAllowed(request, publicOrigin)) {
        sendJson(response, 403, { error: 'Trusted application origin required.', code: 'ORIGIN_NOT_ALLOWED' });
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'Use POST for the hackathon proof route.', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      if (!hackathonControllerMode) {
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      if (!hackathonProofEnabled) {
        sendJson(response, 503, { error: 'The explicit Vultr inference proof gate is not configured.', code: 'INFERENCE_GATE_CLOSED' });
        return;
      }
      if (hackathonCleanupUnconfirmed) {
        sendJson(response, 503, { error: 'A previous container cleanup is unconfirmed; reconcile it before another run.', code: 'CONTAINER_CLEANUP_UNCONFIRMED' });
        return;
      }
      if (scenarioRunning) {
        sendJson(response, 409, { error: 'Another synthetic run is active.', code: 'SCENARIO_BUSY', containerTeardown: 'not_started' });
        return;
      }
      scenarioRunning = true;
      let proofStarted = false;
      try {
        const input = await readJsonRequest(request);
        assertTrainingRequestKeys(input, new Set([
          'attackId', 'personaId', 'decision', 'planId', 'optIn', 'browserContainerOptIn', 'inferenceAcknowledged',
        ]), 'hackathon proof request');
        if (input.optIn !== true || input.browserContainerOptIn !== true || input.inferenceAcknowledged !== true) {
          throw new ScenarioInputError('Explicit training, container and inference acknowledgements are required.', 403);
        }
        const scenario = validateScenarioRequest({
          attackId: input.attackId,
          personaId: input.personaId,
          decision: input.decision,
          planId: input.planId,
          optIn: input.optIn,
          browserContainerOptIn: input.browserContainerOptIn,
        }, personas);
        if (hackathonProofRuns >= MAX_HACKATHON_PROOF_RUNS) {
          sendJson(response, 429, { error: 'The per-process hackathon proof run limit has been reached.', code: 'PROOF_RUN_LIMIT', containerTeardown: 'not_started' });
          return;
        }
        hackathonProofRuns++;
        proofStarted = true;
        const proof = await hackathonProofRunner({
          optIn: true,
          containerOptIn: true,
          inferenceAcknowledged: true,
          decision: scenario.decision,
          includeScreenshots: true,
          evidenceClass: 'host-docker',
          env: process.env,
        });
        if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
          hackathonCleanupUnconfirmed = true;
          throw new Error('invalid_hackathon_proof_result');
        }
        if (!['confirmed', 'not_started'].includes(proof.containerTeardown)) hackathonCleanupUnconfirmed = true;
        const result = publicProofResult(proof);
        sendJson(response, result.contractMet ? 200 : 503, result);
      } catch (error) {
        if (proofStarted && error?.containerTeardown !== 'confirmed' && error?.containerTeardown !== 'not_started') hackathonCleanupUnconfirmed = true;
        const knownError = error instanceof TrainingSessionError || error instanceof ScenarioInputError;
        sendJson(response, knownError ? error.status : 503, {
          error: knownError ? error.message : 'The synthetic container proof failed; cleanup may require inspection.',
          code: typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'HACKATHON_PROOF_FAILED',
          containerTeardown: error?.containerTeardown === 'confirmed' ? 'confirmed' : error?.containerTeardown === 'not_started' ? 'not_started' : 'unconfirmed',
        });
      } finally {
        scenarioRunning = false;
      }
      return;
    }

    if (OCEAN_PROFILE_SESSION_ROUTES.has(pathname)) {
      if (hackathonControllerMode || vultrMode) {
        sendJson(response, 503, { error: 'In-process profile simulation is disabled in cloud mode; no profile worker fallback is available.', code: 'WORKER_BACKEND_REQUIRED' });
        return;
      }
      if (!originIsAllowed(request, publicOrigin)) {
        sendJson(response, 403, { error: 'Local origin required.', code: 'LOCAL_ORIGIN_REQUIRED' });
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'Use POST for profile-session routes.', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      try {
        const input = await readJsonRequest(request);
        let result;
        if (pathname === '/api/ocean/session/start') {
          assertTrainingRequestKeys(input, new Set(['profileId', 'optIn']), 'profile start request');
          result = oceanProfileSessions.start(input);
        } else if (pathname === '/api/ocean/session/action') {
          assertTrainingRequestKeys(input, new Set(['sessionId', 'actionId']), 'profile action request');
          result = oceanProfileSessions.act(input.sessionId, input);
        } else if (pathname === '/api/ocean/session/view') {
          assertTrainingRequestKeys(input, new Set(['sessionId']), 'profile view request');
          result = oceanProfileSessions.view(input.sessionId);
        } else {
          assertTrainingRequestKeys(input, new Set(['sessionId']), 'profile close request');
          result = oceanProfileSessions.close(input.sessionId);
        }
        sendJson(response, 200, result);
      } catch (error) {
        const knownError = error instanceof TrainingSessionError || error instanceof ScenarioInputError;
        sendJson(response, knownError ? error.status : 500, {
          error: knownError ? error.message : 'Synthetic profile request failed.',
          ...(typeof error?.code === 'string' ? { code: error.code } : {}),
        });
      }
      return;
    }

    if (TRAINING_ROUTES.has(pathname)) {
      if (hackathonControllerMode) {
        sendJson(response, 503, { error: 'Controller-side training state is disabled; use the isolated proof worker.', code: 'WORKER_BACKEND_REQUIRED' });
        return;
      }
      if (!originIsAllowed(request, publicOrigin)) {
        sendJson(response, 403, { error: 'Local origin required.', code: 'LOCAL_ORIGIN_REQUIRED' });
        return;
      }
      const expectedMethod = pathname === '/api/training/scenarios' ? 'GET' : 'POST';
      if (request.method !== expectedMethod) {
        response.setHeader('Allow', expectedMethod);
        sendJson(response, 405, { error: `Use ${expectedMethod} for this training route.`, code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      try {
        if (pathname === '/api/training/scenarios') {
          sendJson(response, 200, await trainingSessionStore.listScenarios());
        } else {
          const input = await readJsonRequest(request);
          let result;
          if (pathname === '/api/training/start') {
            result = await trainingSessionStore.create(input);
          } else if (pathname === '/api/training/view') {
            assertTrainingRequestKeys(input, new Set(['sessionId']), 'view request');
            result = await trainingSessionStore.view(input.sessionId);
          } else if (pathname === '/api/training/action') {
            assertTrainingRequestKeys(input, new Set(['sessionId', 'actionId']), 'action request');
            result = await trainingSessionStore.act(input.sessionId, { actionId: input.actionId });
          } else if (pathname === '/api/training/reset') {
            assertTrainingRequestKeys(input, new Set(['sessionId']), 'reset request');
            result = await trainingSessionStore.reset(input.sessionId);
          } else {
            assertTrainingRequestKeys(input, new Set(['sessionId']), 'close request');
            await trainingSessionStore.destroy(input.sessionId);
            result = { closed: true };
          }
          sendJson(response, 200, result);
        }
      } catch (error) {
        const knownError = error instanceof TrainingSessionError || error instanceof ScenarioInputError;
        sendJson(response, knownError ? error.status : 500, {
          error: knownError ? error.message : 'Synthetic training request failed.',
          ...(typeof error?.code === 'string' ? { code: error.code } : {}),
        });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/healthz') {
      sendJson(response, 200, {
        ok: true,
        mode: hackathonControllerMode ? (hackathonProofEnabled ? 'vultr-hackathon-ready' : 'vultr-hackathon-locked') : vultrMode ? 'vultr-gated' : 'local-synthetic',
        externalNetwork: hackathonControllerMode ? 'Vultr Serverless Inference only, after the explicit proof gate' : vultrMode ? 'Vultr API and private VPC only; requires the explicit live gate' : false,
        inferenceConfigured: hackathonControllerMode ? hackathonProofEnabled : undefined,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/scenarios/oauth/plan') {
      if (!originIsAllowed(request, publicOrigin)) {
        sendJson(response, 403, { error: 'Local origin required.' });
        return;
      }
      try {
        const input = await readJsonRequest(request);
        if (input?.optIn !== true) throw new ScenarioInputError('Explicit training opt-in is required.');
        if (hackathonControllerMode && (!hackathonProofEnabled || input.browserContainerOptIn !== true)) {
          throw new ScenarioInputError('The isolated Vultr proof gate and explicit container opt-in are required.', 403);
        }
        if (vultrMode && input.browserContainerOptIn === true) {
          throw new ScenarioInputError('Browser-container mode is available only in local synthetic mode.');
        }
        const plan = createOAuthPlan(input, personas);
        sendJson(response, 200, {
          ...plan,
          executionMode: hackathonControllerMode ? 'vultr-hackathon' : vultrMode ? 'vultr-gated' : plan.browserContainerOptIn ? 'docker-browser-requested' : 'local-synthetic',
        });
      } catch (error) {
        const status = error instanceof ScenarioInputError ? error.status : 500;
        sendJson(response, status, {
          error: error instanceof ScenarioInputError ? error.message : 'Synthetic plan failed.',
        });
      }
      return;
    }

    if (request.method === 'POST' && pathname === '/api/scenarios/oauth/execute') {
      if (!originIsAllowed(request, publicOrigin)) {
        sendJson(response, 403, { error: 'Local origin required.' });
        return;
      }
      if (hackathonControllerMode) {
        sendJson(response, 503, { error: 'Controller-side execution is disabled; use the isolated proof worker.', code: 'WORKER_BACKEND_REQUIRED' });
        return;
      }
      if (scenarioRunning) {
        sendJson(response, 409, {
          error: 'A synthetic scenario is already running.',
          code: 'scenario_busy',
          containerTeardown: 'not_started',
        });
        return;
      }
      scenarioRunning = true;
      let adapter = null;
      try {
        const input = await readJsonRequest(request);
        if (input?.optIn !== true) throw new ScenarioInputError('Explicit training opt-in is required.');
        const scenario = validateScenarioRequest(input, personas);
        if (vultrMode && scenario.browserContainerOptIn) {
          throw new ScenarioInputError('Browser-container mode is available only in local synthetic mode.');
        }
        if (vultrMode && input.costAcknowledged !== true) {
          throw new ScenarioInputError('Vultr cost acknowledgement is required.');
        }
        if (scenario.browserContainerOptIn) {
          if (browserContainerCleanupUnconfirmed) {
            sendJson(response, 503, {
              error: 'A previous browser-container cleanup is unconfirmed. Inspect and clean Docker, then restart the local server before using browser mode again.',
              code: 'container_teardown_unconfirmed',
              executionMode: 'docker-browser-requested',
              containerTeardown: 'unconfirmed',
            });
          } else {
            try {
              const result = await browserContainerRunner({
                optIn: true,
                decision: scenario.decision,
                personaId: scenario.personaId,
              });
              sendJson(response, 200, { ...result, executionMode: 'docker-browser-requested' });
            } catch (error) {
              const containerTeardown = error?.containerTeardown === 'confirmed' ? 'confirmed' : 'unconfirmed';
              if (containerTeardown !== 'confirmed') browserContainerCleanupUnconfirmed = true;
              const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code)
                ? error.code
                : 'browser_container_failed';
              sendJson(response, 503, {
                error: 'Browser-container run failed. No in-memory fallback was used.',
                code,
                executionMode: 'docker-browser-requested',
                containerTeardown,
              });
            }
          }
        } else {
          adapter = createAdapter();
          activeAdapter = adapter;
          const result = await executeOAuthScenario({ input, personas, adapter });
          sendJson(response, result.ok ? 200 : 500, {
            ...result,
            executionMode: vultrMode ? 'vultr-gated' : 'local-synthetic',
          });
        }
      } catch (error) {
        const status = error instanceof ScenarioInputError ? error.status : 500;
        sendJson(response, status, {
          error: error instanceof ScenarioInputError ? error.message : 'Synthetic scenario failed.',
        });
      } finally {
        if (!adapter?.activeSandbox && !adapter?.lastSandbox?.active) activeAdapter = null;
        scenarioRunning = false;
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/ocean/profiles') {
      sendJson(response, 200, { profiles: oceanProfileCatalog.profiles, scenarios: oceanProfileCatalog.scenarios });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, { ok: true, buildId });
      return;
    }

    // Desktop world v3: the seed plus an optional profile overlay, from DESKTOP_WORLD_DIR (default data/) or DESKTOP_WORLD_URL.
    if (request.method === 'GET' && pathname === '/api/desktop/world') {
      const profile = new URL(request.url, 'http://127.0.0.1').searchParams.get('profile');
      if (profile !== null && !PROFILE_SLUG_RE.test(profile)) {
        sendJson(response, 400, { error: 'The profile must be 1-40 characters of a-z, 0-9 or -.' });
        return;
      }
      try {
        const { world, profileApplied } = await worldSource.load(profile);
        response.setHeader('X-Desktop-Profile', profileApplied ? 'applied' : 'none');
        sendJson(response, 200, world);
      } catch (error) {
        sendJson(response, error instanceof DesktopWorldError ? error.status : 500, { error: error instanceof DesktopWorldError ? error.message : 'The desktop world is unavailable.' });
      }
      return;
    }

    // Live world events for one run: GET subscribes (Server-Sent Events), POST publishes {type:'patch'|'replace', ...}.
    if (pathname === '/api/desktop/events') {
      const params = new URL(request.url, 'http://127.0.0.1').searchParams;
      const run = params.get('run');
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        sendJson(response, 405, { error: 'Use GET to subscribe or POST to publish.', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      if (!RUN_ID_RE.test(run ?? '')) {
        sendJson(response, 400, { error: 'The run must be 1-40 characters of a-z, 0-9 or -.' });
        return;
      }
      if (request.method === 'GET') {
        if (!originIsAllowed(request, publicOrigin)) {
          sendJson(response, 403, { error: 'Local origin required.', code: 'LOCAL_ORIGIN_REQUIRED' });
          return;
        }
        const replay = REPLAY_RUN_RE.test(run);
        const ip = replay ? peerAddress(request) : '';
        if (replay && !desktopEvents.has(run)) {
          sendJson(response, 404, { error: 'Not found.' });
          return;
        }
        if (replay && (desktopEvents.subscribers(run) >= REPLAY_SUBSCRIBERS_PER_RUN || (replaySubscribersByIp.get(ip) ?? 0) >= REPLAY_SUBSCRIBERS_PER_IP)) {
          sendJson(response, 503, { error: 'Too many subscribers for this run.', code: 'EVENTS_FULL' });
          return;
        }
        const lastEventId = String(request.headers['last-event-id'] || params.get('last') || '').slice(0, 64);
        if (!desktopEvents.subscribe(run, response, lastEventId, { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' })) {
          sendJson(response, 503, { error: 'Too many subscribers for this run.', code: 'EVENTS_FULL' });
        } else if (replay) {
          replaySubscribersByIp.set(ip, (replaySubscribersByIp.get(ip) ?? 0) + 1);
          response.on('close', () => {
            const left = (replaySubscribersByIp.get(ip) ?? 1) - 1;
            if (left > 0) replaySubscribersByIp.set(ip, left);
            else replaySubscribersByIp.delete(ip);
          });
        }
        return;
      }
      // Without DESKTOP_EVENTS_TOKEN only a loopback peer on the local origin may publish; with it, the bearer token is required.
      const allowed = desktopEventsToken
        ? tokenMatches(request.headers.authorization, desktopEventsToken) && (!request.headers.origin || originIsAllowed(request, publicOrigin))
        : LOOPBACK_PEERS.has(request.socket.remoteAddress) && originIsLocal(request);
      if (!allowed) {
        sendJson(response, desktopEventsToken ? 401 : 403, { error: desktopEventsToken ? 'A valid bearer token is required.' : 'Local origin required.', code: 'EVENTS_NOT_ALLOWED' });
        return;
      }
      try {
        const event = parseDesktopEvent(await readJsonRequest(request, EVENT_MAX_BYTES), (await worldSource.load(null)).world);
        sendJson(response, 202, { ok: true, ...desktopEvents.publish(run, event) });
      } catch (error) {
        const known = error instanceof DesktopWorldError || error instanceof ScenarioInputError;
        sendJson(response, known ? error.status : 500, { error: known ? error.message : 'The event could not be published.' });
      }
      return;
    }

    // Starts one sandbox run for a page: the controller streams its events to /api/desktop/events?run=<run> as world.sandbox
    // patches. The mode is server configuration (DESKTOP_SANDBOX_MODE), never a request field. Loopback and local origin only.
    if (pathname === '/api/desktop/sandbox/run') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'Use POST to start a sandbox run.', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      if (hackathonControllerMode) {
        sendJson(response, 503, { error: 'Sandbox runs from the desktop page are disabled in controller mode.', code: 'WORKER_BACKEND_REQUIRED' });
        return;
      }
      if (!LOOPBACK_PEERS.has(request.socket.remoteAddress) || !originIsLocal(request)) {
        sendJson(response, 403, { error: 'Local origin required.', code: 'LOCAL_ORIGIN_REQUIRED' });
        return;
      }
      const run = new URL(request.url, 'http://127.0.0.1').searchParams.get('run');
      if (!RUN_ID_RE.test(run ?? '')) {
        sendJson(response, 400, { error: 'The run must be 1-40 characters of a-z, 0-9 or -.' });
        return;
      }
      try {
        const input = await readJsonRequest(request);
        assertTrainingRequestKeys(input, new Set(['scenarioId']), 'sandbox run request');
        if (typeof input.scenarioId !== 'string' || !SANDBOX_SCENARIO_ID_RE.test(input.scenarioId)) {
          throw new ScenarioInputError('The scenarioId must be 1-40 characters of a-z, 0-9 or -.');
        }
        const attackKind = loadScenarioKinds(root).kinds[input.scenarioId];
        if (!attackKind) {
          sendJson(response, 404, { error: 'Unknown scenario.', code: 'UNKNOWN_SCENARIO' });
          return;
        }
        if (sandboxMode === 'vultr' && !vultrGateReport(sandboxEnv).ready) {
          sendJson(response, 503, { error: 'The Vultr sandbox gates are not satisfied.', code: 'SANDBOX_GATE_CLOSED' });
          return;
        }
        if (activeSandboxRuns.has(run)) {
          sendJson(response, 409, { error: 'This run already has an active sandbox.', code: 'SANDBOX_BUSY' });
          return;
        }
        if (activeSandboxRuns.size >= MAX_ACTIVE_SANDBOX_RUNS) {
          sendJson(response, 429, { error: 'Too many active sandbox runs.', code: 'SANDBOX_LIMIT' });
          return;
        }
        const active = Promise.resolve().then(() => sandboxRunner({
          scenarioId: input.scenarioId, attackKind, runId: run, mode: sandboxMode, baseUrl: `http://${request.headers.host}`,
          token: desktopEventsToken || undefined, env: sandboxEnv,
        })).catch(() => null).finally(() => activeSandboxRuns.delete(run));
        activeSandboxRuns.set(run, active);
        sendJson(response, 202, { ok: true, runId: run, scenarioId: input.scenarioId, attackKind, mode: sandboxMode });
      } catch (error) {
        const known = error instanceof TrainingSessionError || error instanceof ScenarioInputError;
        sendJson(response, known ? error.status : 500, { error: known ? error.message : 'The sandbox run could not be started.' });
      }
      return;
    }

    if (request.method === 'GET' && pathname === '/api/desktop-templates/status') {
      sendJson(response, 200, {
        enabled: templateShellsEnabled,
        source: templateShellsEnabled ? 'local-only final Windows and macOS shells (world contract v3)' : 'custom fallback desktop',
        osModes: templateShellsEnabled ? ['win11-final', 'macos-final'] : ['windows-style', 'macos-style'],
        ...(templateShellsEnabled ? { shellOrigin } : {}),
      });
      return;
    }

    const creatureAsset = oceanProfileCatalog.assets.get(pathname);
    if (request.method === 'GET' && creatureAsset) {
      response.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': creatureAsset.bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      });
      response.end(creatureAsset.bytes);
      return;
    }

    const morphologyAsset = oceanProfileCatalog.morphologyAssets.get(pathname);
    if (request.method === 'GET' && morphologyAsset) {
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': morphologyAsset.bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      });
      response.end(morphologyAsset.bytes);
      return;
    }

    // Victim avatar for the scenario desktops (world.user.avatar), by exact id.
    const avatarId = request.method === 'GET' ? /^\/avatars\/([a-z0-9-]{1,40})$/.exec(pathname)?.[1] : undefined;
    if (avatarId) {
      const avatar = readAvatar(root, avatarId);
      if (!avatar) {
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      response.writeHead(200, {
        'Content-Type': avatar.mime,
        'Content-Length': avatar.bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      });
      response.end(avatar.bytes);
      return;
    }

    if (request.method === 'GET' && pathname === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    const asset = DESKTOP_ASSETS.get(pathname) ?? (templateShellsEnabled ? OCEAN_SCENE_SCRIPTS.get(pathname) : undefined);
    if (request.method === 'GET' && asset) {
      let body;
      try {
        body = readFileSync(asset.file);
      } catch (error) {
        // A scenario script that is not written yet is a 404; any other asset must exist.
        if (error?.code !== 'ENOENT' || !pathname.startsWith('/ocean-scenarios/')) throw error;
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      response.writeHead(200, {
        'Content-Type': asset.mime,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': pathname === '/desktop.html' ? desktopCsp : CSP,
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(body);
      return;
    }

    if (request.method === 'GET' && rendererAssets.has(pathname)) {
      const asset = rendererAssets.get(pathname);
      const body = readFileSync(asset.full);
      response.writeHead(200, { 'Content-Type': asset.mime, 'Content-Length': body.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': RENDER_CSP, 'Referrer-Policy': 'no-referrer' });
      response.end(body);
      return;
    }

    if (request.method === 'GET' && pathname === '/chamber.html') {
      try {
        sendBody(response, readFileSync(join(root, 'chamber.html')), 'text/html; charset=utf-8', CSP);
      } catch {
        sendJson(response, 500, { error: 'Run `node build.mjs` to generate the local page first.' });
      }
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  };
  // A handler that throws must answer 500 (or drop the socket) instead of becoming an unhandled rejection that ends the process.
  const server = createServer((request, response) => {
    handleRequest(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'Internal error.' });
      else response.destroy();
    });
  });
  server.teardownActiveScenario = async () => {
    if (activeAdapter?.activeSandbox) await activeAdapter.destroySandbox(activeAdapter.activeSandbox);
    else if (activeAdapter?.lastSandbox?.active) await activeAdapter.destroySandbox(activeAdapter.lastSandbox);
  };
  // Resolves when every page-started sandbox run has finished (its container or instance is torn down).
  server.sandboxRunsIdle = async () => { await Promise.all([...activeSandboxRuns.values()]); };
  server.teardownTrainingSessions = () => trainingSessionStore.dispose();
  server.teardownOceanProfileSessions = () => oceanProfileSessions.dispose();
  server.once('close', server.teardownTrainingSessions);
  server.once('close', server.teardownOceanProfileSessions);
  // Open event streams would keep close() waiting forever, so they end first.
  const closeServer = server.close.bind(server);
  server.close = callback => {
    desktopEvents.close();
    detonation.stop();
    return closeServer(callback);
  };
  return server;
}

// An already running comparison server counts only if it serves both final shells framable by this app.
async function templatePreviewServerReady() {
  try {
    const responses = await Promise.all(FINAL_SHELL_PAGES.map(page => fetch(`${DEFAULT_SHELL_ORIGIN}${page}?oceanShell=1`, { signal: AbortSignal.timeout(750) })));
    await Promise.all(responses.map(response => response.arrayBuffer()));
    return responses.every(response => response.ok && (response.headers.get('content-security-policy') || '').includes('http://127.0.0.1:4173'));
  } catch {
    return false;
  }
}

async function startLocalTemplatePreviewServer() {
  if (process.env.VULTR_HACKATHON_MODE === 'true' || process.env.VULTR_SANDBOX_MODE === 'vultr' ||
      process.env.ENABLE_TEMPLATE_DESKTOPS === 'false' || productionFlag(process.env)) {
    return { enabled: false, server: null };
  }
  if (await templatePreviewServerReady()) return { enabled: true, server: null };
  try {
    const { createComparisonServer } = await import('./desktop-comparison/server.mjs');
    const server = createComparisonServer();
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(4189, '127.0.0.1', resolveListen);
    });
    return { enabled: true, server };
  } catch (error) {
    console.error(`Training desktop shells unavailable: ${error?.code || error?.message || 'local comparison server failed'}`);
    return { enabled: false, server: null };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('PORT must be an integer from 1024 through 65535.');
    process.exitCode = 1;
  } else {
    const templatePreview = await startLocalTemplatePreviewServer();
    const server = createAppServer({ templateShellsEnabled: templatePreview.enabled });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Detonation Chamber: http://127.0.0.1:${port}`);
      if (templatePreview.enabled) console.log(`Local-only final Windows and macOS shells: ${DEFAULT_SHELL_ORIGIN}`);
      if (process.env.VULTR_HACKATHON_MODE === 'true') {
        console.log('Vultr hackathon controller mode. In-process training is disabled; the isolated proof route requires its explicit opt-ins and server-side inference gate.');
      } else if (process.env.VULTR_SANDBOX_MODE === 'vultr') {
        console.log('Vultr mode is gated; cloud API and private-VPC calls occur only after plan and cost confirmation.');
      } else {
        console.log('Local synthetic mode. No external targets or services are contacted.');
      }
    });
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await server.teardownActiveScenario();
        server.teardownTrainingSessions();
      } catch {
        console.error('Teardown is unconfirmed; inspect the selected local or cloud execution environment before another run.');
      }
      await new Promise(resolveClose => server.close(resolveClose));
      if (templatePreview.server?.listening) {
        templatePreview.server.closeAllConnections?.();
        await new Promise(resolveClose => templatePreview.server.close(resolveClose));
      }
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}

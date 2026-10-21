import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { LocalSyntheticAdapter, OAUTH_ATTACK_ID } from '../backend/oauth-scenario.mjs';
import { loadPersonas } from '../backend/personas.mjs';
import { createAppServer } from '../server.mjs';

const personas = loadPersonas();
const personaId = personas.personas[0].id;

async function withServer(options, run) {
  const previousMode = process.env.VULTR_SANDBOX_MODE;
  const { vultrSandboxMode = false, ...serverOptions } = options;
  if (vultrSandboxMode) process.env.VULTR_SANDBOX_MODE = 'vultr';
  else delete process.env.VULTR_SANDBOX_MODE;
  const server = createAppServer({ personas, hackathonControllerMode: false, ...serverOptions });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body),
  });
  try {
    await run({ post, server, base });
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    if (previousMode === undefined) delete process.env.VULTR_SANDBOX_MODE;
    else process.env.VULTR_SANDBOX_MODE = previousMode;
  }
}

function requestFromPlan(planId, overrides = {}) {
  return {
    attackId: OAUTH_ATTACK_ID,
    personaId,
    decision: 'deny',
    planId,
    optIn: true,
    browserContainerOptIn: true,
    ...overrides,
  };
}

test('proof UI labels host Docker honestly and escapes server evidence labels', () => {
  const template = readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
  assert.match(template, /Host Docker evidence · Vultr hosting is not verified/);
  assert.match(template, /Injected test evidence · not live/);
  assert.match(template, /Selected profile: Deception · Abyss/);
  assert.match(template, /harm tier is separate from the historical SEV2 label/);
  assert.match(template, /\$\{esc\(evidenceLabel\)\}/);
  assert.doesNotMatch(template, /Vultr browser proof/);
});

test('generated chamber inline script parses before its browser interaction smoke checks', () => {
  const html = readFileSync(new URL('../chamber.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0, 'generated chamber contains an inline application script');
  assert.match(html, /requestedDemo\s*===\s*OAUTH_ATTACK_ID/);
  assert.match(html, /openDrawer\(attack,\s*row\)/);
  scripts.forEach((source, index) => new Script(source, { filename: `chamber-inline-${index + 1}.js` }));
});

test('ocean profile matrix links from the main ocean and serves thirty hash-verified creature variants', async () => {
  await withServer({}, async ({ base }) => {
    const main = await fetch(`${base}/`);
    assert.equal(main.status, 200);
    assert.equal(main.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
    assert.match(await main.text(), /href="\/ocean-profiles\.html"/);

    const page = await fetch(`${base}/ocean-profiles.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="profile-matrix"/);
    const entry = await fetch(`${base}/ocean-entry.html?profile=deception-abyss`);
    assert.equal(entry.status, 200);
    assert.equal(entry.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
    const entryHtml = await entry.text();
    assert.match(entryHtml, /visual-only camera-bite cinematic/);
    assert.match(entryHtml, /id="safety-card"/);
    assert.match(entryHtml, /Fictional, local\. No camera, no real accounts, no real files\./);
    assert.match(entryHtml, /<button id="enter-desktop"[^>]*disabled>Enter the desktop<\/button>/);
    const entryScript = await (await fetch(`${base}/ocean-entry.js`)).text();
    assert.doesNotMatch(entryScript, /getUserMedia|mediaDevices/);
    assert.match(entryScript, /sessionStorage\.setItem\(OPT_IN_STORAGE_KEY, profile\.id\)/);
    assert.match(entryScript, /prefers-reduced-motion: reduce/);
    const desktop = await fetch(`${base}/desktop.html?profile=deception-abyss`);
    assert.equal(desktop.status, 200);
    assert.equal(desktop.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
    const desktopHtml = await desktop.text();
    assert.match(desktopHtml, /id="ocean-stage"/);
    assert.match(desktopHtml, /id="ocean-gate"/);
    assert.doesNotMatch(desktopHtml, /creature-preview|template-shell-controls/);
    const chamber = await fetch(`${base}/chamber.html?demo=oauth-2023`);
    assert.equal(chamber.status, 200);
    assert.match(await chamber.text(), /const requestedDemo = new URLSearchParams/);
    const response = await fetch(`${base}/api/ocean/profiles`);
    assert.equal(response.status, 200);
    const { profiles, scenarios } = await response.json();
    assert.equal(profiles.length, 30);
    assert.equal(scenarios.length, 60);
    assert.equal(scenarios.filter(scenario => scenario.role === 'anchor').length, 30);
    assert.equal(scenarios.filter(scenario => scenario.role === 'free').length, 30);
    const evaluated = new Set(['sourced', 'partial', 'unsupported']);
    assert.ok(scenarios.every(scenario => evaluated.has(scenario.status)), 'every scenario has been evaluated against sources');
    assert.equal(scenarios.filter(scenario => scenario.status === 'sourced').length, 45);
    assert.equal(scenarios.filter(scenario => scenario.status === 'partial').length, 13);
    assert.equal(scenarios.filter(scenario => scenario.status === 'unsupported').length, 2);
    assert.ok(scenarios.filter(scenario => scenario.status === 'sourced').every(scenario => scenario.sources.length > 0));
    assert.ok(scenarios.filter(scenario => scenario.status !== 'sourced').every(scenario => typeof scenario.note === 'string' && scenario.note));
    assert.ok(scenarios.every(scenario => scenario.sources.every(source => source.startsWith('https://'))));

    const assets = await Promise.all(profiles.map(async profile => {
      const asset = await fetch(`${base}${profile.assetUrl}`);
      assert.equal(asset.status, 200, profile.id);
      assert.equal(asset.headers.get('content-type'), 'image/gif');
      const bytes = Buffer.from(await asset.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), profile.assetSha256, profile.id);
      return asset;
    }));
    assert.equal(assets.length, 30);
    const morphologyManifest = new Map(profiles.map(profile => [profile.morphologyUrl, profile.morphologySha256]));
    assert.equal(morphologyManifest.size, 30);
    const morphologyAssets = await Promise.all([...morphologyManifest].map(async ([url, expectedHash]) => {
      const asset = await fetch(`${base}${url}`);
      assert.equal(asset.status, 200, url);
      assert.equal(asset.headers.get('content-type'), 'image/png');
      const bytes = Buffer.from(await asset.arrayBuffer());
      assert.equal(bytes.readUInt32BE(16), 256, `${url} width`);
      assert.equal(bytes.readUInt32BE(20), 256, `${url} height`);
      assert.equal(bytes[25], 6, `${url} retains true RGBA`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, url);
      return asset;
    }));
    assert.equal(morphologyAssets.length, 30);
    const extortion = profiles.filter(profile => profile.familyId === 'extortion-destruction');
    assert.ok(extortion.every(profile => profile.displayCreature === 'Squid / Kraken'));
    assert.deepEqual(extortion.map(profile => profile.morphologyUrl), ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'].map(depth => `/ocean-morphology/squid/${depth}.png`));
    assert.equal(extortion.find(profile => profile.depthId === 'sunlight').morphologyStage, extortion.find(profile => profile.depthId === 'twilight').morphologyStage);
    assert.equal(extortion.find(profile => profile.depthId === 'midnight').morphologyStage, extortion.find(profile => profile.depthId === 'abyss').morphologyStage);
  });
});

test('third-party desktop templates are local-only and disabled in hackathon controller mode', async () => {
  await withServer({ templateShellsEnabled: true }, async ({ base }) => {
    const status = await (await fetch(`${base}/api/desktop-templates/status`)).json();
    assert.equal(status.enabled, true);
    assert.equal(status.shellOrigin, 'http://127.0.0.1:4189');
    const desktop = await fetch(`${base}/desktop.html`);
    assert.match(desktop.headers.get('content-security-policy'), /frame-src 'self' http:\/\/127\.0\.0\.1:4189/);
  });
  await withServer({ templateShellsEnabled: true, shellOrigin: 'http://127.0.0.1:4371' }, async ({ base }) => {
    assert.equal((await (await fetch(`${base}/api/desktop-templates/status`)).json()).shellOrigin, 'http://127.0.0.1:4371');
    assert.match((await fetch(`${base}/desktop.html`)).headers.get('content-security-policy'), /frame-src 'self' http:\/\/127\.0\.0\.1:4371$/);
  });
  assert.throws(() => createAppServer({ personas, templateShellsEnabled: true, shellOrigin: 'https://shell.example' }), /shellOrigin/);
  await withServer({ templateShellsEnabled: true, hackathonControllerMode: true }, async ({ base }) => {
    const status = await (await fetch(`${base}/api/desktop-templates/status`)).json();
    assert.equal(status.enabled, false);
    assert.equal(status.shellOrigin, undefined);
    const desktop = await fetch(`${base}/desktop.html`);
    assert.doesNotMatch(desktop.headers.get('content-security-policy'), /127\.0\.0\.1:4189/);
  });
});

test('the parent desktop serves exactly the two authored scene scripts, only in local template mode', async () => {
  const preview = file => readFileSync(new URL(`../desktop-comparison/previews/${file}`, import.meta.url), 'utf8');
  await withServer({ templateShellsEnabled: true }, async ({ base, post }) => {
    for (const [route, file] of [['/ocean-scenes.js', 'ocean-scenes.js'], ['/ocean-fx.js', 'ocean-fx.js']]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /^text\/javascript/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
      assert.equal(await response.text(), preview(file), `${route} is the authored file, read from disk`);
    }
    for (const route of [
      '/ocean-bridge.js', '/ocean-apps.js', '/ocean-skin-win.js', '/ocean-skin-mac.js', '/previews/ocean-scenes.js', '/previews/windows11/local.html',
      '/previews/mac/local.html', '/ocean-scenes.js/', '/ocean-scenes.js/x', '/OCEAN-SCENES.JS', '/ocean-fx.JS', '/ocean-scenes.js%2f..%2fserver.mjs',
      '/desktop-comparison/previews/ocean-scenes.js', '/../server.mjs', '/ocean-scenes.js.map',
    ]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 404, `${route} is not served`);
      await response.arrayBuffer();
    }
    const posted = await post('/ocean-scenes.js', {});
    assert.equal(posted.status, 404, 'only GET serves the scripts');
  });
  for (const options of [{}, { templateShellsEnabled: true, hackathonControllerMode: true }, { templateShellsEnabled: true, vultrSandboxMode: true, adapterFactory: () => new LocalSyntheticAdapter() }]) {
    await withServer(options, async ({ base }) => {
      for (const route of ['/ocean-scenes.js', '/ocean-fx.js']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 404, `${route} stays unserved without local template mode (${JSON.stringify(Object.keys(options))})`);
        await response.arrayBuffer();
      }
      assert.equal((await fetch(`${base}/desktop-model.js`)).status, 200, 'the DOM-free model carries no template content and no secrets');
    });
  }
});

test('local profile API runs only fixed synthetic effects for the selected family/depth', async () => {
  await withServer({}, async ({ base }) => {
    const postJson = (path, body) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
    const denied = await postJson('/api/ocean/session/start', { profileId: 'deception-sunlight', optIn: false });
    assert.equal(denied.status, 403);

    const started = await postJson('/api/ocean/session/start', { profileId: 'deception-sunlight', optIn: true });
    assert.equal(started.status, 200);
    const session = await started.json();
    assert.equal(session.executionMode, 'local-synthetic-profile');
    assert.equal(session.status, 'awaiting_victim_action');
    assert.equal(session.state.syntheticOnly, true);
    assert.equal(session.state.effect, null);

    const rejected = await postJson('/api/ocean/session/action', { sessionId: session.sessionId, actionId: 'arbitrary-command' });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, 'ACTION_NOT_ALLOWED');
    const acted = await postJson('/api/ocean/session/action', { sessionId: session.sessionId, actionId: 'open-sample' });
    assert.equal(acted.status, 200);
    const completed = await acted.json();
    assert.equal(completed.status, 'complete');
    assert.equal(completed.state.effect.after, 'granted to a fictional app');
    assert.equal(completed.receipt.syntheticOnly, true);

    const trench = await postJson('/api/ocean/session/start', { profileId: 'extortion-destruction-trench', optIn: true });
    assert.equal(trench.status, 200);
    const noResponse = await trench.json();
    assert.equal(noResponse.status, 'complete');
    assert.equal(noResponse.victimAction, 'none');
    assert.ok(noResponse.state.effect);

    const closed = await postJson('/api/ocean/session/close', { sessionId: session.sessionId });
    assert.equal(closed.status, 200);
    assert.equal((await closed.json()).closed, true);
  });
});

test('cloud modes refuse local profile-session fallback', async () => {
  for (const options of [
    { hackathonControllerMode: true, hackathonProofEnabled: false },
    { vultrSandboxMode: true, adapterFactory: () => new LocalSyntheticAdapter() },
  ]) {
    await withServer(options, async ({ post, base }) => {
      const response = await post('/api/ocean/session/start', { profileId: 'deception-abyss', optIn: true });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'WORKER_BACKEND_REQUIRED');
      const health = await (await fetch(`${base}/api/healthz`)).json();
      assert.notEqual(health.mode, 'local-synthetic');
    });
  }
});

test('local browser-container opt-in selects the runner and returns its screenshots without using the memory fallback', async () => {
  const runnerCalls = [];
  let adapterCreations = 0;
  await withServer({
    adapterFactory: () => {
      adapterCreations++;
      return new LocalSyntheticAdapter();
    },
    browserContainerRunner: async input => {
      runnerCalls.push(input);
      return {
        ok: true,
        runId: 'test-browser-run',
        decision: input.decision,
        personaId: input.personaId,
        status: 'denied',
        receipt: {
          status: 'denied', decision: 'deny', tokenIssued: false,
          exposedMessages: [], exposedMessageCount: 0,
        },
        events: [{ type: 'receipt.created' }],
        screenshots: [{ stage: 'receipt', mimeType: 'image/jpeg', base64: '/9j/2Q==' }],
        containerTeardown: 'confirmed',
      };
    },
  }, async ({ post }) => {
    const noTrainingOptIn = await post('/api/scenarios/oauth/plan', {
      attackId: OAUTH_ATTACK_ID, personaId, browserContainerOptIn: true,
    });
    assert.equal(noTrainingOptIn.status, 400);
    assert.equal(runnerCalls.length, 0);

    const planResponse = await post('/api/scenarios/oauth/plan', {
      attackId: OAUTH_ATTACK_ID, personaId, optIn: true, browserContainerOptIn: true,
    });
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.equal(plan.executionMode, 'docker-browser-requested');
    assert.equal(plan.browserContainerOptIn, true);
    assert.equal(adapterCreations, 0, 'planning must not create a local adapter');
    assert.equal(runnerCalls.length, 0, 'planning must not start Docker');

    const executionWithoutTrainingOptIn = await post('/api/scenarios/oauth/execute', requestFromPlan(plan.planId, {
      optIn: false,
    }));
    assert.equal(executionWithoutTrainingOptIn.status, 400);
    assert.equal(runnerCalls.length, 0);

    const mismatchedPlan = await post('/api/scenarios/oauth/execute', requestFromPlan(plan.planId, {
      browserContainerOptIn: false,
    }));
    assert.equal(mismatchedPlan.status, 400, 'the plan binds the selected execution mode');
    assert.equal(runnerCalls.length, 0);

    const response = await post('/api/scenarios/oauth/execute', requestFromPlan(plan.planId));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.executionMode, 'docker-browser-requested');
    assert.equal(result.screenshots[0].stage, 'receipt');
    assert.equal(result.containerTeardown, 'confirmed');
    assert.deepEqual(runnerCalls, [{ optIn: true, decision: 'deny', personaId }]);
    assert.equal(adapterCreations, 0, 'container execution must not fall back to the in-memory adapter');
  });
});

test('selected browser-container failures fail closed and preserve teardown status', async () => {
  let runnerCalls = 0;
  let adapterCreations = 0;
  await withServer({
    adapterFactory: () => {
      adapterCreations++;
      return new LocalSyntheticAdapter();
    },
    browserContainerRunner: async () => {
      runnerCalls++;
      const error = new Error('private Docker diagnostic is not returned');
      error.code = 'docker_run_failed';
      error.containerTeardown = 'unconfirmed';
      throw error;
    },
  }, async ({ post }) => {
    const planResponse = await post('/api/scenarios/oauth/plan', {
      attackId: OAUTH_ATTACK_ID, personaId, optIn: true, browserContainerOptIn: true,
    });
    const plan = await planResponse.json();
    const response = await post('/api/scenarios/oauth/execute', requestFromPlan(plan.planId));
    assert.equal(response.status, 503);
    const failure = await response.json();
    assert.equal(failure.executionMode, 'docker-browser-requested');
    assert.equal(failure.code, 'docker_run_failed');
    assert.equal(failure.containerTeardown, 'unconfirmed');
    assert.match(failure.error, /No in-memory fallback was used/);
    assert.equal('receipt' in failure, false);
    assert.equal(runnerCalls, 1);
    assert.equal(adapterCreations, 0);

    const blockedRetry = await post('/api/scenarios/oauth/execute', requestFromPlan(plan.planId));
    assert.equal(blockedRetry.status, 503);
    assert.equal((await blockedRetry.json()).code, 'container_teardown_unconfirmed');
    assert.equal(runnerCalls, 1, 'do not start another browser container before manual inspection');
    assert.equal(adapterCreations, 0);
  });
});

test('a concurrent run is rejected before another container starts', async () => {
  let started;
  let release;
  const entered = new Promise(resolve => { started = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  let runnerCalls = 0;
  await withServer({
    browserContainerRunner: async () => {
      runnerCalls++;
      started();
      await hold;
      return { ok: true, containerTeardown: 'confirmed' };
    },
  }, async ({ post }) => {
    const planResponse = await post('/api/scenarios/oauth/plan', {
      attackId: OAUTH_ATTACK_ID, personaId, optIn: true, browserContainerOptIn: true,
    });
    const { planId } = await planResponse.json();
    const first = post('/api/scenarios/oauth/execute', requestFromPlan(planId));
    try {
      await entered;
      const busy = await post('/api/scenarios/oauth/execute', requestFromPlan(planId));
      assert.equal(busy.status, 409);
      assert.deepEqual(await busy.json(), {
        error: 'A synthetic scenario is already running.',
        code: 'scenario_busy',
        containerTeardown: 'not_started',
      });
      assert.equal(runnerCalls, 1);
    } finally {
      release();
      await first;
    }
  });
});

test('default local plan and execution keep using the in-memory adapter', async () => {
  const adapter = new LocalSyntheticAdapter();
  let browserRunnerCalls = 0;
  await withServer({
    adapterFactory: () => adapter,
    browserContainerRunner: async () => {
      browserRunnerCalls++;
      throw new Error('browser runner must not be selected by default');
    },
  }, async ({ post, server, base }) => {
    assert.equal(server.address().address, '127.0.0.1');
    const pageResponse = await fetch(`${base}/chamber.html`);
    assert.equal(pageResponse.status, 200);
    const html = await pageResponse.text();
    assert.match(html, /Fictional training desktop/);
    assert.match(html, /id="oauth-browser-opt-in"/);
    assert.match(html, /id="oauth-opt-in"/);
    assert.match(html, /id="oauth-inference-ack"/);
    assert.match(html, /\/api\/hackathon\/proof/);

    const desktopResponse = await fetch(`${base}/desktop.html`);
    assert.equal(desktopResponse.status, 200);
    const desktop = await desktopResponse.text();
    assert.match(desktop, /id="ocean-chrome"/);
    assert.match(desktop, /id="os-macos"/);
    assert.doesNotMatch(desktop, /creature-preview|training-desktop|id="os-switch"|id="launcher"|Northstar/);
    const desktopCss = await (await fetch(`${base}/desktop.css`)).text();
    const desktopJs = await (await fetch(`${base}/desktop.js`)).text();
    assert.match(desktopCss, /body\[data-os="macos"\]/);
    assert.match(desktopCss, /body\[data-depth="trench"\]/);
    assert.match(desktopJs, /async function loadProfile\(/);
    assert.match(desktopJs, /type: 'ocean-shell-attach', version: WORLD_VERSION/);
    assert.match(desktopJs, /type: 'world', version: WORLD_VERSION/);
    assert.doesNotMatch(desktopJs, /type: 'scene-init'|type: 'desktop-state'|type: 'suspend'/, 'the retired v2 shell protocol is gone');
    assert.match(desktop, /id="ocean-fx-layer"/);
    assert.match(desktop, /src="\.\/desktop-model\.js"[\s\S]*src="\.\/world-model\.js"[\s\S]*src="\.\/ocean-scenes\.js"[\s\S]*src="\.\/ocean-fx\.js"[\s\S]*src="\.\/scene-world\.js"[\s\S]*src="\.\/desktop\.js"/);
    for (const [route, global] of [['/world-model.js', 'OceanWorldModel'], ['/scene-world.js', 'OceanSceneWorld']]) {
      const script = await fetch(`${base}${route}`);
      assert.equal(script.status, 200, route);
      assert.match(script.headers.get('content-type'), /^text\/javascript/);
      assert.match(await script.text(), new RegExp(`window\.${global} = api`));
    }
    const modelJs = await fetch(`${base}/desktop-model.js`);
    assert.equal(modelJs.status, 200);
    assert.match(modelJs.headers.get('content-type'), /^text\/javascript/);
    assert.match(await modelJs.text(), /window\.OceanDesktopModel = api/);
    assert.match(desktopJs, /window\.location\.replace\('\/ocean-profiles\.html'\)/);
    assert.doesNotMatch(desktopJs, /OCEAN_PROFILE_BY_SCENARIO|\/api\/training|Consent desk|Start synthetic scenario|PROFILE_APP_DETAILS/);
    assert.match(desktopCss, /\.ocean-chrome/);
    assert.doesNotMatch(desktopCss, /profile-swim/);
    const profileCss = await (await fetch(`${base}/ocean-profiles.css`)).text();
    assert.match(profileCss, /prefers-reduced-motion:\s*reduce/);
    assert.match(profileCss, /\[data-depth="trench"\]/);
    const profilePageJs = await (await fetch(`${base}/ocean-profiles.js`)).text();
    assert.match(profilePageJs, /\/ocean-entry\.html\?profile=/);

    const planResponse = await post('/api/scenarios/oauth/plan', {
      attackId: OAUTH_ATTACK_ID, personaId, optIn: true, browserContainerOptIn: false,
    });
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.equal(plan.executionMode, 'local-synthetic');
    const response = await post('/api/scenarios/oauth/execute', requestFromPlan(plan.planId, {
      browserContainerOptIn: false,
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.executionMode, 'local-synthetic');
    assert.equal(result.receipt.status, 'denied');
    assert.equal(adapter.destroyedCount, 1);
    assert.equal(browserRunnerCalls, 0);
  });
});

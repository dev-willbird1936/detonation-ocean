// Creature desktop parent (WORLD-CONTRACT v3). The parent owns two states:
//   world  (OceanWorldModel)   apps, windows, files, data and settings both OS shells render;
//   desk   (OceanDesktopModel) the CONTRACT-V2 scene machine: lure, choice, attack, debrief.
// OceanSceneWorld projects every desk change into the world. Shell gestures arrive as world intents; the parent applies
// them and maps the ones that matter to the scene back to V2 intents. Swapping OS changes only which shell is visible.
(() => {
  'use strict';

  const SHELL_PATHS = Object.freeze({
    windows: '/previews/win11-final/index.html?oceanShell=1',
    macos: '/previews/macos-final/index.html?oceanShell=1',
  });
  const DEFAULT_SHELL_ORIGIN = 'http://127.0.0.1:4189';
  const SHELL_ORIGIN_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
  const DEPTH_IDS = Object.freeze(['sunlight', 'twilight', 'midnight', 'abyss', 'trench']);
  const WORLD_VERSION = 3;
  const CREATURE_MAX_BYTES = 1_500_000;
  const CONNECT_TIMEOUT_MS = 15000;
  const ATTACH_RETRY_MS = 2000;
  const FX_FAILURE_DONE_MS = 1500;
  const SANDBOX_RUN_PATH = '/api/desktop/sandbox/run';
  const ATTACK_FX_TIMEOUT_MS = 26000;
  const OPT_IN_STORAGE_KEY = 'ocean-opt-in';
  // A job replay (?job=<jobId>) plays a neutral desktop: the world is data/desktop-profiles/detonation-replay.json and the
  // scene never advances, so no lure, process or attack appears. The state machine still needs a catalog entry to start on.
  const REPLAY_PROFILE = 'detonation-replay';
  const REPLAY_CATALOG_ENTRY = 'network-abuse-abyss';
  const PROOF_URL = '/chamber.html?demo=oauth-2023&profile=deception-abyss';
  const state = {
    profile: null,
    replay: false,
    profileExecutionMode: 'unknown',
    profileSimulationEnabled: false,
    hackathonProofAvailable: false,
    templatesEnabled: false,
    shellOrigin: DEFAULT_SHELL_ORIGIN,
    optedIn: false,
    reducedMotion: false,
    creatureSrc: null,
    scene: null,
    desk: null,
    world: null,
    baseWorld: null,
    shellsReady: false,
    shellPorts: new Map(),
    osMode: 'windows',
    lastSeq: new Map(),
    pushQueued: false,
    tickTimer: null,
    debriefKey: null,
    showedKey: null,
    showedClosed: null,
    fx: { id: null, run: null, startedIds: new Set(), unsubscribers: new Set() },
    eraStart: null,
    sandboxRun: 'none',
    sandboxSignature: 'null',
    sandboxListeners: new Set(),
  };
  const dom = Object.fromEntries([
    'ocean-stage', 'template-shell-host', 'windows-shell-frame', 'macos-shell-frame', 'ocean-status',
    'ocean-fx-layer', 'ocean-fx-caption', 'ocean-hint', 'ocean-debrief', 'ocean-showed', 'ocean-intro', 'intro-title', 'intro-line', 'intro-next',
    'intro-dismiss', 'ocean-brief',
    'ocean-unavailable', 'unavailable-title', 'unavailable-detail', 'unavailable-proof',
    'ocean-gate', 'gate-title', 'gate-summary', 'gate-mode', 'gate-opt-in', 'gate-enter',
    'ocean-chrome', 'os-windows', 'os-macos', 'ocean-chip', 'ocean-chip-detail', 'ocean-chip-creature',
    'ocean-proof-link', 'ocean-restart', 'screen-reader-announcer',
  ].map(id => [id, document.getElementById(id)]));

  class ApiError extends Error {
    constructor(message, status = 0, code = '') {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  const clone = value => JSON.parse(JSON.stringify(value));

  function announce(message) {
    dom['screen-reader-announcer'].textContent = message;
  }

  const FETCH_OPTIONS = Object.freeze({ cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error' });

  async function request(endpoint, { method = 'GET', body } = {}) {
    const options = { ...FETCH_OPTIONS, method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(endpoint, options);
    } catch {
      throw new ApiError('The training API could not be reached. Check the local server and retry.');
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new ApiError('The training API returned an unreadable response.', response.status);
    }
    if (!response.ok) {
      const message = isRecord(result) && typeof result.error === 'string'
        ? result.error
        : `The training API returned status ${response.status}.`;
      const code = isRecord(result) && typeof result.code === 'string' ? result.code : '';
      throw new ApiError(message, response.status, code);
    }
    return result;
  }

  function boundedText(value, max = 160) {
    return typeof value === 'string' && value.length > 0 && value.length <= max;
  }

  function hasExactKeys(value, keys) {
    return isRecord(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  }

  function validateProfile(value, profileId) {
    const anchor = isRecord(value) ? value.anchor : null;
    if (!isRecord(value) || value.id !== profileId ||
        !['familyId', 'family', 'creature', 'depthId', 'depth', 'action'].every(key => boundedText(value[key])) ||
        !DEPTH_IDS.includes(value.depthId) ||
        typeof value.assetUrl !== 'string' ||
        !/^\/ocean-creatures\/[a-z-]+\/(sunlight|twilight|midnight|abyss|trench)\.gif$/.test(value.assetUrl) ||
        !isRecord(anchor) || !boundedText(anchor.id) || !boundedText(anchor.name) ||
        !(anchor.year === null || Number.isInteger(anchor.year)) ||
        !boundedText(anchor.victimAction, 240) || !boundedText(anchor.status, 40)) {
      throw new ApiError('This creature profile is not available.');
    }
    return value;
  }

  function anchorLabel(profile) {
    return profile.anchor.year ? `${profile.anchor.name} (${profile.anchor.year})` : profile.anchor.name;
  }

  function readOptIn(profileId) {
    try { return window.sessionStorage.getItem(OPT_IN_STORAGE_KEY) === profileId; }
    catch { return false; }
  }

  function writeOptIn(profileId) {
    try { window.sessionStorage.setItem(OPT_IN_STORAGE_KEY, profileId); }
    catch { /* Opt-in still applies to this page view when storage is unavailable. */ }
  }

  function showUnavailable(title, detail, { proof = false } = {}) {
    dom['ocean-status'].hidden = true;
    dom['unavailable-title'].textContent = title;
    dom['unavailable-detail'].textContent = detail;
    dom['unavailable-proof'].hidden = !proof;
    dom['unavailable-proof'].textContent = state.profileSimulationEnabled
      ? 'Open the separate OAuth exercise'
      : 'Open the gated OAuth worker proof';
    dom['ocean-unavailable'].hidden = false;
    document.body.dataset.sessionState = 'preview-error';
    announce(`${title}. ${detail}`);
  }

  function proofIsAvailable() {
    return state.profile?.id === 'deception-abyss' && (state.profileSimulationEnabled || state.hackathonProofAvailable);
  }

  async function loadCreatureSrc(profile) {
    try {
      const response = await fetch(profile.assetUrl, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error' });
      if (!response.ok || response.headers.get('content-type') !== 'image/gif') return null;
      const blob = await response.blob();
      if (blob.size === 0 || blob.size > CREATURE_MAX_BYTES) return null;
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' && reader.result.startsWith('data:image/gif;base64,') ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  function scriptsAreLoaded() {
    return typeof window.OceanDesktopModel?.createState === 'function' && typeof window.OceanWorldModel?.applyIntent === 'function' &&
      typeof window.OceanSceneWorld?.project === 'function' && typeof window.OceanScenes?.get === 'function' &&
      typeof window.OceanFx?.play === 'function';
  }

  // GET /api/desktop/world: the seed plus the profile overlay. A broken overlay falls back to the plain seed.
  // Without an overlay the wallpaper follows the scene depth.
  async function loadWorld(profile) {
    for (const endpoint of [`/api/desktop/world?profile=${encodeURIComponent(state.replay ? REPLAY_PROFILE : profile.id)}`, '/api/desktop/world']) {
      try {
        const response = await fetch(endpoint, { ...FETCH_OPTIONS, headers: { Accept: 'application/json' } });
        if (!response.ok) continue;
        const world = await response.json();
        if (!window.OceanWorldModel.validate(world).ok) continue;
        if (response.headers.get('x-desktop-profile') !== 'applied' && !world.sys.wallpaperUrl) world.sys.wallpaper = `depth-${profile.depthId}`;
        return world;
      } catch {
        // Try the next source.
      }
    }
    return null;
  }

  async function loadProfile(profileId) {
    let templates;
    try {
      const [catalog, health, status] = await Promise.all([
        request('/api/ocean/profiles'),
        request('/api/healthz'),
        request('/api/desktop-templates/status').catch(() => null),
      ]);
      if (!isRecord(catalog) || !Array.isArray(catalog.profiles) || catalog.profiles.length !== 30) {
        throw new ApiError('The creature profile catalog is incomplete.');
      }
      if (!isRecord(health) || typeof health.mode !== 'string') throw new ApiError('Execution mode is unavailable.');
      state.profileExecutionMode = health.mode;
      state.profileSimulationEnabled = health.mode === 'local-synthetic';
      state.hackathonProofAvailable = health.mode === 'vultr-hackathon-ready' && health.inferenceConfigured === true;
      // One of the 30 creature profiles, or one of the 60 scenarios (it plays on the profile of its family and depth).
      state.replay = profileId === REPLAY_PROFILE;
      const catalogId = state.replay ? REPLAY_CATALOG_ENTRY : profileId;
      const entry = catalog.profiles.find(item => isRecord(item) && item.id === catalogId) ??
        window.OceanScenarioProfile?.resolve(catalog, catalogId);
      if (!entry) {
        window.location.replace('/ocean-profiles.html');
        return;
      }
      state.profile = validateProfile(entry, catalogId);
      templates = status;
      state.templatesEnabled = isRecord(templates) && templates.enabled === true;
      if (state.templatesEnabled && typeof templates.shellOrigin === 'string' && SHELL_ORIGIN_RE.test(templates.shellOrigin)) state.shellOrigin = templates.shellOrigin;
    } catch (error) {
      showUnavailable('Creature desktop unavailable', error.message);
      return;
    }
    const profile = state.profile;
    document.body.dataset.family = profile.familyId;
    document.body.dataset.depth = profile.depthId;
    renderChrome(profile);
    if (!state.templatesEnabled) {
      showUnavailable(
        'The OS desktops are not served in this mode',
        'The Windows and macOS desktops are private local assets, so this mode runs no scripted scene and no in-process session. Nothing on this page is a cloud or worker run.',
        { proof: proofIsAvailable() },
      );
      return;
    }
    state.scene = scriptsAreLoaded() ? window.OceanScenes.get(profile.id, profile.anchor) : null;
    if (!state.scene) {
      showUnavailable('The training scene did not load', 'The scripted scene files are unavailable, so no desktop is started. Reload the page or restart the local server.');
      return;
    }
    // A scenario scene shows the profile's creature in the wallpaper and starts on the OS its real victim used.
    if (state.scene.attackKind) state.scene.creature = { family: profile.familyId, depth: profile.depthId, sprite: profile.assetUrl };
    if (state.scene.os) state.osMode = state.scene.os;
    state.baseWorld = await loadWorld(profile);
    if (!state.baseWorld) {
      showUnavailable('The desktop world did not load', 'The local server did not return a valid desktop world, so no desktop is started. Restart the local server, then reload.');
      return;
    }
    state.optedIn = readOptIn(profile.id);
    state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.desk = window.OceanDesktopModel.createState(profile, state.scene, { reducedMotion: state.reducedMotion });
    state.world = window.OceanSceneWorld.project(clone(state.baseWorld), { scene: state.scene, desk: state.desk, now: sceneNow() }).world;
    if (state.optedIn) setStatus('Preparing the desktop…');
    else openGate(profile);
    const creature = loadCreatureSrc(profile);
    const ready = await Promise.all(['windows', 'macos'].map(os => connectShell(os)));
    if (!ready.every(Boolean)) {
      for (const port of state.shellPorts.values()) port.close();
      state.shellPorts.clear();
      dom['windows-shell-frame'].src = 'about:blank';
      dom['macos-shell-frame'].src = 'about:blank';
      dom['ocean-gate'].hidden = true;
      showUnavailable('The OS desktops did not connect', 'The local Windows and macOS shells did not respond. Check that the local preview server is running, then reload.');
      return;
    }
    state.creatureSrc = await creature;
    state.shellsReady = true;
    subscribeWorldEvents();
    // Both shells start from the same world; afterwards only the visible one is kept current.
    for (const os of ['windows', 'macos']) {
      postToShell(os, worldMessage());
      postToShell(os, { type: 'world-active', version: WORLD_VERSION, active: os === state.osMode });
    }
    setShellOs(state.osMode);
    dom['ocean-status'].hidden = true;
    dom['ocean-chrome'].hidden = !state.optedIn;
    syncBrief();
    document.body.dataset.sessionState = 'profile-scene';
    document.body.dataset.auth = state.desk.auth;
    if (state.optedIn) announce(`${profile.creature} desktop ready at ${profile.depth}. This is a fictional local training simulation. ${AUTH_ANNOUNCEMENTS.locked}`);
  }

  function setStatus(message) {
    dom['ocean-status'].textContent = message;
    dom['ocean-status'].hidden = false;
  }

  function renderChrome(profile) {
    const mode = state.profileSimulationEnabled ? 'Local simulation' : `Local simulation only (mode ${state.profileExecutionMode})`;
    const detail = state.replay ? 'Detonation replay' : `${profile.creature} · ${profile.depth} · ${anchorLabel(profile)}`;
    dom['ocean-chip'].title = `${mode}. Fictional, scripted and local; no camera, real accounts or files. ${detail}.`;
    dom['ocean-chip'].setAttribute('aria-label', `Training only. ${detail}. ${mode}.`);
    dom['ocean-chip-detail'].textContent = detail;
    dom['ocean-chip-creature'].src = profile.assetUrl;
    dom['ocean-chip-creature'].hidden = state.replay;
    dom['ocean-proof-link'].hidden = !proofIsAvailable();
    dom['ocean-proof-link'].textContent = state.profileSimulationEnabled ? 'OAuth exercise' : 'Gated proof';
    dom['ocean-proof-link'].title = state.profileSimulationEnabled
      ? 'Open the separate local OAuth consent exercise.'
      : 'Open the gated OAuth worker proof. It needs its own explicit opt-ins.';
    dom['ocean-proof-link'].href = PROOF_URL;
  }

  function openGate(profile) {
    const gate = dom['ocean-gate'];
    dom['gate-title'].textContent = state.replay ? 'Enter the replay desktop' : `Enter the ${profile.creature} desktop`;
    dom['gate-summary'].textContent = state.replay
      ? 'A fictional desktop that replays what the uploaded file did in the sandbox. Nothing on it is real.'
      : `${profile.family} · ${profile.depth}. Inspired by ${anchorLabel(profile)}: ${profile.anchor.victimAction}.`;
    dom['gate-mode'].textContent = state.profileSimulationEnabled
      ? 'Runs entirely in this browser tab against the local server.'
      : `Local simulation only: this server is in ${state.profileExecutionMode} mode and no in-process session or cloud worker is used.`;
    dom['gate-opt-in'].checked = false;
    dom['gate-enter'].disabled = true;
    dom['ocean-status'].hidden = true;
    gate.hidden = false;
    dom['template-shell-host'].inert = true;
    dom['gate-opt-in'].focus({ preventScroll: true });
  }

  // The stored opt-in only skips this card. The lock screen and sign-in always come next.
  function acceptGate() {
    if (!state.profile || !dom['gate-opt-in'].checked) return;
    state.optedIn = true;
    writeOptIn(state.profile.id);
    dom['ocean-gate'].hidden = true;
    dom['template-shell-host'].inert = false;
    renderShowed();
    if (state.shellsReady) {
      dom['ocean-chrome'].hidden = false;
      dom['os-' + state.osMode].focus({ preventScroll: true });
      announce(`Entering the fictional training desktop. ${AUTH_ANNOUNCEMENTS[state.desk.auth]}`);
    } else {
      setStatus('Preparing the desktop…');
    }
  }

  const AUTH_ANNOUNCEMENTS = Object.freeze({
    locked: 'The desktop is locked. Sign in as the training user.',
    'sign-in': 'Sign in as the training user.',
    desktop: 'Signed in. The fictional desktop is ready.',
  });
  const PHASE_ANNOUNCEMENTS = Object.freeze({
    lure: 'A message needs your attention.',
    action: 'Your choice is next.',
    attack: 'The simulated attack animation is playing. Nothing real is affected.',
    safe: 'You took the safe path.',
    debrief: 'Debrief: review what happened.',
    done: 'The training scene is complete.',
  });

  // ---- the world and the shells -----------------------------------------------------------------------------

  function postToShell(os, message) {
    try { state.shellPorts.get(os)?.postMessage(message); }
    catch { /* A reloading shell reconnects and receives the next world. */ }
  }

  function worldMessage() {
    return { type: 'world', version: WORLD_VERSION, revision: state.world.revision, world: state.world };
  }

  // One push per task to the visible shell, however many changes the task made.
  function setWorld(world) {
    state.world = world;
    notifySandbox();
    renderShowed();
    if (!state.shellsReady || state.pushQueued) return;
    state.pushQueued = true;
    queueMicrotask(() => {
      state.pushQueued = false;
      postToShell(state.osMode, worldMessage());
    });
  }

  // The time stamped on scene content. A scenario with a `date` starts its clock there and runs in real time (so a 2010 lure
  // sits after the 2010 mail); other scenes use the real clock.
  function sceneNow() {
    const era = Date.parse(state.scene?.date ?? '');
    if (Number.isNaN(era)) return Date.now();
    state.eraStart ??= Date.now();
    return era + (Date.now() - state.eraStart);
  }

  // world.sandbox changes reach the attack animation (subscribeSandbox) and the debrief's receipt panel.
  function notifySandbox() {
    const signature = JSON.stringify(state.world.sandbox ?? null);
    if (signature === state.sandboxSignature) return;
    state.sandboxSignature = signature;
    const sandbox = JSON.parse(signature);
    for (const listener of [...state.sandboxListeners]) {
      try { listener(sandbox); } catch (error) { console.warn(`A sandbox listener failed: ${error?.message ?? error}`); }
    }
    if (state.desk) renderDebrief();
  }

  // Applies parent-side world intents (the windows a scene step opens) on top of a world.
  function applyWorldIntents(world, intents) {
    let next = world;
    for (const intent of intents) {
      const result = window.OceanWorldModel.applyIntent(next, intent, Date.now());
      if (result.ok && result.changed) next = result.world;
    }
    return next;
  }

  // ---- the scene state ---------------------------------------------------------------------------------------

  function adopt(result) {
    if (!result.ok || !result.changed) return false;
    adoptDesk(result.state);
    return true;
  }

  function adoptDesk(next) {
    const previous = state.desk;
    state.desk = next;
    document.body.dataset.auth = next.auth;
    document.body.dataset.scenePhase = next.scene.phase;
    if (previous.auth !== next.auth) announce(AUTH_ANNOUNCEMENTS[next.auth]);
    else if (previous.scene.phase !== next.scene.phase && PHASE_ANNOUNCEMENTS[next.scene.phase]) announce(PHASE_ANNOUNCEMENTS[next.scene.phase]);
    const projected = window.OceanSceneWorld.project(state.world, { scene: state.scene, desk: next, prevDesk: previous, now: sceneNow() });
    const world = applyWorldIntents(projected.world, projected.intents);
    if (world !== state.world) setWorld(world);
    syncIntro(previous);
    renderHint();
    renderDebrief();
    syncEffect();
    scheduleTick();
  }

  // Runs one V2 intent and acts on the effects the model leaves to the parent.
  function reduceScene(intent) {
    const result = window.OceanDesktopModel.reduce(state.desk, intent, Date.now());
    if (!result.ok) return result;
    adopt(result);
    if (result.effect === 'pick-another') window.location.assign('/ocean-profiles.html');
    else if (result.effect === 'request-proof' && proofIsAvailable()) window.location.assign(PROOF_URL);
    return result;
  }

  function scheduleTick() {
    clearTimeout(state.tickTimer);
    state.tickTimer = null;
    const { auth, scene } = state.desk;
    if (state.replay || auth !== 'desktop' || scene.deadlineMs === null) return;
    state.tickTimer = setTimeout(runTick, Math.max(0, scene.deadlineMs - Date.now()));
  }

  function runTick() {
    state.tickTimer = null;
    if (!adopt(window.OceanDesktopModel.tick(state.desk, Date.now()))) scheduleTick();
  }

  // Restart: the profile's world again (locked) and a fresh scene run.
  function restartScene() {
    if (!state.shellsReady || !state.optedIn) return;
    state.sandboxRun = 'none';
    state.world = { ...clone(state.baseWorld), revision: state.world.revision + 1 };
    adoptDesk(window.OceanDesktopModel.restart(state.desk));
    setWorld(state.world);
    announce(`Restarting the training scene. ${AUTH_ANNOUNCEMENTS.locked}`);
  }

  function renderHint() {
    const hint = state.optedIn ? window.OceanSceneWorld.hintFor(state.scene, state.desk) : null;
    dom['ocean-hint'].textContent = hint ?? '';
    dom['ocean-hint'].hidden = !hint;
  }

  // ---- the intro card (scenario scenes): shown after the one-click sign-in, reopened by the Brief button ----------

  function openIntro() {
    const intro = state.world.scene.intro ?? null;
    if (!intro || !state.optedIn) return;
    dom['intro-title'].textContent = intro.title;
    dom['intro-line'].textContent = intro.line;
    dom['intro-next'].textContent = intro.next;
    dom['ocean-intro'].hidden = false;
    dom['intro-dismiss'].focus({ preventScroll: true });
    announce(`${intro.title}. ${intro.line} ${intro.next}`);
  }

  function closeIntro() {
    if (dom['ocean-intro'].hidden) return;
    dom['ocean-intro'].hidden = true;
    dom['ocean-brief'].focus({ preventScroll: true });
  }

  function syncBrief() {
    dom['ocean-brief'].hidden = !state.world?.scene.intro;
  }

  // The card opens when the trainee signs in and closes when the desktop locks again (Restart).
  function syncIntro(previous) {
    syncBrief();
    if (state.desk.auth !== 'desktop') dom['ocean-intro'].hidden = true;
    else if (previous.auth !== 'desktop') openIntro();
  }

  // ---- the debrief window (parent-drawn, above the active shell) ------------------------------------------------

  // The sandbox receipt: what ran, where, that nothing left the sandbox and that it was torn down.
  function receiptNodes(sandbox) {
    const { receipt } = sandbox;
    const rows = [
      ['Provider', receipt.provider], ['Instance', receipt.instance], ['Mode', sandbox.mode], ['Started', receipt.startedAt],
      ['Destroyed', receipt.destroyedAt ?? 'not yet'], ['Teardown confirmed', receipt.teardownConfirmed ? 'yes' : 'no'],
      ['Network egress', receipt.egress], ['Data', receipt.dataset],
    ];
    const list = element('dl', 'ocean-receipt');
    for (const [label, value] of rows) list.append(element('dt', '', label), element('dd', '', String(value)));
    return [element('h3', '', 'Sandbox receipt'), list];
  }

  function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function debriefButton(label, intent, primary = false) {
    const button = element('button', primary ? 'ocean-button' : 'ocean-button ghost', label);
    button.type = 'button';
    button.addEventListener('click', () => reduceScene(intent));
    return button;
  }

  // Multi-stage scenes list each stage with its outcome; a safe exit is placed at the step the run stopped on.
  function journeyNodes(journey, safe) {
    const stopped = safe ? Math.max(0, journey.stages.findIndex(stage => stage.stepIds.includes(state.desk.scene.stepId))) : -1;
    const containment = journey.stages.find(stage => stage.id === 'containment');
    const list = element('ol', 'ocean-stages');
    list.setAttribute('aria-label', 'Stages of the attack');
    journey.stages.filter(stage => stage !== containment).forEach((stage, index) => {
      const outcome = safe ? (index < stopped ? 'passed' : index === stopped ? 'stopped' : 'skipped') : 'passed';
      const item = element('li', outcome);
      item.append(element('b', '', `${index + 1}. ${stage.title}`),
        element('em', '', { passed: stage.id === 'attack' ? 'Ran' : 'Passed', stopped: 'You stopped it here', skipped: 'Not reached' }[outcome]),
        element('span', '', stage.detail));
      if (stage.safeStep && outcome !== 'skipped') item.append(element('span', '', `Safe step: ${stage.safeStep}`));
      list.append(item);
    });
    const nodes = [element('h3', '', 'Stages'), list, element('p', 'ocean-fine', `Attack modelled: ${journey.attack}.`), element('p', 'ocean-fine', journey.consentNote)];
    if (containment) nodes.push(element('p', 'ocean-fine', `Containment. ${containment.detail}`));
    return nodes;
  }

  // "What the program showed" (sandbox replay, SPEC §9.1): the screenshots in world.data.screenshots, drawn above the active shell
  // like the debrief, so both desktops show them and an OS switch keeps them. Closing hides the current set; a new screenshot reopens it.
  function renderShowed() {
    const panel = dom['ocean-showed'];
    const shots = state.world?.data.screenshots ?? [];
    const ids = shots.map(item => item.id).join(',');
    const visible = state.optedIn && state.world?.phase === 'desktop' && shots.length > 0 && ids !== state.showedClosed;
    panel.hidden = !visible;
    const key = visible ? JSON.stringify(shots) : null;
    if (key === state.showedKey) return;
    state.showedKey = key;
    panel.replaceChildren();
    if (!visible) return;
    const title = element('h2', '', 'What the program showed');
    title.id = 'showed-title';
    const close = element('button', 'ocean-button ghost', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => { state.showedClosed = ids; renderShowed(); });
    panel.append(title, element('p', 'ocean-fine', 'Screenshots taken while the program ran under Wine in the sandbox.'));
    for (const shot of shots) {
      const figure = element('figure', 'ocean-shot');
      const image = element('img');
      image.src = shot.image;
      image.alt = shot.caption;
      figure.append(image, element('figcaption', '', shot.caption));
      panel.append(figure);
    }
    panel.append(close);
  }

  function renderDebrief() {
    const panel = dom['ocean-debrief'];
    const win = state.desk.windows.find(item => item.app === 'debrief');
    const visible = state.optedIn && state.desk.scene.phase === 'debrief' && win && win.mode !== 'minimized';
    const receipt = state.world.sandbox?.receipt ?? null;
    const sandboxMissing = !receipt && state.sandboxRun === 'unavailable' && state.desk.scene.path !== 'safe';
    const key = visible ? `${state.desk.runId}:${state.desk.scene.path}:${JSON.stringify(receipt)}:${sandboxMissing}` : null;
    panel.hidden = !visible;
    if (key === state.debriefKey) return;
    state.debriefKey = key;
    panel.replaceChildren();
    if (!visible) return;
    const { scene, profile } = state;
    const trench = !scene.safePath;
    const safe = state.desk.scene.path === 'safe';
    const block = safe ? scene.debrief.safe : scene.debrief.fell;
    const top = element('div', 'ocean-debrief-top');
    if (state.creatureSrc) {
      const img = element('img');
      img.src = state.creatureSrc;
      img.alt = `${profile.creature} illustration`;
      top.append(img);
    }
    const heading = element('div');
    const title = element('h2', '', block.headline);
    title.id = 'debrief-title';
    heading.append(element('span', `ocean-outcome ${safe ? 'safe' : 'fell'}`, safe ? (trench ? 'Patched' : 'Safe path') : (trench ? 'No action needed from you' : 'Attack path')), title);
    top.append(heading);
    const list = element('ul');
    for (const point of block.points) list.append(element('li', '', point));
    const body = element('div', 'ocean-debrief-body');
    body.append(top, list);
    if (scene.debrief.journey) body.append(...journeyNodes(scene.debrief.journey, safe));
    if (receipt) body.append(...receiptNodes(state.world.sandbox));
    else if (sandboxMissing) body.append(element('p', 'ocean-fine', 'Sandbox unavailable: this run did not reach a sandbox, so the attack animation was simulated.'));
    body.append(element('p', 'ocean-fine', scene.debrief.anchorNote), element('p', 'ocean-fine', `${profile.family} · ${profile.depth}: ${profile.action}.`));
    const actions = element('div', 'ocean-card-actions');
    if (!safe) actions.append(debriefButton(trench ? scene.patched.label : 'Try the safe path', { kind: 'replay', path: 'safe' }, true));
    actions.append(debriefButton('Replay', { kind: 'replay', path: 'normal' }, safe), debriefButton('Pick another creature', { kind: 'pick-another' }),
      debriefButton('Close', { kind: 'close', id: win.id }));
    if (proofIsAvailable()) actions.append(debriefButton('Open the separate OAuth consent exercise', { kind: 'request-proof' }));
    body.append(actions);
    panel.append(element('p', 'ocean-eyebrow', 'TRAINING DEBRIEF · FICTIONAL'), body);
  }

  // ---- the single attack overlay -------------------------------------------------------------------------

  // Window rects come from the world (1000x600 virtual work area), topmost first.
  function windowTargetRects() {
    const stage = dom['ocean-stage'].getBoundingClientRect();
    const { WORK } = window.OceanWorldModel;
    const { windows, order } = state.world;
    return [...order].reverse().map(id => windows.find(win => win.id === id)).filter(win => win && win.mode !== 'minimized').map(({ rect }) => ({
      x: rect.x * stage.width / WORK.w, y: rect.y * stage.height / WORK.h,
      width: rect.w * stage.width / WORK.w, height: rect.h * stage.height / WORK.h,
    }));
  }

  function clearEffect() {
    for (const unsubscribe of state.fx.unsubscribers) unsubscribe();
    state.fx.unsubscribers.clear();
    state.fx.id = null;
    state.fx.run = null;
    dom['ocean-fx-caption'].hidden = true;
  }

  function stopEffect() {
    const { run } = state.fx;
    clearEffect();
    try { run?.stop?.(); } catch { /* A broken effect must not block the scene. */ }
  }

  function finishEffect(effectId) {
    if (state.fx.id !== effectId) return;
    clearEffect();
    adopt(window.OceanDesktopModel.fxDone(state.desk, effectId, Date.now()));
  }

  // Asks the server to run this scenario in its sandbox for the page's run id. The run's events arrive over the event stream as
  // world.sandbox, so nothing here waits for them. Any failure leaves the scene intact: the animation falls back to its own
  // sequence and the debrief says the sandbox was unavailable.
  async function startSandboxRun() {
    state.sandboxRun = 'starting';
    if (state.world.sandbox) patchWorld({ sandbox: null });
    try {
      const response = await fetch(`${SANDBOX_RUN_PATH}?run=${pageRunId()}`, {
        ...FETCH_OPTIONS, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ scenarioId: state.profile.id }),
      });
      state.sandboxRun = response.status === 202 ? 'started' : 'unavailable';
    } catch {
      state.sandboxRun = 'unavailable';
    }
    renderDebrief();
  }

  // Started once per effectId. Switching OS never reaches this code, so the animation is never restarted.
  function startEffect(effectId) {
    const { attack } = state.scene;
    const rects = windowTargetRects();
    let windowTarget = 0;
    const targets = attack.targets.map(target => ({
      label: target.label, kind: target.kind,
      ...(target.kind === 'window' && rects.length ? { rect: rects[windowTarget++ % rects.length] } : {}),
    }));
    state.fx.startedIds.add(effectId);
    state.fx.id = effectId;
    if (state.scene.attackKind) startSandboxRun();
    dom['ocean-fx-caption'].textContent = attack.caption;
    dom['ocean-fx-caption'].hidden = false;
    // Scenario scenes hand the animation their attack kind and live access to world.sandbox (fx-to-engine-core.md);
    // the 30 family scenes use the original OceanFx.play. `subscribe` is the name OceanFx.playAttack reads;
    // `subscribeSandbox` and `creatureSrc` are kept for OceanFx.play and older callers.
    const playAttack = state.scene.attackKind && typeof window.OceanFx.playAttack === 'function';
    const subscribe = listener => {
      state.sandboxListeners.add(listener);
      const unsubscribe = () => { state.sandboxListeners.delete(listener); };
      state.fx.unsubscribers.add(unsubscribe);
      return unsubscribe;
    };
    try {
      state.fx.run = window.OceanFx[playAttack ? 'playAttack' : 'play']({
        attackKind: state.scene.attackKind,
        familyId: state.profile.familyId,
        depthId: state.profile.depthId,
        creatureSrc: state.creatureSrc,
        creature: { sprite: state.creatureSrc ?? state.profile.assetUrl, family: state.profile.familyId },
        container: dom['ocean-fx-layer'],
        targets,
        reducedMotion: state.reducedMotion,
        // Stays under the V2 model's 30 s attack watchdog, so the animation ends the attack, not the watchdog.
        timeoutMs: ATTACK_FX_TIMEOUT_MS,
        getSandbox: () => clone(state.world?.sandbox ?? null),
        subscribe,
        subscribeSandbox: subscribe,
        onEvent: name => { if (name === 'effect' && state.fx.id === effectId) dom['ocean-fx-caption'].textContent = attack.effect; },
        onDone: () => finishEffect(effectId),
      });
    } catch {
      setTimeout(() => finishEffect(effectId), FX_FAILURE_DONE_MS);
    }
  }

  function syncEffect() {
    const { phase, effectId } = state.desk.scene;
    if (phase !== 'attack') stopEffect();
    else if (effectId && !state.fx.startedIds.has(effectId)) startEffect(effectId);
  }

  // ---- world intents from the visible shell ------------------------------------------------------------------

  function handleWorldIntent(os, data) {
    const parsed = window.OceanWorldModel.parseIntentMessage(data);
    // Only the visible shell may speak, and only after the opt-in card.
    if (!parsed || !state.optedIn || os !== state.osMode) return;
    if (parsed.seq <= (state.lastSeq.get(os) ?? 0)) return;
    state.lastSeq.set(os, parsed.seq);
    const before = state.world;
    const result = window.OceanWorldModel.applyIntent(before, parsed.intent, Date.now());
    if (!result.ok) {
      // Re-send the accepted world so a shell that drew the refused change locally snaps back.
      postToShell(os, worldMessage());
      return;
    }
    if (result.changed) setWorld(result.world);
    const intents = window.OceanSceneWorld.sceneIntents({
      before, after: state.world, intent: parsed.intent, forward: result.forward, desk: state.desk, scene: state.scene,
    });
    for (const intent of intents) reduceScene(intent);
  }

  function handleShellMessage(os, message) {
    if (!isRecord(message) || !state.shellsReady || !state.profile || !state.shellPorts.has(os)) return;
    if (message.type === 'world-intent') handleWorldIntent(os, message);
  }

  // Bridge v3: one MessageChannel per shell. The shell answers { type:'ready', version:3, shell, apps }.
  function connectShell(os) {
    const frame = dom[`${os}-shell-frame`];
    return new Promise(resolveReady => {
      let settled = false;
      let port = null;
      let retryTimer = null;
      const finish = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(retryTimer);
        if (!ok) port?.close();
        resolveReady(ok);
      };
      const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
      const attach = () => {
        port?.close();
        const channel = new MessageChannel();
        const attached = channel.port1;
        port = attached;
        attached.onmessage = event => {
          const data = event.data;
          if (isRecord(data) && data.type === 'ready' && data.version === WORLD_VERSION && data.shell === os) {
            if (settled) return;
            state.shellPorts.set(os, attached);
            state.lastSeq.delete(os);
            finish(true);
          } else if (port === attached) {
            handleShellMessage(os, data);
          }
        };
        attached.start();
        frame.contentWindow.postMessage({ type: 'ocean-shell-attach', version: WORLD_VERSION }, '*', [channel.port2]);
        retryTimer = setTimeout(() => { if (!settled) attach(); }, ATTACH_RETRY_MS);
      };
      frame.addEventListener('error', () => finish(false), { once: true });
      frame.addEventListener('load', () => { if (!settled) attach(); }, { once: true });
      frame.src = `${state.shellOrigin}${SHELL_PATHS[os]}`;
    });
  }

  // ---- OS swap: visual only; the world, the scene and the attack keep running ---------------------------------

  function setShellOs(os) {
    state.osMode = os;
    document.body.dataset.os = os;
    for (const name of ['windows', 'macos']) {
      const frame = dom[`${name}-shell-frame`];
      frame.dataset.active = String(name === os);
      frame.inert = name !== os;
      dom[`os-${name}`].setAttribute('aria-pressed', String(name === os));
    }
  }

  function requestOs(os) {
    const from = state.osMode;
    if (!state.shellsReady || os === from) return;
    postToShell(os, worldMessage());
    postToShell(os, { type: 'world-active', version: WORLD_VERSION, active: true });
    postToShell(from, { type: 'world-active', version: WORLD_VERSION, active: false });
    setShellOs(os);
    dom['os-' + os].focus({ preventScroll: true });
    announce(`Switched to ${os === 'windows' ? 'Windows' : 'macOS'}. The desktop and scene are unchanged.`);
  }

  // ---- runtime configuration (backend-served worlds, later a Vultr event stream) --------------------------------

  // Replaces the whole world but keeps the session's phase; scene content for the reached steps is re-applied.
  function replaceWorld(next) {
    if (!state.world) return { ok: false, error: 'not-ready' };
    const check = window.OceanWorldModel.validate(next);
    if (!check.ok) return { ok: false, error: check.error };
    state.baseWorld = clone(next);
    const draft = { ...clone(next), phase: state.world.phase, revision: Math.max(state.world.revision, next.revision) };
    const projected = window.OceanSceneWorld.project(draft, { scene: state.scene, desk: state.desk, now: sceneNow(), openWindows: false }).world;
    const result = window.OceanWorldModel.validate(projected);
    if (!result.ok) return { ok: false, error: result.error };
    const revision = Math.max(projected.revision, state.world.revision + 1);
    setWorld({ ...projected, revision });
    return { ok: true, revision };
  }

  // Deep-merges a profile-style patch (objects merge, arrays replace, null removes) into the live world.
  function patchWorld(patch) {
    if (!state.world) return { ok: false, error: 'not-ready' };
    let merged;
    try {
      merged = window.OceanWorldModel.createWorld(state.world, patch);
    } catch (error) {
      return { ok: false, error: String(error.message).replace(/^Invalid world: /, '') };
    }
    setWorld({ ...merged, revision: state.world.revision + 1 });
    return { ok: true, revision: state.world.revision };
  }

  // Live world events from the backend (GET /api/desktop/events, Server-Sent Events) for the page's ?run= (default
  // `local`). Each event goes through patchWorld / replaceWorld; a refused one is logged and never applied.
  const STREAM_REOPEN_MS = 5000;
  // `?run=<id>`, or `?job=<jobId>` from a detonation job page (the replay publishes to run=<jobId>).
  function pageRunId() {
    const params = new URLSearchParams(window.location.search);
    return [params.get('run'), params.get('job')].find(value => /^[a-z0-9-]{1,40}$/.test(value ?? '')) ?? 'local';
  }

  function subscribeWorldEvents() {
    if (typeof window.EventSource !== 'function') return;
    const runId = pageRunId();
    let lastId = '';
    const open = () => {
      const source = new window.EventSource(`/api/desktop/events?run=${runId}${lastId ? `&last=${encodeURIComponent(lastId)}` : ''}`);
      source.onopen = () => { document.body.dataset.worldStream = 'open'; };
      source.onmessage = event => {
        lastId = event.lastEventId || lastId;
        let message = null;
        try { message = JSON.parse(event.data); } catch { /* Refused below. */ }
        const result = message?.type === 'patch' && isRecord(message.patch) ? patchWorld(message.patch)
          : message?.type === 'replace' && isRecord(message.world) ? replaceWorld(message.world)
            : { ok: false, error: 'unknown-event' };
        if (!result.ok) console.warn(`Desktop world event ${event.lastEventId || '?'} refused: ${result.error}`);
      };
      // The browser retries a dropped stream by itself; a refused one (CLOSED) is reopened here, resuming after lastId.
      source.onerror = () => {
        document.body.dataset.worldStream = 'reconnecting';
        if (source.readyState === window.EventSource.CLOSED) setTimeout(open, STREAM_REOPEN_MS);
      };
    };
    open();
  }

  window.OceanDesktop = Object.freeze({
    replaceWorld,
    patchWorld,
    getWorld: () => (state.world ? clone(state.world) : null),
    getScene: () => (state.desk ? clone(state.desk) : null),
  });

  dom['os-windows'].addEventListener('click', () => requestOs('windows'));
  dom['os-macos'].addEventListener('click', () => requestOs('macos'));
  dom['ocean-restart'].addEventListener('click', restartScene);
  dom['ocean-brief'].addEventListener('click', () => { if (dom['ocean-intro'].hidden) openIntro(); else closeIntro(); });
  dom['intro-dismiss'].addEventListener('click', closeIntro);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || dom['ocean-intro'].hidden) return;
    event.preventDefault();
    closeIntro();
  });
  dom['gate-opt-in'].addEventListener('change', () => { dom['gate-enter'].disabled = !dom['gate-opt-in'].checked; });
  dom['gate-enter'].addEventListener('click', acceptGate);

  // A replay link carries only ?job=<jobId>: it plays the neutral replay profile, and the job's events fill its world.
  const query = new URLSearchParams(window.location.search);
  const requestedProfile = query.get('profile') ?? (query.has('job') ? REPLAY_PROFILE : null);
  if (/^[a-z0-9-]{3,64}$/.test(requestedProfile ?? '')) loadProfile(requestedProfile);
  else window.location.replace('/ocean-profiles.html');
})();

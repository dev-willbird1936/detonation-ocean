// Parent-owned desktop state machine (CONTRACT-V2). DOM-free: no timers, no clock, no randomness except
// the injectable run id factory. Scene progression is driven by the OceanScenes data for the profile.
//   createState(profile, scene, options) -> DesktopState
//   reduce(state, intent, now)           -> { ok, changed, state, reason, effect }
//   tick(state, now)                     -> { ok, changed, state }   (fires the due deadline, if any)
//   fxDone(state, effectId, now)         -> { ok, changed, state }   (the attack animation finished)
//   parseIntent / parseIntentMessage / validate / snapshot / restart
// A state is bound to its scene by runId (a small registry), so every function takes only plain JSON.
(() => {
  'use strict';

  const STATE_MAX_BYTES = 4096;
  const WORK = Object.freeze({ w: 1000, h: 600 });
  const MIN_SIZE = Object.freeze({ w: 240, h: 160 });
  const AUTH = Object.freeze(['locked', 'sign-in', 'desktop']);
  const PHASES = Object.freeze(['boot', 'lure', 'action', 'attack', 'debrief', 'safe', 'done']);
  const PATHS = Object.freeze([null, 'fell', 'safe']);
  const REPLAY_MODES = Object.freeze(['normal', 'guided-safe', 'patched']);
  const WINDOW_APPS = Object.freeze(['mail', 'browser', 'files', 'mfa', 'updates', 'debrief', 'notification-centre']);
  const WINDOW_MODES = Object.freeze(['normal', 'minimized', 'expanded']);
  const CHOICE_IDS = Object.freeze([
    'open', 'follow-link', 'download', 'sign-in', 'verify', 'approve', 'allow', 'run-file',
    'delete', 'report', 'close-tab', 'not-now', 'cancel', 'deny', 'check-updates',
    'continue', 'open-ledger', 'release', 'call-known', 'second-approver',
  ]);
  const ID_RE = /^[a-z0-9-]{1,24}$/;
  const RUN_ID_RE = /^[a-z0-9-]{8,32}$/;
  const STEP_ID_RE = /^[a-z0-9-]{1,40}$/;
  const MAX_WINDOWS = 8;
  const MAX_NOTIFICATIONS = 4;
  const MAX_RUNS = 16;
  const MAX_COUNTER = 2 ** 31;
  const ATTACK_WATCHDOG_MS = 30000;

  const DEFAULT_BOUNDS = Object.freeze({
    mail: { x: 90, y: 50, w: 780, h: 480 },
    browser: { x: 130, y: 60, w: 760, h: 470 },
    files: { x: 110, y: 70, w: 740, h: 440 },
    mfa: { x: 300, y: 150, w: 400, h: 300 },
    updates: { x: 150, y: 80, w: 700, h: 420 },
    debrief: { x: 150, y: 40, w: 700, h: 520 },
    'notification-centre': { x: 640, y: 30, w: 340, h: 520 },
  });
  // Delays the old bridge applied after a button press ("Signing in…"); 80 ms when reduced motion is on.
  const FORWARD_DELAY_MS = Object.freeze({
    'follow-link': 350, download: 500, 'sign-in': 600, verify: 600, allow: 600, approve: 450, 'run-file': 1100,
    continue: 300, 'open-ledger': 350, release: 700,
  });
  const TIMING = Object.freeze({
    normal: { boot: 900, event: 2800, safe: 1500, run: 1100 },
    reduced: { boot: 300, event: 1200, safe: 500, run: 120 },
  });

  const runs = new Map();
  let runCounter = 0;

  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasExactKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const isCounter = value => Number.isInteger(value) && value >= 0 && value <= MAX_COUNTER;
  const isFiniteTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;

  function defaultRunId() {
    runCounter += 1;
    const random = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
    return `r${Date.now().toString(36)}${random}${runCounter.toString(36)}`.slice(0, 32);
  }

  // ---- intents -----------------------------------------------------------------------------------------

  const SIMPLE_INTENTS = Object.freeze(['show-sign-in', 'sign-in', 'toggle-centre', 'pick-another', 'request-proof']);
  const WINDOW_ID_INTENTS = Object.freeze(['focus-window', 'minimize', 'restore', 'expand', 'close']);

  function parseBounds(value) {
    if (!hasExactKeys(value, ['x', 'y', 'w', 'h']) || !Object.values(value).every(number => typeof number === 'number' && Number.isFinite(number))) return null;
    return { x: value.x, y: value.y, w: value.w, h: value.h };
  }

  // Strict, exact-key intent shapes. Returns a fresh normalised intent or null.
  function parseIntent(value) {
    if (!isRecord(value) || typeof value.kind !== 'string') return null;
    const { kind } = value;
    const only = extra => hasExactKeys(value, ['kind', ...extra]);
    if (SIMPLE_INTENTS.includes(kind)) return only([]) ? { kind } : null;
    if (WINDOW_ID_INTENTS.includes(kind) || kind === 'dismiss-notification') {
      return only(['id']) && typeof value.id === 'string' && ID_RE.test(value.id) ? { kind, id: value.id } : null;
    }
    if (kind === 'open-app') {
      return only(['app']) && WINDOW_APPS.includes(value.app) && value.app !== 'notification-centre' ? { kind, app: value.app } : null;
    }
    if (kind === 'move-window' || kind === 'resize-window') {
      const bounds = only(['id', 'bounds']) ? parseBounds(value.bounds) : null;
      return bounds && typeof value.id === 'string' && ID_RE.test(value.id) ? { kind, id: value.id, bounds } : null;
    }
    if (kind === 'select-entry') {
      return only(['id', 'entryId']) && [value.id, value.entryId].every(text => typeof text === 'string' && ID_RE.test(text))
        ? { kind, id: value.id, entryId: value.entryId } : null;
    }
    if (kind === 'choose') return only(['choiceId']) && CHOICE_IDS.includes(value.choiceId) ? { kind, choiceId: value.choiceId } : null;
    if (kind === 'replay') return only(['path']) && ['normal', 'safe'].includes(value.path) ? { kind, path: value.path } : null;
    return null;
  }

  // The frame -> parent envelope: { type:'desktop-intent', version:2, runId, seq, revision, intent }.
  function parseIntentMessage(message) {
    if (!hasExactKeys(message, ['type', 'version', 'runId', 'seq', 'revision', 'intent']) ||
        message.type !== 'desktop-intent' || message.version !== 2 ||
        typeof message.runId !== 'string' || !RUN_ID_RE.test(message.runId) ||
        !isCounter(message.seq) || !isCounter(message.revision)) return null;
    const intent = parseIntent(message.intent);
    return intent ? { runId: message.runId, seq: message.seq, revision: message.revision, intent } : null;
  }

  // ---- state shape --------------------------------------------------------------------------------------

  function validateBounds(bounds) {
    return hasExactKeys(bounds, ['x', 'y', 'w', 'h']) && Object.values(bounds).every(Number.isInteger) &&
      bounds.w >= MIN_SIZE.w && bounds.w <= WORK.w && bounds.h >= MIN_SIZE.h && bounds.h <= WORK.h &&
      bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.w <= WORK.w && bounds.y + bounds.h <= WORK.h;
  }

  function nullable(value, test) { return value === null || test(value); }

  function stateProblem(state) {
    if (!hasExactKeys(state, ['v', 'runId', 'revision', 'auth', 'scene', 'windows', 'order', 'focusedWindowId', 'notifications', 'centreOpen'])) return 'keys';
    if (state.v !== 2) return 'version';
    if (typeof state.runId !== 'string' || !RUN_ID_RE.test(state.runId)) return 'runId';
    if (!isCounter(state.revision)) return 'revision';
    if (!AUTH.includes(state.auth)) return 'auth';
    const scene = state.scene;
    if (!hasExactKeys(scene, ['phase', 'stepId', 'path', 'replayMode', 'pendingActionId', 'deadlineMs', 'effectId', 'completedAt']) ||
        !PHASES.includes(scene.phase) || !PATHS.includes(scene.path) || !REPLAY_MODES.includes(scene.replayMode) ||
        !nullable(scene.stepId, id => typeof id === 'string' && STEP_ID_RE.test(id)) ||
        !nullable(scene.pendingActionId, id => CHOICE_IDS.includes(id)) ||
        !nullable(scene.deadlineMs, isFiniteTime) || !nullable(scene.completedAt, isFiniteTime) ||
        !nullable(scene.effectId, id => typeof id === 'string' && STEP_ID_RE.test(id))) return 'scene';
    if (!Array.isArray(state.windows) || state.windows.length > MAX_WINDOWS) return 'windows';
    const ids = [];
    for (const win of state.windows) {
      if (!hasExactKeys(win, ['id', 'app', 'contentStepId', 'mode', 'bounds', 'folderId', 'selectedEntryId', 'tabId']) ||
          typeof win.id !== 'string' || !ID_RE.test(win.id) || ids.includes(win.id) ||
          !WINDOW_APPS.includes(win.app) || typeof win.contentStepId !== 'string' || !STEP_ID_RE.test(win.contentStepId) ||
          !WINDOW_MODES.includes(win.mode) || !validateBounds(win.bounds) ||
          ![win.folderId, win.selectedEntryId, win.tabId].every(id => nullable(id, text => typeof text === 'string' && ID_RE.test(text)))) return 'window';
      ids.push(win.id);
    }
    if (!Array.isArray(state.order) || state.order.length !== ids.length || new Set(state.order).size !== ids.length ||
        !state.order.every(id => ids.includes(id))) return 'order';
    if (!nullable(state.focusedWindowId, id => ids.includes(id))) return 'focus';
    if (!Array.isArray(state.notifications) || state.notifications.length > MAX_NOTIFICATIONS ||
        !state.notifications.every(item => hasExactKeys(item, ['id', 'appId', 'stepId']) && ID_RE.test(item.id) &&
          WINDOW_APPS.includes(item.appId) && STEP_ID_RE.test(item.stepId))) return 'notifications';
    if (typeof state.centreOpen !== 'boolean') return 'centre';
    return byteSize(state) <= STATE_MAX_BYTES ? null : 'size';
  }

  function validate(state) {
    const problem = stateProblem(state);
    return problem ? { ok: false, error: problem } : { ok: true, error: null };
  }

  function snapshot(state) {
    const problem = stateProblem(state);
    if (problem) throw new TypeError(`Invalid desktop state: ${problem}`);
    return clone(state);
  }

  // ---- scene helpers ------------------------------------------------------------------------------------

  const timing = ctx => (ctx.reducedMotion ? TIMING.reduced : TIMING.normal);
  const stepsOf = ctx => ctx.scene.steps;
  const stepIndexOf = (ctx, stepId) => stepsOf(ctx).findIndex(step => step.id === stepId);
  const currentStep = (ctx, state) => stepsOf(ctx)[stepIndexOf(ctx, state.scene.stepId)] ?? null;
  // The auto event step shows the task window's content, revealed.
  const contentStepOf = (ctx, step) => (step.kind === 'auto' ? stepsOf(ctx).find(item => item.id === 'task') : step);
  const windowId = app => `w-${app}`;
  const findWindow = (state, id) => state.windows.find(win => win.id === id) ?? null;
  const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'folder';
  const isLive = state => state.auth === 'desktop' && ['lure', 'action'].includes(state.scene.phase);
  const isFinished = state => state.auth === 'desktop' && ['debrief', 'done'].includes(state.scene.phase);

  function entryIds(ctx, win) {
    const step = stepsOf(ctx).find(item => item.id === win.contentStepId);
    const files = step && win.app === 'files' ? contentStepOf(ctx, step).files : null;
    return files ? [...(files.target ? ['target'] : []), ...files.items.map((item, index) => `item-${index}`)] : [];
  }

  // What each step offers. `forward` moves the journey on (and ends in the attack); `safe` is the walk-away path.
  // A step may declare its own `choices` ({ forward, safe, noop }); the rest derive them from the step's app and page type.
  function choicesFor(step) {
    if (step.choices) return { forward: [...step.choices.forward], safe: [...step.choices.safe], noop: [...step.choices.noop] };
    if (step.id === 'toast') return { forward: ['open'], safe: [], noop: [] };
    if (step.app === 'mail') {
      return { forward: [...(step.mail.link ? ['follow-link'] : []), ...(step.mail.attachment ? ['download'] : [])], safe: ['delete', 'report'], noop: [] };
    }
    if (step.app === 'browser') {
      const type = step.page.type;
      if (type === 'download') return { forward: ['download'], safe: ['report', 'close-tab'], noop: [] };
      if (type === 'signin') return { forward: ['sign-in'], safe: ['not-now', 'report', 'close-tab'], noop: [] };
      if (type === 'code') return { forward: ['verify'], safe: ['cancel', 'report', 'close-tab'], noop: [] };
      return { forward: ['allow'], safe: ['deny', 'report', 'close-tab'], noop: [] };
    }
    if (step.app === 'mfa') return { forward: ['approve'], safe: ['deny'], noop: [] };
    if (step.app === 'files' && step.kind === 'victim') return { forward: ['run-file'], safe: ['delete'], noop: [] };
    if (step.app === 'updates' && step.kind === 'benign') return { forward: [], safe: [], noop: ['check-updates'] };
    return { forward: [], safe: [], noop: [] };
  }

  // ---- draft mutations (always on a private clone) --------------------------------------------------------

  function raise(state, id) {
    state.order = [...state.order.filter(item => item !== id), id];
    state.focusedWindowId = id;
  }

  function refocus(state) {
    const top = [...state.order].reverse().find(id => findWindow(state, id)?.mode !== 'minimized');
    state.focusedWindowId = top ?? null;
  }

  function removeWindow(state, id) {
    state.windows = state.windows.filter(win => win.id !== id);
    state.order = state.order.filter(item => item !== id);
    if (state.focusedWindowId === id) refocus(state);
  }

  // One window per app. Bounds persist; a new step swaps the content and re-raises the window.
  function showContent(ctx, state, app, step) {
    const id = windowId(app);
    const content = contentStepOf(ctx, step) ?? step;
    const existing = findWindow(state, id);
    const files = content.files;
    const fresh = {
      folderId: files ? slug(files.folder) : null,
      selectedEntryId: files?.target ? 'target' : null,
      tabId: app === 'browser' ? 'tab-1' : null,
    };
    if (existing) {
      existing.contentStepId = step.id;
      existing.mode = 'normal';
      if (step.kind !== 'auto') Object.assign(existing, fresh);
    } else {
      state.windows.push({ id, app, contentStepId: step.id, mode: 'normal', bounds: { ...DEFAULT_BOUNDS[app] }, ...fresh });
    }
    raise(state, id);
  }

  function enterStep(ctx, state, index, now) {
    const step = stepsOf(ctx)[index];
    const scene = state.scene;
    scene.stepId = step.id;
    scene.phase = step.phase;
    scene.pendingActionId = null;
    scene.deadlineMs = null;
    state.centreOpen = false;
    if (step.app === 'toast') {
      const appId = { Mail: 'mail', Browser: 'browser' }[step.toast.app] ?? 'debrief';
      state.notifications = [{ id: 'n-toast', appId, stepId: step.id }];
    } else {
      state.notifications = [];
      showContent(ctx, state, step.app, step);
    }
    if (step.kind === 'benign') scene.deadlineMs = now + step.autoMs;
    else if (step.kind === 'auto') scene.deadlineMs = now + timing(ctx).event;
  }

  function startAttack(ctx, state, now) {
    const scene = state.scene;
    scene.path = 'fell';
    scene.phase = 'attack';
    scene.effectId = `fx-${state.runId}`;
    scene.pendingActionId = null;
    scene.deadlineMs = now + ATTACK_WATCHDOG_MS;
    state.notifications = [];
    state.centreOpen = false;
  }

  function goSafe(ctx, state, now) {
    const scene = state.scene;
    scene.path = 'safe';
    scene.phase = 'safe';
    scene.pendingActionId = null;
    scene.deadlineMs = now + timing(ctx).safe;
    state.notifications = [];
    state.centreOpen = false;
  }

  function enterDebrief(ctx, state, now) {
    const scene = state.scene;
    scene.phase = 'debrief';
    scene.pendingActionId = null;
    scene.deadlineMs = null;
    scene.completedAt = now;
    state.notifications = [];
    state.centreOpen = false;
    showDebriefWindow(state);
  }

  function showDebriefWindow(state) {
    const id = windowId('debrief');
    const existing = findWindow(state, id);
    if (existing) existing.mode = 'normal';
    else state.windows.push({ id, app: 'debrief', contentStepId: 'debrief', mode: 'normal', bounds: { ...DEFAULT_BOUNDS.debrief }, folderId: null, selectedEntryId: null, tabId: null });
    raise(state, id);
  }

  function proceed(ctx, state, now) {
    const next = stepIndexOf(ctx, state.scene.stepId) + 1;
    if (next < stepsOf(ctx).length) enterStep(ctx, state, next, now);
    else startAttack(ctx, state, now);
  }

  function beginBoot(ctx, state, now) {
    state.scene.deadlineMs = now + timing(ctx).boot;
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------

  function baseState(runId, auth, replayMode) {
    return {
      v: 2, runId, revision: 0, auth,
      scene: { phase: 'boot', stepId: null, path: null, replayMode, pendingActionId: null, deadlineMs: null, effectId: null, completedAt: null },
      windows: [], order: [], focusedWindowId: null, notifications: [], centreOpen: false,
    };
  }

  function register(runId, ctx) {
    runs.set(runId, ctx);
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  }

  // A locked desktop: nothing is scheduled until the sign-in intent commits auth:'desktop'.
  function createState(profile, scene, { runId, runIdFactory = defaultRunId, reducedMotion = false, replayMode = 'normal' } = {}) {
    if (!isRecord(profile) || !isRecord(scene) || !Array.isArray(scene.steps) || scene.steps.length === 0 ||
        !REPLAY_MODES.includes(replayMode)) throw new TypeError('createState needs a profile and a scene with steps.');
    const id = runId ?? runIdFactory();
    if (typeof id !== 'string' || !RUN_ID_RE.test(id)) throw new TypeError('The run id must be 8-32 characters of a-z, 0-9 or -.');
    register(id, { profile, scene, reducedMotion: reducedMotion === true, runIdFactory });
    return baseState(id, 'locked', replayMode);
  }

  // Parent Restart: a fresh run id, locked again.
  function restart(state) {
    const ctx = runs.get(state.runId);
    if (!ctx) throw new TypeError('Unknown run.');
    return createState(ctx.profile, ctx.scene, { runIdFactory: ctx.runIdFactory, reducedMotion: ctx.reducedMotion });
  }

  // Debrief Replay keeps the signed-in desktop and starts a new run (so stale intents of the old run are dropped).
  function replayRun(ctx, path, now) {
    const replayMode = path === 'safe' ? (ctx.scene.safePath ? 'guided-safe' : 'patched') : 'normal';
    const runId = ctx.runIdFactory();
    if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new TypeError('The run id must be 8-32 characters of a-z, 0-9 or -.');
    register(runId, ctx);
    const next = baseState(runId, 'desktop', replayMode);
    beginBoot(ctx, next, now);
    return next;
  }

  const reject = (state, reason) => ({ ok: false, changed: false, state, reason, effect: null });
  const noop = state => ({ ok: true, changed: false, state, reason: null, effect: null });
  const accept = (state, effect = null) => ({ ok: true, changed: true, state, reason: null, effect });

  function finish(previous, draft, effect = null) {
    draft.revision = previous.revision + 1;
    return accept(draft, effect);
  }

  // The run's scene context, or the rejection reason as a string.
  function runContext(state, now) {
    if (!isFiniteTime(now)) return 'invalid-time';
    if (!isRecord(state) || stateProblem(state)) return 'invalid-state';
    return runs.get(state.runId) ?? 'unknown-run';
  }

  function reduceWindowIntent(ctx, draft, intent, now) {
    const win = findWindow(draft, intent.id);
    if (!win) return 'no-such-window';
    const pendingHere = draft.scene.pendingActionId !== null && currentStep(ctx, draft)?.id === win.contentStepId;
    switch (intent.kind) {
      case 'focus-window':
        if (win.mode === 'minimized') return 'minimized';
        raise(draft, win.id);
        return null;
      case 'move-window':
      case 'resize-window': {
        if (win.mode !== 'normal') return 'not-normal';
        const wanted = intent.kind === 'move-window' ? { ...intent.bounds, w: win.bounds.w, h: win.bounds.h } : intent.bounds;
        const w = clamp(Math.round(wanted.w), MIN_SIZE.w, WORK.w);
        const h = clamp(Math.round(wanted.h), MIN_SIZE.h, WORK.h);
        const bounds = { x: clamp(Math.round(wanted.x), 0, WORK.w - w), y: clamp(Math.round(wanted.y), 0, WORK.h - h), w, h };
        if (JSON.stringify(bounds) === JSON.stringify(win.bounds)) return 'unchanged';
        win.bounds = bounds;
        return null;
      }
      case 'minimize':
        if (win.mode === 'minimized') return 'unchanged';
        win.mode = 'minimized';
        if (draft.focusedWindowId === win.id) refocus(draft);
        return null;
      case 'restore':
        if (win.mode === 'normal') return 'unchanged';
        win.mode = 'normal';
        raise(draft, win.id);
        return null;
      case 'expand':
        if (win.mode === 'expanded') return 'unchanged';
        win.mode = 'expanded';
        raise(draft, win.id);
        return null;
      case 'close': {
        if (pendingHere) return 'busy';
        if (win.app === 'debrief') {
          removeWindow(draft, win.id);
          draft.scene.phase = 'done';
        } else if (isLive(draft) && ctx.scene.safePath && currentStep(ctx, draft)?.id === win.contentStepId) {
          removeWindow(draft, win.id);
          goSafe(ctx, draft, now);
        } else {
          removeWindow(draft, win.id);
        }
        return null;
      }
      case 'select-entry':
        if (!entryIds(ctx, win).includes(intent.entryId)) return 'no-such-entry';
        if (win.selectedEntryId === intent.entryId) return 'unchanged';
        win.selectedEntryId = intent.entryId;
        return null;
      default:
        return 'unsupported';
    }
  }

  function reduceChoice(ctx, draft, choiceId, now) {
    if (draft.scene.pendingActionId !== null) return 'busy';
    const step = currentStep(ctx, draft);
    if (!step) return 'no-step';
    const choices = choicesFor(step);
    if (choices.noop.includes(choiceId)) return 'unchanged';
    const forward = choices.forward.includes(choiceId);
    const safe = choices.safe.includes(choiceId);
    if (!forward && !safe) return 'wrong-step';
    const win = step.app === 'toast' ? null : findWindow(draft, windowId(step.app));
    if (step.app !== 'toast' && win?.contentStepId !== step.id) return 'not-shown';
    if (safe) {
      if (!ctx.scene.safePath) return 'no-safe-path';
      goSafe(ctx, draft, now);
      return null;
    }
    if (choiceId === 'run-file' && win.selectedEntryId !== 'target') return 'wrong-entry';
    const delay = choiceId === 'open' ? 0 : choiceId === 'run-file' ? timing(ctx).run : ctx.reducedMotion ? 80 : FORWARD_DELAY_MS[choiceId];
    if (delay === 0) proceed(ctx, draft, now);
    else {
      draft.scene.pendingActionId = choiceId;
      draft.scene.deadlineMs = now + delay;
    }
    return null;
  }

  function reduceOpenApp(ctx, draft, app) {
    const existing = findWindow(draft, windowId(app));
    if (existing) {
      existing.mode = existing.mode === 'minimized' ? 'normal' : existing.mode;
      raise(draft, existing.id);
      return null;
    }
    if (app === 'debrief') {
      if (!isFinished(draft)) return 'no-such-app';
      draft.scene.phase = 'debrief';
      showDebriefWindow(draft);
      return null;
    }
    const reached = stepsOf(ctx).slice(0, stepIndexOf(ctx, draft.scene.stepId) + 1).filter(step => step.app === app);
    if (reached.length === 0) return 'no-such-app';
    showContent(ctx, draft, app, reached[reached.length - 1]);
    return null;
  }

  // Applies one intent. Rejections never change the state. `effect` asks the parent to act outside the model.
  function reduce(state, rawIntent, now) {
    const ctx = runContext(state, now);
    if (typeof ctx === 'string') return reject(state, ctx);
    const intent = parseIntent(rawIntent);
    if (!intent) return reject(state, 'invalid-intent');
    const { kind } = intent;
    const draft = clone(state);

    if (state.auth === 'locked') {
      if (kind !== 'show-sign-in') return reject(state, 'locked');
      draft.auth = 'sign-in';
      return finish(state, draft);
    }
    if (state.auth === 'sign-in') {
      if (kind !== 'sign-in') return reject(state, 'sign-in-required');
      draft.auth = 'desktop';
      beginBoot(ctx, draft, now);
      return finish(state, draft);
    }
    if (kind === 'show-sign-in' || kind === 'sign-in') return reject(state, 'already-signed-in');
    const { phase } = state.scene;
    if (['boot', 'attack', 'safe'].includes(phase)) return reject(state, 'inert');

    let problem = null;
    if (kind === 'replay' || kind === 'pick-another' || kind === 'request-proof') {
      if (!isFinished(state)) return reject(state, 'not-finished');
      if (kind === 'replay') return accept(replayRun(ctx, intent.path, now), 'new-run');
      if (kind === 'request-proof' && ctx.profile.id !== 'deception-abyss') return reject(state, 'no-proof');
      return { ...noop(state), effect: kind };
    } else if (kind === 'choose' || kind === 'dismiss-notification') {
      if (!isLive(state)) return reject(state, 'not-live');
      if (kind === 'choose') problem = reduceChoice(ctx, draft, intent.choiceId, now);
      else if (state.scene.pendingActionId !== null) problem = 'busy';
      else if (!draft.notifications.some(item => item.id === intent.id) || currentStep(ctx, draft)?.id !== 'toast') problem = 'no-such-notification';
      else if (currentStep(ctx, draft).dismissPassive) proceed(ctx, draft, now);
      else if (ctx.scene.safePath) goSafe(ctx, draft, now);
      else problem = 'no-safe-path';
    } else if (kind === 'toggle-centre') {
      draft.centreOpen = !draft.centreOpen;
    } else if (kind === 'open-app') {
      problem = reduceOpenApp(ctx, draft, intent.app);
    } else {
      problem = reduceWindowIntent(ctx, draft, intent, now);
    }
    if (problem === 'unchanged') return noop(state);
    if (problem) return reject(state, problem);
    return finish(state, draft);
  }

  // Fires the due deadline, one transition per call. The clock is injected: `now` in ms.
  function tick(state, now) {
    const ctx = runContext(state, now);
    if (typeof ctx === 'string') return reject(state, ctx);
    const { scene } = state;
    if (state.auth !== 'desktop' || scene.deadlineMs === null || now < scene.deadlineMs) return noop(state);
    const draft = clone(state);
    if (scene.phase === 'boot') enterStep(ctx, draft, 0, now);
    else if (scene.phase === 'safe' || scene.phase === 'attack') enterDebrief(ctx, draft, now);
    else if (scene.pendingActionId !== null) proceed(ctx, draft, now);
    else {
      const step = currentStep(ctx, state);
      if (step?.kind === 'benign') enterStep(ctx, draft, stepIndexOf(ctx, step.id) + 1, now);
      else if (step?.kind === 'auto') (scene.replayMode === 'patched' ? goSafe : startAttack)(ctx, draft, now);
      else return noop(state);
    }
    return finish(state, draft);
  }

  // The attack animation reported done (once per effectId): move to the debrief.
  function fxDone(state, effectId, now) {
    const ctx = runContext(state, now);
    if (typeof ctx === 'string') return reject(state, ctx);
    if (state.scene.phase !== 'attack' || state.scene.effectId !== effectId) return noop(state);
    const draft = clone(state);
    enterDebrief(ctx, draft, now);
    return finish(state, draft);
  }

  const api = Object.freeze({
    STATE_MAX_BYTES, WORK, CHOICE_IDS, WINDOW_APPS, ATTACK_WATCHDOG_MS,
    createState, restart, reduce, tick, fxDone, validate, snapshot, parseIntent, parseIntentMessage, choicesFor,
  });
  if (typeof window !== 'undefined') window.OceanDesktopModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

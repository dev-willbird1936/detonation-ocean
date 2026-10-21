// Scene → world projection (WORLD-CONTRACT v3 §1 `scene`, CONTRACT-V2 scene machine). DOM-free: no timers, no
// randomness; the clock is injected.
//   project(world, { scene, desk, prevDesk, now, openWindows }) -> { world, intents }
//       Writes the scene content reached by the V2 state into the world (lure mail, pages, files, MFA prompts,
//       updates, processes, banners) and mirrors world.scene {phase, stepId, highlight}; for a scenario scene (introCard,
//       focusApps or creature set) it also mirrors focusApps, intro and the derived creature state. Content is added once, when
//       its step is reached, so trainee edits (read, moved to Junk) persist. A new run id strips every `sc-` item
//       first. `intents` are world open-app intents for the step that was just entered (the V2 window of that step).
//   sceneIntents({ before, after, intent, forward, desk, scene }) -> [V2 intent]
//       Maps one applied world intent back to CONTRACT-V2 intents (sign-in, choose, dismiss-notification).
//   strip(world) -> world without scene items.   hintFor(scene, desk) -> string | null
// Every scene-owned id starts with `sc-`, so the projection never touches seed or profile data.
(() => {
  'use strict';

  const PREFIX = 'sc-';
  const LIVE = ['lure', 'action'];
  const FIXED_BY_NAME = Object.freeze({ downloads: 'downloads', desktop: 'desktop', documents: 'documents', pictures: 'pictures', music: 'music' });
  const TOAST_APPS = Object.freeze({ Mail: 'mail', Browser: 'browser' });
  const CHOICE_LABELS = Object.freeze({
    open: 'Open', 'follow-link': 'Open link', download: 'Download', 'sign-in': 'Sign in', verify: 'Verify', approve: 'Approve',
    allow: 'Allow', 'run-file': 'Open file', delete: 'Delete', report: 'Report', 'close-tab': 'Close tab', 'not-now': 'Not now',
    cancel: 'Cancel', deny: 'Deny', 'check-updates': 'Check for updates', continue: 'Continue', 'open-ledger': 'Open ledger',
    release: 'Release payment', 'call-known': 'Verify with a known number', 'second-approver': 'Ask the second approver',
  });
  // Page buttons only: deleting a message is a mail gesture, not a page choice.
  const PAGE_EXCLUDED = new Set(['delete']);

  const clone = value => JSON.parse(JSON.stringify(value));
  const own = id => typeof id === 'string' && id.startsWith(PREFIX);
  const isoAt = now => new Date(Math.floor(now / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const line = (text, max) => String(text ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
  const hostOf = url => String(url).replace(/^https?:\/\//, '').split('/')[0];
  const pageId = step => `${PREFIX}${step.id}`;
  const messageId = step => (step.id === 'mail' ? `${PREFIX}mail` : `${PREFIX}${step.id}`);
  const sizeBytes = text => {
    const match = /^([\d.]+)\s*(KB|MB|GB)$/i.exec(String(text ?? '').trim());
    return match ? Math.round(Number(match[1]) * { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[match[2].toLowerCase()]) : 0;
  };
  const choicesOf = step => (typeof window !== 'undefined' ? window.OceanDesktopModel : require('./desktop-model.js')).choicesFor(step);

  // The world app a step lives in (toast steps borrow the app of the step they announce).
  function appOf(steps, index) {
    const step = steps[index];
    if (!step) return null;
    if (step.app !== 'toast') return step.app;
    return TOAST_APPS[step.toast.app] ?? appOf(steps, index + 1);
  }

  // The creature's state follows the journey (SCENARIOS-60-CONTRACT §3): idle while locked, notice at the first step, approach as
  // the steps advance, circle on the step before the last forward step, press on the last one, breakthrough once the attack runs.
  // The trailing 'auto' step of a passive (trench) scene counts as its last forward step. Safe exits leave the creature idle.
  function creatureOf(scene, desk, steps, index) {
    const base = scene.creature;
    if (!base) return null;
    const { phase, path } = desk.scene;
    const forward = steps.filter(step => step.kind !== 'auto').length;
    let state = 'idle';
    let targetApp = null;
    if (desk.auth === 'desktop' && LIVE.includes(phase) && index >= 0) {
      const at = steps.slice(0, index + 1).filter(step => step.kind !== 'auto').length - 1;
      state = at === 0 ? 'notice' : at >= forward - 1 ? 'press' : at === forward - 2 ? 'circle' : 'approach';
      targetApp = appOf(steps, index) ?? null;
    } else if (desk.auth === 'desktop' && (phase === 'attack' || ((phase === 'debrief' || phase === 'done') && path !== 'safe'))) {
      state = 'breakthrough';
      targetApp = appOf(steps, Math.max(0, forward - 1)) ?? null;
    }
    return { family: base.family, depth: base.depth, sprite: base.sprite, state, targetApp };
  }

  // Extra world.scene keys, only for scenario scenes so the 30 family scenes project exactly as before.
  function presentationOf(scene, desk, steps, index) {
    if (!scene.creature && !scene.introCard && !scene.focusApps?.length) return {};
    const card = scene.introCard;
    return {
      focusApps: [...(scene.focusApps ?? [])],
      creature: creatureOf(scene, desk, steps, index),
      intro: card ? { title: line(card.title, 160), line: line(card.line, 600), next: line(card.next, 400) } : null,
    };
  }

  function highlightOf(steps, index) {
    const step = steps[index];
    if (!step) return null;
    if (step.app === 'toast') return highlightOf(steps, index + 1);
    if (step.app === 'mail') return { app: 'mail', ref: messageId(step) };
    if (step.app === 'mfa') return { app: 'mfa', ref: `${PREFIX}mfa` };
    if (step.app === 'files' && step.files?.target) return { app: 'files', ref: `${PREFIX}file` };
    if (step.kind === 'auto') return highlightOf(steps, index - 1);
    return { app: step.app, ref: null };
  }

  // ---- content builders ----------------------------------------------------------------------------------

  function pageBody(step, page, user) {
    const lines = {
      download: () => [page.text, `File: ${page.file}`],
      signin: () => [page.sub, `Account: ${user.email}`, 'Password: ••••••••'],
      code: () => [page.sub, `Verification code: ${page.code}`],
      consent: () => [`${page.app} · ${page.publisher}`, `Signed in as ${user.email}`, ['This app wants to:', ...page.perms.map(perm => `• ${perm}`)].join('\n')],
      payment: () => [page.sub, page.rows.map(([key, value]) => `${key}: ${value}`).join('\n')],
    }[page.type];
    return (lines ? lines() : [page.text ?? page.sub ?? '']).filter(Boolean).join('\n\n');
  }

  function pageLabels(step) {
    const page = step.page ?? {};
    return {
      ...CHOICE_LABELS,
      ...(page.button ? { download: page.button, 'sign-in': page.button, verify: page.button } : {}),
      ...(page.allow ? { allow: page.allow } : {}),
      ...(page.release ? { release: page.release, 'call-known': page.verify, 'second-approver': page.second, report: page.report } : {}),
      ...(step.mailbox ? { continue: step.mailbox.button } : {}),
      ...(step.redirect ? { 'open-ledger': step.redirect.button } : {}),
    };
  }

  function pageChoices(step) {
    const { forward, safe } = choicesOf(step);
    const labels = pageLabels(step);
    return [...forward, ...safe].filter(id => !PAGE_EXCLUDED.has(id)).slice(0, 6)
      .map(choiceId => ({ label: line(labels[choiceId] ?? choiceId, 60), choiceId, style: forward.includes(choiceId) ? 'primary' : 'secondary' }));
  }

  function setPage(world, id, page) {
    world.data.web ??= { pages: {} };
    if (!world.data.web.pages[id]) world.data.web.pages[id] = page;
  }

  function browserPage(world, step) {
    const page = step.page;
    setPage(world, pageId(step), {
      title: line(page.brand ? `${page.brand} · ${page.headline}` : page.headline, 120), url: page.url, brand: line(page.brand ?? '', 60),
      heading: line(page.headline, 160), body: pageBody(step, page, world.user), choices: pageChoices(step),
    });
  }

  // The site that accepted the consent in a journey (for the journey's sender address and page URL).
  function journeyHost(steps) {
    const consent = steps.find(step => step.page?.type === 'consent');
    return consent ? hostOf(consent.page.url) : 'apps.training.example';
  }

  function addMail(world, message) {
    if (!world.data.mail.messages.some(item => item.id === message.id)) world.data.mail.messages.unshift(message);
  }

  function mailMessage(world, step, steps, stamp) {
    const index = steps.indexOf(step);
    const next = steps[index + 1];
    const { from, subject, body, link, attachment } = step.mail;
    const linkTarget = link && next?.app === 'browser' ? `scene:${pageId(next)}` : null;
    if (attachment) addFile(world, `${PREFIX}file`, 'downloads', attachment, stamp);
    // The linked page exists as soon as the link does, so following it never shows a placeholder.
    if (linkTarget) browserPage(world, next);
    addMail(world, {
      id: messageId(step), folder: 'inbox', from: `${from[0]} <${from[1]}>`, to: world.user.email, subject: line(subject, 200),
      body: [...body, ...(link ? [`${link} ›`] : [])].join('\n\n'), time: stamp, read: false, flagged: false,
      attachments: attachment ? [`${PREFIX}file`] : [], ...(linkTarget ? { link: linkTarget } : {}),
    });
  }

  // Journey steps in mail (mailbox access, the redirect reply): a message plus a status page with the step's choices.
  function journeyMessage(world, step, steps, stamp) {
    const host = journeyHost(steps);
    let from;
    let subject;
    let body;
    if (step.mailbox) {
      const box = step.mailbox;
      const labels = { threads: 'Threads read', rules: 'Rules', ...(box.labels ?? {}) };
      from = `${box.app} <noreply@${host}>`;
      subject = box.headline;
      body = [box.status, [`${labels.threads}:`, ...box.threads.map(([name, text]) => `• ${name} — ${text}`)].join('\n'),
        [`${labels.rules}:`, ...box.rules.map(([name]) => `• ${name}`), `• New: ${box.newRule[0]} — ${box.newRule[1]}`].join('\n')].join('\n\n');
      if (labels.added === 'Sent by') wormMail(world, step, stamp);
    } else {
      const reply = step.redirect.reply;
      from = `${reply.from[0]} <${reply.from[1]}>`;
      subject = `Re: ${step.redirect.thread}`;
      body = [...reply.lines, reply.bank.map(([key, value]) => `${key}: ${value}`).join('\n'), reply.note,
        `On an earlier date ${step.redirect.original[0][0]} <${step.redirect.original[0][1]}> wrote:\n${step.redirect.original[1]}`].filter(Boolean).join('\n\n');
    }
    addMail(world, { id: messageId(step), folder: 'inbox', from, to: world.user.email, subject: line(subject, 200), body, time: stamp,
      read: false, flagged: false, attachments: [], link: `scene:${pageId(step)}` });
    setPage(world, pageId(step), {
      title: line(subject, 120), url: `${host}/${step.id}`, brand: line(step.mailbox?.app ?? hostOf(host), 60), heading: line(subject, 160),
      body, choices: pageChoices(step),
    });
  }

  // The OAuth worm sends the same invitation from the trainee's address to every contact it read.
  function wormMail(world, step, stamp) {
    const to = step.mailbox.threads.map(([, text]) => /([^\s·]+@[A-Za-z0-9.-]+\.example)/.exec(text)?.[1]).filter(Boolean);
    to.forEach((address, index) => addMail(world, {
      id: `${PREFIX}sent-${index + 1}`, folder: 'sent', from: `${world.user.name} <${world.user.email}>`, to: address,
      subject: `${world.user.name} shared a document with you`, body: `${line(step.mailbox.newRule[1], 300)}\n\nSent automatically by ${step.mailbox.app}.`,
      time: stamp, read: true, flagged: false, attachments: [],
    }));
  }

  function folderFor(world, name, stamp) {
    const fixed = FIXED_BY_NAME[String(name).toLowerCase()];
    if (fixed) return fixed;
    const id = `${PREFIX}folder`;
    world.fs.nodes[id] ??= { id, parentId: 'home', name: line(name, 120), kind: 'folder', mime: null, size: 0, modified: stamp, trashed: false };
    return id;
  }

  function addFile(world, id, parentId, [name, kind, size], stamp) {
    if (world.fs.nodes[id]) return;
    if (kind === 'File folder') {
      world.fs.nodes[id] = { id, parentId, name: line(name, 120), kind: 'folder', mime: null, size: 0, modified: stamp, trashed: false };
      return;
    }
    const contentId = `c-${id}`;
    world.fs.nodes[id] = { id, parentId, name: line(name, 120), kind: 'file', mime: 'text/plain', size: sizeBytes(size), modified: stamp, trashed: false, contentId };
    world.data.contents[contentId] = { text: `${name} (${kind}, ${size || 'unknown size'})\n\nFictional training file. Nothing in it runs.` };
  }

  function filesStep(world, step, stamp) {
    const parent = folderFor(world, step.files.folder, stamp);
    if (step.files.target) addFile(world, `${PREFIX}file`, parent, step.files.target, stamp);
    step.files.items.forEach((item, index) => addFile(world, `${PREFIX}item-${index + 1}`, parent, item, stamp));
  }

  function mfaStep(world, step, stamp) {
    const { brand, number } = step.mfa;
    world.data.mfa ??= { accounts: [], prompts: [] };
    const { accounts, prompts } = world.data.mfa;
    if (!accounts.some(item => item.id === `${PREFIX}acct`)) accounts.push({ id: `${PREFIX}acct`, issuer: line(brand.replace(/\s*Authenticator$/, ''), 80), label: world.user.email });
    if (!prompts.some(item => item.id === `${PREFIX}mfa`)) {
      prompts.push({ id: `${PREFIX}mfa`, app: line(brand, 80), account: world.user.email, location: 'Unrecognised location', device: 'New device',
        time: stamp, number: /^\d{1,3}$/.test(String(number)) ? Number(number) : null });
    }
  }

  // Trench monitors (Phone & Plan, Home Devices) show as rows in the updates app; the event flips some of them.
  function monitorRows(world, monitor, flipped) {
    world.data.updates ??= [];
    monitor.rows.forEach(([label, status], index) => {
      const id = `${PREFIX}row-${index + 1}`;
      const flip = flipped ? monitor.flip[index] : undefined;
      const item = { id, title: line(`${label}: ${flip ?? status}`, 160), kb: line(monitor.title, 20), size: '—', status: flip ? 'available' : 'installed' };
      const at = world.data.updates.findIndex(entry => entry.id === id);
      if (at < 0) world.data.updates.push(item);
      else if (flipped) world.data.updates[at] = item;
    });
  }

  function addNotification(world, { id, app, title, body }, stamp, banner = true) {
    const notification = { id, app: world.installed.includes(app) ? app : 'settings', title: line(title, 120), body: String(body).slice(0, 600), time: stamp };
    const { banners, history } = world.notifications;
    if (banner && !banners.some(item => item.id === id)) {
      banners.push(notification);
      if (banners.length > 8) banners.splice(0, banners.length - 8);
    }
    if (!history.some(item => item.id === id)) {
      history.push(notification);
      if (history.length > 120) history.splice(0, history.length - 120);
    }
  }

  function processName(scene) {
    const file = scene.steps.find(step => step.files?.target)?.files.target[0];
    if (file) return line(file.replace(/\.[^.]+$/, ''), 80);
    const page = scene.steps.map(step => step.page).find(item => item?.brand);
    const brand = page ? (page.app ?? page.brand) : scene.title;
    return line(`${brand} agent`, 80);
  }

  // Content for one reached step. Toast steps also deliver what they announce (the mail is in the inbox).
  function injectStep(world, scene, index, stamp) {
    const steps = scene.steps;
    const step = steps[index];
    if (step.app === 'toast') {
      addNotification(world, { id: `${PREFIX}toast`, app: appOf(steps, index), title: step.toast.title, body: step.toast.body }, stamp);
      const next = steps[index + 1];
      if (next && next.kind !== 'benign') injectStep(world, scene, index + 1, stamp);
      return;
    }
    if (step.app === 'mail') (step.mail ? mailMessage : journeyMessage)(world, step, steps, stamp);
    else if (step.app === 'browser') browserPage(world, step);
    else if (step.app === 'mfa') mfaStep(world, step, stamp);
    else if (step.app === 'files' && step.files) filesStep(world, step, stamp);
    else if (step.app === 'updates' && step.monitor) monitorRows(world, step.monitor, false);
    if (step.kind === 'auto') {
      const task = steps.find(item => item.id === 'task');
      if (task?.monitor) monitorRows(world, task.monitor, true);
      const alert = task?.monitor?.alert ?? task?.alert;
      if (alert) addNotification(world, { id: `${PREFIX}alert`, app: task.app, title: task.monitor?.title ?? 'Security alert', body: alert }, stamp);
    }
    // A code page delivers its code by text message as well.
    if (step.page?.type === 'code') {
      const thread = { id: `${PREFIX}sms`, with: line(step.page.brand, 80), items: [{ id: `${PREFIX}sms-1`, from: line(step.page.brand, 80),
        text: `${step.page.brand} code: ${step.page.code}. Never share this code.`, time: stamp }] };
      if (!world.data.messages.threads.some(item => item.id === thread.id)) world.data.messages.threads.unshift(thread);
    }
  }

  // The world window V2 opens for a step it entered.
  function openIntent(world, step) {
    if (!step || step.app === 'toast' || step.kind === 'auto' || !world.installed.includes(step.app)) return null;
    if (step.app === 'mail') return { kind: 'open-app', app: 'mail', payload: { messageId: messageId(step) } };
    if (step.app === 'browser') return { kind: 'open-app', app: 'browser', payload: { url: `scene:${pageId(step)}` } };
    if (step.app === 'files') {
      const node = world.fs.nodes[`${PREFIX}file`] ?? world.fs.nodes[`${PREFIX}item-1`];
      return node ? { kind: 'open-app', app: 'files', payload: { folderId: node.parentId } } : { kind: 'open-app', app: 'files' };
    }
    return { kind: 'open-app', app: step.app };
  }

  // ---- strip --------------------------------------------------------------------------------------------

  const windowIsScene = win => own(win.payload?.messageId) || own(win.payload?.fileId) || own(win.payload?.folderId) ||
    (typeof win.payload?.url === 'string' && own(win.payload.url.slice(6)));

  function stripInto(world) {
    const { data } = world;
    data.mail.messages = data.mail.messages.filter(item => !own(item.id));
    data.messages.threads = data.messages.threads.filter(item => !own(item.id));
    for (const [id, node] of Object.entries(world.fs.nodes)) {
      if (!own(id)) continue;
      if (node.contentId) delete data.contents[node.contentId];
      delete world.fs.nodes[id];
    }
    if (data.web) {
      for (const id of Object.keys(data.web.pages)) if (own(id)) delete data.web.pages[id];
      if (data.web.favorites) data.web.favorites = data.web.favorites.filter(item => !own(item.url.slice(6)));
      if (!Object.keys(data.web.pages).length && !data.web.favorites?.length) delete data.web;
    }
    if (data.mfa) {
      data.mfa.accounts = data.mfa.accounts.filter(item => !own(item.id));
      data.mfa.prompts = data.mfa.prompts.filter(item => !own(item.id));
      if (!data.mfa.accounts.length && !data.mfa.prompts.length) delete data.mfa;
    }
    for (const store of ['updates', 'processes']) {
      if (!data[store]) continue;
      data[store] = data[store].filter(item => !own(item.id));
      if (!data[store].length) delete data[store];
    }
    world.notifications.banners = world.notifications.banners.filter(item => !own(item.id));
    world.notifications.history = world.notifications.history.filter(item => !own(item.id));
    const closing = new Set(world.windows.filter(windowIsScene).map(win => win.id));
    if (closing.size) {
      world.windows = world.windows.filter(win => !closing.has(win.id));
      world.order = world.order.filter(id => !closing.has(id));
      if (closing.has(world.focusedId)) {
        world.focusedId = [...world.order].reverse().find(id => world.windows.find(win => win.id === id)?.mode !== 'minimized') ?? null;
      }
    }
    world.scene = { phase: 'boot', stepId: null, highlight: null };
  }

  function strip(world) {
    const draft = clone(world);
    stripInto(draft);
    return draft;
  }

  // ---- projection ---------------------------------------------------------------------------------------

  function project(world, { scene, desk, prevDesk = null, now, openWindows = true }) {
    const draft = clone(world);
    // Scene items are the newest in every list, even when the seed's data is dated after the local clock.
    const newest = Math.max(0, ...world.data.mail.messages.filter(item => !own(item.id)).map(item => Date.parse(item.time)));
    const stamp = isoAt(Math.max(now, newest + 60_000));
    const steps = scene.steps;
    const newRun = !prevDesk || prevDesk.runId !== desk.runId;
    if (newRun) stripInto(draft);
    const index = steps.findIndex(step => step.id === desk.scene.stepId);
    const before = newRun ? -1 : steps.findIndex(step => step.id === prevDesk.scene.stepId);
    for (let at = before + 1; at <= index; at += 1) injectStep(draft, scene, at, stamp);
    // The announcement banner leaves with its toast step; the history entry stays.
    if (steps[index]?.app !== 'toast') draft.notifications.banners = draft.notifications.banners.filter(item => item.id !== `${PREFIX}toast`);
    const { phase } = desk.scene;
    if (phase === 'attack' && !draft.data.processes?.some(item => item.id === `${PREFIX}proc`)) {
      draft.data.processes ??= [];
      draft.data.processes.push({ id: `${PREFIX}proc`, name: processName(scene), cpu: 91, mem: 412, publisher: 'Unknown publisher', suspicious: true });
    }
    draft.scene = { phase, stepId: desk.scene.stepId, highlight: LIVE.includes(phase) ? highlightOf(steps, index) : null, ...presentationOf(scene, desk, steps, index) };
    const intents = openWindows && index > before && index >= 0 ? [openIntent(draft, steps[index])].filter(Boolean) : [];
    if (JSON.stringify(draft) === JSON.stringify(world)) return { world, intents };
    draft.revision = world.revision + 1;
    return { world: draft, intents };
  }

  // ---- world intents → CONTRACT-V2 intents -----------------------------------------------------------------

  function sceneIntents({ before, after, intent, forward, desk, scene }) {
    const out = [];
    if (before.phase !== 'desktop' && after.phase === 'desktop' && desk.auth !== 'desktop') {
      if (desk.auth === 'locked') out.push({ kind: 'show-sign-in' });
      out.push({ kind: 'sign-in' });
      return out;
    }
    if (desk.auth !== 'desktop' || !LIVE.includes(desk.scene.phase)) return forward ? [forward] : out;
    const steps = scene.steps;
    const index = steps.findIndex(step => step.id === desk.scene.stepId);
    const toast = steps[index]?.app === 'toast' ? steps[index] : null;
    // A gesture on the announced content counts as opening the notification first.
    if (forward) {
      if (toast && forward.choiceId !== 'open') out.push({ kind: 'choose', choiceId: 'open' });
      out.push(forward);
    } else if (toast && intent.kind === 'open-app' && intent.app === appOf(steps, index)) {
      out.push({ kind: 'choose', choiceId: 'open' });
    } else if (toast && toast.dismissPassive && intent.kind === 'notify-dismiss' && intent.id === `${PREFIX}toast`) {
      out.push({ kind: 'dismiss-notification', id: 'n-toast' });
    }
    return out;
  }

  // Guidance for the parent's hint line: the step's own hint, with toast hints rewritten for the real shells.
  function hintFor(scene, desk) {
    if (desk.auth !== 'desktop') return null;
    if (desk.scene.phase === 'boot') return null;
    if (!LIVE.includes(desk.scene.phase)) return null;
    const steps = scene.steps;
    const index = steps.findIndex(step => step.id === desk.scene.stepId);
    const step = steps[index];
    if (!step) return null;
    if (step.app === 'toast') {
      const app = appOf(steps, index);
      return step.dismissPassive ? step.hint : `A notification arrived. Open ${app === 'browser' ? 'the browser' : app === 'mail' ? 'Mail' : 'the app'} to read it, or ignore it.`;
    }
    return step.hint ?? null;
  }

  const api = Object.freeze({ PREFIX, CHOICE_LABELS, project, sceneIntents, strip, hintFor, highlightOf, appOf });
  if (typeof window !== 'undefined') window.OceanSceneWorld = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

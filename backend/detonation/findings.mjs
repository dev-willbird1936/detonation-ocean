// Rule engine (SPEC §6.5, DETONATION-DESIGN §3–§5). Pure functions of the evidence; the model is never consulted
// and `detail` is never read. Evidence shape: docs/detonation/EVIDENCE.md.
import { isIP } from 'node:net';

export const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];

// Neutral name at Sunlight and Twilight, attack name at Midnight and deeper (design §4).
export const FAMILIES = {
  disguise: { neutral: 'disguise', attack: 'deception' },
  access: { neutral: 'access', attack: 'intrusion' },
  network: { neutral: 'network', attack: 'coordinated-abuse' },
  loader: { neutral: 'loader', attack: 'trusted-source-compromise' },
  'data-access': { neutral: 'data-access', attack: 'theft-surveillance' },
  'file-changes': { neutral: 'file-changes', attack: 'extortion-destruction' },
  drifter: { neutral: 'drifter', attack: 'drifter' },
};

// Row order is the tie-break order inside a tier (design §5). `family` is a FAMILIES key.
export const FINDING_TABLE = [
  { id: 'steal-credentials', depth: 'midnight', family: 'data-access', label: 'Reads honey credentials, keys or wallets' },
  { id: 'steal-browser', depth: 'midnight', family: 'data-access', label: 'Reads browser passwords or cookies' },
  { id: 'steal-documents', depth: 'midnight', family: 'data-access', label: 'Collects or packs up user documents' },
  { id: 'keylog', depth: 'midnight', family: 'data-access', label: 'Logs keystrokes' },
  { id: 'capture', depth: 'midnight', family: 'data-access', label: 'Captures the screen, microphone or camera' },
  { id: 'clipboard-swap', depth: 'midnight', family: 'data-access', label: 'Swaps clipboard contents' },
  { id: 'fake-login', depth: 'midnight', family: 'disguise', label: 'Fake login form captures typed text' },
  { id: 'exfil-attempt', depth: 'midnight', family: 'network', label: 'Tries to send data out (blocked)' },
  { id: 'privilege-escalation', depth: 'abyss', family: 'access', label: 'Privilege escalation attempt' },
  { id: 'persistence', depth: 'abyss', family: 'access', label: 'Persists across restarts' },
  { id: 'defence-tamper', depth: 'abyss', family: 'access', label: 'Disables security tools, clears logs or hides itself' },
  { id: 'traffic-redirect', depth: 'abyss', family: 'access', label: 'Redirects traffic' },
  { id: 'browser-hijack', depth: 'abyss', family: 'access', label: 'Hijacks the browser' },
  { id: 'remote-control', depth: 'abyss', family: 'network', label: 'Remote control, beacon or network scan' },
  { id: 'injection', depth: 'abyss', family: 'loader', label: 'Process injection or DLL side-loading' },
  { id: 'second-stage', depth: 'abyss', family: 'loader', label: 'Downloads or drops a second stage' },
  { id: 'resource-hijack', depth: 'abyss', family: 'access', label: 'Hijacks resources: mining or fork bomb' },
  { id: 'system-wipe', depth: 'trench', family: 'file-changes', label: 'Attempts a system wipe' },
  { id: 'encrypt', depth: 'trench', family: 'file-changes', label: 'Encrypts user files or drops a ransom note' },
  { id: 'destroy-files', depth: 'trench', family: 'file-changes', label: 'Deletes or overwrites user files or backups' },
  { id: 'spread', depth: 'trench', family: 'network', label: 'Spreads or mass-mails' },
  // Depth and family come from the evidence: honey file Midnight, system setting Abyss, user data Trench.
  { id: 'other-harm', depth: null, family: null, label: 'Unclassified harmful behaviour' },
];

// Priority order (design §5); `family` is the FAMILIES key its evidence counts for.
export const SIGNAL_ORDER = [
  { id: 'exploit-unproven', family: 'disguise', label: 'Exploit document, harm unproven' },
  { id: 'phishing-unproven', family: 'disguise', label: 'Phishing link or scareware page, harm unproven' },
  { id: 'anti-analysis', family: 'disguise', label: 'Detects the sandbox, sleeps it out or deletes itself' },
  { id: 'type-mismatch', family: 'disguise', label: 'Type does not match the extension' },
  { id: 'adware', family: 'access', label: 'Adds itself to startup or bundles extra software' },
  { id: 'admin-request', family: 'access', label: 'Asks for admin rights' },
  { id: 'unknown-hosts', family: 'network', label: 'Contacts unknown hosts (blocked)' },
  { id: 'system-survey', family: 'data-access', label: 'Surveys the system' },
  { id: 'hidden-commands', family: 'disguise', label: 'Runs system tools with hidden or encoded commands' },
  { id: 'obfuscated', family: 'disguise', label: 'Obfuscated, encoded or packed' },
  { id: 'unsigned', family: 'disguise', label: 'Unsigned or invalid signature' },
  { id: 'incomplete', family: null, label: 'Incomplete run' },
  { id: 'other-suspicious', family: null, label: 'Other suspicious behaviour' },
];

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^[a-z]:\/users\/dana\//i, '/home/dana/');

const CREDENTIAL_FILE = /\/(\.aws\/credentials|\.ssh\/id_[^/.]+|\.env|\.electrum\/wallets\/[^/]+|appdata\/roaming\/microsoft\/credentials\/[^/]*|wallet\.dat)$/i;
const BROWSER_FILE = /\/default\/(login data|cookies)(-journal)?$/i;
const SYSTEM_PATH = /^(\/(bin|etc|usr)(\/|$)|[a-z]:\/windows(\/|$))/i;
const ARCHIVE_FILE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i;
const STAGING_DIR = /^\/(tmp|var\/tmp|dev\/shm)\//i;
const DOCUMENTS_DIR = /^\/home\/dana\/documents\//i;
const PERSIST_PATH = /^\/(etc\/(cron[^/]*|init\.d|systemd\/system|rc\.local|passwd|shadow)|var\/spool\/cron)(\/|$)|\/\.config\/(systemd\/user|autostart)\/|\/start menu\/programs\/startup\//i;
const PERSIST_KEY = /\\(Windows\\CurrentVersion\\(Run|RunOnce|RunServices|RunServicesOnce)(\\|$)|Winlogon\\(Shell|Userinit)|CurrentControlSet\\Services\\|Schedule\\TaskCache\\)/i;
const PERSIST_CMD = /\b(schtasks\b.*\/create|crontab\b(?!\s+-l)|systemctl\b.*\benable|sc(\.exe)?\s+create|useradd|adduser|net1?\s+user\b.*\/add)/i;
const UAC_KEY = /\\(Classes\\(ms-settings|mscfile|exefile)\\shell\\open\\command|Environment\\windir|Policies\\System\\(EnableLUA|ConsentPromptBehaviorAdmin|LocalAccountTokenFilterPolicy)|App Paths\\(control|eventvwr|sdclt)\.exe)/i;
const DEFENCE_CMD = /\b(wevtutil\s+cl|Clear-EventLog|Set-MpPreference|attrib\s+\S*\+[hs])|\b(pkill|killall|taskkill|kill|net\s+stop|sc(\.exe)?\s+(stop|delete)|systemctl\s+(stop|disable|mask))\b.*\b(defender|windefend|msmpeng|mbam|malwarebytes|avast|avg|kaspersky|clamd|clamav|falcon|sentinel|ossec|auditd|wazuh|sysmon|firewalld|ufw)\b/i;
const DEFENCE_KEY = /Disable(AntiSpyware|RealtimeMonitoring)/i;
const TRAFFIC_PATH = /(^|\/)(etc\/(hosts|resolv\.conf|systemd\/resolved\.conf)|windows\/system32\/drivers\/etc\/hosts)$/i;
const TRAFFIC_KEY = /Internet Settings\\(ProxyServer|ProxyEnable|AutoConfigURL)|Tcpip\\Parameters\\.*NameServer/i;
const BROWSER_PATH = /\/(chromium|google-chrome|chrome|firefox|\.mozilla|brave|edge)[\s\S]*\/(extensions\/|preferences$|secure preferences$|prefs\.js$|user\.js$|policies\.json$)/i;
const BROWSER_KEY = /Policies\\(Google\\Chrome|Mozilla\\Firefox|Microsoft\\Edge)|Internet Explorer\\(Main\\Start Page|SearchScopes)/i;
const BACKUP_DELETE = /\b(vssadmin\b.*\bdelete\b.*\bshadows?|wbadmin\b.*\bdelete|wmic\b.*\bshadowcopy\b.*\bdelete|bcdedit\b.*\brecoveryenabled)/i;
const RANSOM_NOTE = /ransom|decrypt|(recover|restore)[ _-]?(your[ _-]?)?files|how[ _-]?to[ _-]?(recover|restore)/i;
const MINING_POOL = /stratum\+|mining\.(subscribe|authorize)/i;
const isLoopback = host => typeof host === 'string'
  && (/^(?:localhost|::1)$/i.test(host) || (isIP(host) === 4 && host.startsWith('127.')));

const CRED_APIS = ['CredEnumerateA', 'CredEnumerateW', 'CredReadA', 'CredReadW', 'LsaRetrievePrivateData', 'MiniDumpWriteDump'];
const CAPTURE_APIS = ['PrintWindow', 'waveInOpen', 'waveInStart', 'capCreateCaptureWindowA', 'capCreateCaptureWindowW', 'MFCreateDeviceSource'];
const DRIVER_APIS = ['NtLoadDriver', 'ZwLoadDriver'];
const SERVICE_APIS = ['CreateServiceA', 'CreateServiceW'];
const LOG_CLEAR_APIS = ['ClearEventLogA', 'ClearEventLogW', 'EvtClearLog'];
const MEMORY_WRITE_APIS = ['WriteProcessMemory', 'NtWriteVirtualMemory'];
const REMOTE_THREAD_APIS = ['CreateRemoteThread', 'CreateRemoteThreadEx', 'NtCreateThreadEx', 'RtlCreateUserThread', 'QueueUserAPC'];
const DOWNLOAD_APIS = ['URLDownloadToFileA', 'URLDownloadToFileW'];
const RUN_APIS = ['CreateProcessA', 'CreateProcessW', 'WinExec', 'ShellExecuteA', 'ShellExecuteW', 'ShellExecuteExA', 'ShellExecuteExW'];

const ids = (items) => [...new Set(items.map((e) => e.id))];
const isApi = (e, names) => e.kind === 'api-call' && names.includes(e.api);
const calls = (items) => items.reduce((n, e) => n + (e.count ?? 1), 0);
const cmdline = (e) => [e.path, ...(e.argv ?? [])].join(' ');
const keyPath = (e) => `${e.hive}\\${e.key}\\${e.value ?? ''}`;
const isKeyWrite = (e) => e.kind === 'key-added' || e.kind === 'key-changed';
const isHoney = (p) => CREDENTIAL_FILE.test(p) || BROWSER_FILE.test(p);
const isDownload = (e) => (e.kind === 'connect' && e.download === true) || e.kind === 'download' || isApi(e, DOWNLOAD_APIS);
const isRun = (e) => e.kind === 'execve' || isApi(e, RUN_APIS);
const hostOf = (e) => (e.kind === 'request-blocked' ? new URL(e.url, 'http://invalid.test').hostname : e.host);

// Paths the sample wrote: trace writes and renames, diff additions, changes and renames.
const writes = (c) => c.ev.flatMap((e) => {
  if (['file-write', 'added', 'changed'].includes(e.kind)) return [{ id: e.id, path: norm(e.path) }];
  if (['rename', 'renamed'].includes(e.kind)) return [{ id: e.id, path: norm(e.to) }];
  return [];
});
const writesMatching = (c, re) => writes(c).filter((w) => re.test(w.path)).map((w) => w.id);
const keysMatching = (c, re) => ids(c.ev.filter((e) => isKeyWrite(e) && re.test(keyPath(e))));
const cmdsMatching = (c, re) => ids(c.ev.filter((e) => e.kind === 'execve' && re.test(cmdline(e))));
const seededDiff = (c, ...kinds) => c.ev.filter((e) => kinds.includes(e.kind) && e.seeded === true);
const hasToken = (c, ...values) => c.tokens.some((t) => values.some((v) => String(v ?? '').includes(t)));

const FINDING_RULES = {
  'steal-credentials': (c) => ids(c.ev.filter((e) => (e.kind === 'file-read' && CREDENTIAL_FILE.test(norm(e.path)))
    || isApi(e, CRED_APIS) || (e.kind === 'api-call' && /lsass/i.test(JSON.stringify(e.args ?? ''))))),

  'steal-browser': (c) => ids(c.ev.filter((e) => e.kind === 'file-read' && BROWSER_FILE.test(norm(e.path)))),

  'steal-documents': (c) => {
    const reads = c.ev.filter((e) => e.kind === 'file-read' && c.seeded.has(norm(e.path)) && DOCUMENTS_DIR.test(norm(e.path)));
    const staged = writes(c).filter((w) => ARCHIVE_FILE.test(w.path) || STAGING_DIR.test(w.path));
    return new Set(reads.map((e) => norm(e.path))).size >= 3 && staged.length ? [...ids(reads), ...new Set(staged.map((w) => w.id))] : [];
  },

  keylog: (c) => {
    const hooks = c.ev.filter((e) => e.kind === 'api-call' && /^SetWindowsHookEx[AW]?$/.test(e.api) && /^(WH_KEYBOARD(_LL)?|2|13)$/.test(String(e.args?.idHook)));
    const polls = c.ev.filter((e) => isApi(e, ['GetAsyncKeyState']));
    return hooks.length ? ids(hooks) : calls(polls) >= 10 ? ids(polls) : [];
  },

  capture: (c) => ids(c.ev.filter((e) => isApi(e, CAPTURE_APIS) || (isApi(e, ['BitBlt', 'StretchBlt']) && e.args?.screen === true))),

  'clipboard-swap': (c) => {
    const get = c.ev.findIndex((e) => isApi(e, ['GetClipboardData']));
    const set = get < 0 ? undefined : c.ev.slice(get + 1).find((e) => isApi(e, ['SetClipboardData']));
    return set ? [c.ev[get].id, set.id] : [];
  },

  'fake-login': (c) => ids(c.ev.filter((e) => e.kind === 'form-submit' && (e.typedCredential === true || hasToken(c, JSON.stringify(e.fields ?? {}))))),

  'exfil-attempt': (c) => ids(c.ev.filter((e) => (['connect', 'sendto'].includes(e.kind) && hasToken(c, e.payloadPreview))
    || (e.kind === 'request-blocked' && hasToken(c, e.url, e.body)))),

  'privilege-escalation': (c) => [...new Set([
    ...keysMatching(c, UAC_KEY),
    ...ids(c.ev.filter((e) => isApi(e, DRIVER_APIS) || (isApi(e, SERVICE_APIS) && /driver/i.test(String(e.args?.type))) || e.kind === 'setuid' || e.kind === 'capability')),
  ])],

  persistence: (c) => [...new Set([
    ...keysMatching(c, PERSIST_KEY),
    ...ids(c.ev.filter((e) => isApi(e, SERVICE_APIS))),
    ...writesMatching(c, PERSIST_PATH),
    ...cmdsMatching(c, PERSIST_CMD),
  ])],

  'defence-tamper': (c) => [...new Set([
    ...cmdsMatching(c, DEFENCE_CMD),
    ...keysMatching(c, DEFENCE_KEY),
    ...ids(c.ev.filter((e) => isApi(e, LOG_CLEAR_APIS) || (isApi(e, ['SetFileAttributesA', 'SetFileAttributesW']) && e.args?.hidden === true)
      || (e.kind === 'unlink' && /^\/var\/log\//i.test(norm(e.path))))),
  ])],

  'traffic-redirect': (c) => [...new Set([...writesMatching(c, TRAFFIC_PATH), ...keysMatching(c, TRAFFIC_KEY)])],

  'browser-hijack': (c) => [...new Set([...writesMatching(c, BROWSER_PATH), ...keysMatching(c, BROWSER_KEY)])],

  'remote-control': (c) => {
    const net = c.ev.filter((e) => e.kind === 'connect' || e.kind === 'sendto');
    const byTarget = Map.groupBy(c.ev.filter((e) => e.kind === 'connect'), (e) => `${e.host}:${e.port}`);
    const repeated = [...byTarget.values()].filter((g) => g.length >= 3).flat();
    const scanning = new Set(net.map((e) => e.host)).size >= 10 ? net : [];
    return ids([...repeated, ...c.ev.filter((e) => e.kind === 'listen'), ...scanning]);
  },

  injection: (c) => {
    const write = c.ev.filter((e) => isApi(e, MEMORY_WRITE_APIS));
    const thread = c.ev.filter((e) => isApi(e, REMOTE_THREAD_APIS));
    return ids([...(write.length && thread.length ? [...write, ...thread] : []), ...c.ev.filter((e) => e.kind === 'dll-hijack')]);
  },

  'second-stage': (c) => {
    const found = [];
    for (const added of c.ev.filter((e) => e.kind === 'added' && e.executable === true)) {
      const attempted = c.ev.filter((e) => e.kind === 'execve' && norm(e.path) === norm(added.path));
      if (attempted.length) found.push(...attempted, added);
    }
    const download = c.ev.findIndex(isDownload);
    const run = download < 0 ? undefined : c.ev.slice(download + 1).find(isRun);
    return ids(run ? [...found, c.ev[download], run] : found);
  },

  'resource-hijack': (c) => {
    // Process-cap hit (PIDS-AND-WINE.md A.6): >= 100 failed creations (a bomb that retries), or >= 1 failure after >= 100 successes
    // (the sandbox reached its cap), or a sandbox crash on clone. Time and memory caps alone are not this.
    const forks = c.ev.filter((e) => e.kind === 'clone-eagain');
    const failed = forks.reduce((n, e) => n + e.count, 0);
    const created = forks.reduce((n, e) => n + (e.created ?? 0), 0);
    const crashes = c.ev.filter((e) => e.kind === 'pids' && e.crash === true);
    const mining = c.ev.filter((e) => ['connect', 'sendto'].includes(e.kind) && MINING_POOL.test(e.payloadPreview ?? ''));
    return ids([...(failed >= 100 || (failed >= 1 && created >= 100) ? forks : []), ...crashes, ...mining]);
  },

  'system-wipe': (c) => ids(c.ev.filter((e) => (e.kind === 'unlink' || e.kind === 'rmdir') && SYSTEM_PATH.test(norm(e.path)))),

  encrypt: (c) => {
    const files = seededDiff(c, 'changed', 'renamed').filter((e) => (e.kind === 'changed'
      ? e.entropyAfter >= 7.5 : norm(e.to).split('.').pop() !== norm(e.path).split('.').pop()));
    const notes = c.ev.filter((e) => e.kind === 'added' && RANSOM_NOTE.test(norm(e.path).split('/').pop()));
    return files.length >= 3 || notes.length ? ids([...files, ...notes]) : [];
  },

  'destroy-files': (c) => {
    const lost = seededDiff(c, 'deleted', 'changed').filter((e) => e.kind === 'deleted' || e.sizeAfter === 0);
    return ids([...(lost.length >= 3 ? lost : []), ...c.ev.filter((e) => e.kind === 'execve' && BACKUP_DELETE.test(cmdline(e)))]);
  },

  spread: (c) => {
    const copies = c.ev.filter((e) => e.kind === 'added' && e.copyOfSample === true);
    const mails = c.ev.filter((e) => e.kind === 'mail-send');
    return ids([...(new Set(copies.map((e) => norm(e.path))).size >= 3 ? copies : []), ...(calls(mails.map((e) => ({ count: e.recipients }))) >= 5 ? mails : [])]);
  },
};

// Evidence no other finding used: a seeded honey file changed is Midnight, a system setting Abyss, user data Trench.
function otherHarm(c, claimed) {
  const hits = [];
  for (const e of c.ev) {
    if (claimed.has(e.id)) continue;
    if (['changed', 'deleted', 'renamed'].includes(e.kind) && e.seeded === true) hits.push({ e, depth: isHoney(norm(e.path)) ? 'midnight' : 'trench' });
    else if (['key-added', 'key-changed', 'key-deleted'].includes(e.kind) && e.hive === 'HKLM' && !/^Software\\Wine\\/i.test(e.key)) hits.push({ e, depth: 'abyss' });
  }
  if (!hits.length) return null;
  const depth = hits.map((h) => h.depth).sort((a, b) => DEPTHS.indexOf(b) - DEPTHS.indexOf(a))[0];
  return { id: 'other-harm', depth, familyKey: { midnight: 'data-access', abyss: 'access', trench: 'file-changes' }[depth], evidenceIds: ids(hits.map((h) => h.e)) };
}

const SIGNAL_RULES = {
  'exploit-unproven': (c) => ids(c.ev.filter((e) => e.kind === 'exploit-indicator')),
  'phishing-unproven': (c) => ids(c.ev.filter((e) => e.kind === 'phishing-indicator')),
  'anti-analysis': (c) => {
    const sleeps = c.ev.filter((e) => e.kind === 'sleep');
    return ids([
      ...c.ev.filter((e) => e.kind === 'anti-analysis' || e.kind === 'file-check' || isApi(e, ['wine_get_version'])
        || (e.kind === 'registry-read' && /^HKCU\\Software\\Wine(\\|$)/i.test(`${e.hive}\\${e.key}`))
        || (e.kind === 'unlink' && (e.self === true || norm(e.path) === '/in/sample'))),
      ...(sleeps.reduce((n, e) => n + e.seconds, 0) >= 20 ? sleeps : []),
    ]);
  },
  'type-mismatch': (c) => ids(c.ev.filter((e) => e.kind === 'type-mismatch')),
  adware: (c) => ids(c.ev.filter((e) => e.kind === 'adware-indicator')),
  'admin-request': (c) => ids(c.ev.filter((e) => e.kind === 'admin-request')),
  'unknown-hosts': (c) => ids(c.ev.filter((e) => e.kind === 'request-blocked' || (['connect', 'sendto'].includes(e.kind) && !isLoopback(hostOf(e))))),
  'system-survey': (c) => ids(c.ev.filter((e) => e.kind === 'system-survey')),
  'hidden-commands': (c) => ids(c.ev.filter((e) => e.kind === 'hidden-command')),
  obfuscated: (c) => ids(c.ev.filter((e) => e.kind === 'obfuscation')),
  unsigned: (c) => ids(c.ev.filter((e) => e.kind === 'unsigned')),
  incomplete: (c) => ids(c.ev.filter((e) => ['oom', 'time', 'emulation-stopped', 'unsupported-type'].includes(e.kind))),
  'other-suspicious': (c) => ids(c.ev.filter((e) => e.kind === 'suspicious')),
};

// Each evidence item counts for one family: first the finding or signal that used it, then by kind.
function dominantFamily(c, fired, signalEvidence, deepest) {
  const owner = new Map();
  for (const { evidenceIds, familyKey } of fired) evidenceIds.forEach((id) => owner.has(id) || owner.set(id, familyKey));
  for (const { id, family } of SIGNAL_ORDER) signalEvidence[id].forEach((evId) => family && !owner.has(evId) && owner.set(evId, family));
  for (const e of c.ev) {
    if (owner.has(e.id)) continue;
    if (['added', 'changed', 'deleted', 'renamed', 'unlink', 'rename', 'rmdir'].includes(e.kind)) owner.set(e.id, 'file-changes');
    else if (e.kind === 'connect' || e.kind === 'sendto') owner.set(e.id, 'network');
  }
  const counts = new Map();
  for (const family of owner.values()) counts.set(family, (counts.get(family) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  const tied = Object.keys(FAMILIES).filter((f) => counts.get(f) === top);
  if (!top) return 'drifter';
  return tied.includes(deepest?.familyKey) ? deepest.familyKey : tied[0];
}

function statement(depth, complete, findings, signals) {
  if (findings.length) return `Harmful behaviour observed: ${findings.map((f) => f.id).join(', ')}.`;
  const base = 'No harmful behaviour observed in the checks run. This is not a guarantee.';
  if (depth === 'sunlight') return base;
  return `${complete ? 'Risky, unproven' : 'Inconclusive'}: ${signals.join(', ')}. ${base}`;
}

function evaluateWithDepthPolicy({ evidence = [], path, complete = true, seedManifest = [], canaryTokens = [] }, capIncompleteDepth) {
  const c = { ev: evidence, seeded: new Set(seedManifest.map((f) => norm(f.path))), tokens: canaryTokens };
  const inspectOnly = path === 'inspect';

  const fired = [];
  if (!inspectOnly) {
    for (const row of FINDING_TABLE) {
      const evidenceIds = row.id === 'other-harm' ? [] : FINDING_RULES[row.id](c);
      if (evidenceIds.length) fired.push({ id: row.id, depth: row.depth, familyKey: row.family, evidenceIds });
    }
    const harm = otherHarm(c, new Set(fired.flatMap((f) => f.evidenceIds)));
    if (harm) fired.push(harm);
  }

  const signalEvidence = Object.fromEntries(SIGNAL_ORDER.map(({ id }) => [id, SIGNAL_RULES[id](c)]));
  const signals = SIGNAL_ORDER.map(({ id }) => id)
    .filter((id) => signalEvidence[id].length || (id === 'incomplete' && (!complete || inspectOnly)));

  const rank = (f) => DEPTHS.indexOf(f.depth);
  const deepest = fired.reduce((best, f) => (!best || rank(f) > rank(best) ? f : best), null);
  const verdictComplete = !signals.includes('incomplete');
  const depth = capIncompleteDepth && !verdictComplete ? 'twilight' : deepest ? deepest.depth : signals.length ? 'twilight' : 'sunlight';
  const familyKey = dominantFamily(c, fired, signalEvidence, deepest);
  const findings = fired.map(({ id, depth: d, familyKey: key, evidenceIds }) => ({ id, depth: d, family: FAMILIES[key].attack, evidenceIds }));

  return {
    depth,
    family: FAMILIES[familyKey][rank({ depth }) >= 2 ? 'attack' : 'neutral'],
    signals,
    findings,
    statement: statement(depth, verdictComplete, findings, signals),
    complete: verdictComplete,
  };
}

// Item verdicts cap incomplete runs at Twilight while retaining observed findings and their evidence depths.
export function evaluate(options) {
  return evaluateWithDepthPolicy(options, true);
}

// The job-wide caller keeps the existing aggregate behavior until item aggregation and shared-diff policy are resolved.
export function evaluateJobWide(options) {
  return evaluateWithDepthPolicy(options, false);
}

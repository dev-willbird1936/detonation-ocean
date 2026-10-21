// Finding creatures, families and Twilight signals for the job view. Order of FINDINGS is the design's table order
// (docs/DETONATION-DESIGN.md §5): when two findings share the deepest tier, the first row here eats the fish.
// tests/detonation-job-view.test.mjs checks names, depths and sprites against data/creatures.json.

const SHEETS = '/ui/abyss/pixel/creatures/';

export const FINDINGS = {
  'steal-credentials': { creature: 'Cookiecutter shark', label: 'Reads credentials, keys or wallets', depth: 'midnight', sprite: `${SHEETS}cookiecutter-midnight-spritesheet.png` },
  'steal-browser': { creature: 'Black swallower', label: 'Reads saved browser passwords or sessions', depth: 'midnight', sprite: `${SHEETS}black-swallower-spritesheet.png` },
  'steal-documents': { creature: 'Megamouth shark', label: 'Gathers documents into an archive', depth: 'midnight', sprite: `${SHEETS}megamouth-shark-spritesheet.png` },
  keylog: { creature: 'Barreleye', label: 'Records keystrokes', depth: 'midnight', sprite: `${SHEETS}barreleye-spritesheet.png` },
  capture: { creature: 'Telescopefish', label: 'Captures the screen, microphone or camera', depth: 'midnight', sprite: `${SHEETS}telescopefish-spritesheet.png` },
  'clipboard-swap': { creature: 'Cuckoo wrasse', label: 'Swaps clipboard contents', depth: 'midnight', sprite: `${SHEETS}cuckoo-wrasse-spritesheet.png` },
  'fake-login': { creature: 'Anglerfish', label: 'Fake login form captures typed text', depth: 'midnight', sprite: `${SHEETS}anglerfish-midnight-spritesheet.png` },
  'exfil-attempt': { creature: 'Snipe eel', label: 'Tries to send data out (blocked)', depth: 'midnight', sprite: `${SHEETS}snipe-eel-spritesheet.png` },
  'privilege-escalation': { creature: 'Viperfish', label: 'Tries to gain higher privileges', depth: 'abyss', sprite: `${SHEETS}viperfish-abyss-spritesheet.png` },
  persistence: { creature: 'Tripod fish', label: 'Plants itself to run again', depth: 'abyss', sprite: `${SHEETS}tripod-fish-spritesheet.png` },
  'defence-tamper': { creature: 'Hatchetfish', label: 'Disables security tools or clears logs', depth: 'abyss', sprite: `${SHEETS}hatchetfish-spritesheet.png` },
  'traffic-redirect': { creature: 'Lanternfish', label: 'Redirects network traffic', depth: 'abyss', sprite: `${SHEETS}lanternfish-spritesheet.png` },
  'browser-hijack': { creature: 'Sea lamprey', label: 'Hijacks the browser', depth: 'abyss', sprite: `${SHEETS}sea-lamprey-spritesheet.png` },
  'remote-control': { creature: 'Siphonophore', label: 'Remote control or botnet activity', depth: 'abyss', sprite: `${SHEETS}siphonophore-abyss-spritesheet.png` },
  injection: { creature: 'Tongue-eating isopod', label: 'Injects into other processes', depth: 'abyss', sprite: `${SHEETS}isopod-host-abyss-spritesheet.png` },
  'second-stage': { creature: 'Gulper eel', label: 'Downloads or drops a second stage', depth: 'abyss', sprite: `${SHEETS}gulper-eel-spritesheet.png` },
  'resource-hijack': { creature: 'Vampire squid', label: 'Hijacks resources (fork bomb or mining)', depth: 'abyss', sprite: `${SHEETS}vampire-squid-spritesheet.png` },
  'system-wipe': { creature: 'Jörmungandr', label: 'Tries to wipe the system', depth: 'trench', sprite: `${SHEETS}jormungandr-spritesheet.png` },
  encrypt: { creature: 'Kraken', label: 'Encrypts files or drops a ransom note', depth: 'trench', sprite: `${SHEETS}kraken-spritesheet.png` },
  'destroy-files': { creature: 'Leviathan', label: 'Deletes or overwrites user files', depth: 'trench', sprite: `${SHEETS}leviathan-spritesheet.png` },
  spread: { creature: 'Hydra', label: 'Spreads to other hosts', depth: 'trench', sprite: `${SHEETS}hydra-spritesheet.png` },
  'other-harm': { creature: 'Giant squid', label: 'Unclassified harmful behaviour', depth: 'variable', sprite: `${SHEETS}giant-squid-spritesheet.png` },
};

export const FINDING_ORDER = Object.keys(FINDINGS);

// Species with swim-cycle art (`sprite` in data/fish.json); every other species keeps the code-drawn fish.
const SWIMMERS = ['pufferfish', 'flounder', 'leafy-seadragon', 'boxfish', 'barracuda', 'mandarin-dragonet', 'flying-fish', 'pilot-fish', 'torpedo-ray', 'snake-eel', 'jack', 'coelacanth', 'lionfish', 'ribbonfish', 'remora', 'picasso-triggerfish', 'batfish', 'archerfish', 'sea-bass', 'goblin-shark', 'jawfish', 'pocket-shark', 'mackerel', 'java-rabbitfish', 'sole', 'butterflyfish', 'plaice'];
export const fishSprite = species => (SWIMMERS.includes(species) ? `/ui/abyss/pixel/fish/${species}-swim.png` : null);

export const OCTOPUS_SPRITE = `${SHEETS}octopus-sunlight-spritesheet.png`;

// The octopus sheet is drawn facing right; every other sheet faces left.
export const spriteFacesRight = url => typeof url === 'string' && url.includes('/octopus-');

export const FAMILIES = {
  disguise: { neutral: 'Disguise', attack: 'Deception' },
  access: { neutral: 'Access', attack: 'Intrusion' },
  network: { neutral: 'Network', attack: 'Coordinated abuse' },
  loader: { neutral: 'Loader', attack: 'Trusted-source compromise' },
  'data-access': { neutral: 'Data access', attack: 'Theft / surveillance' },
  'file-changes': { neutral: 'File changes', attack: 'Extortion / destruction' },
  drifter: { neutral: 'Drifter', attack: 'Drifter' },
};

export const SIGNALS = {
  'exploit-unproven': 'Exploit document, harm unproven',
  'phishing-unproven': 'Phishing link or scareware page, harm unproven',
  'anti-analysis': 'Tries to detect or evade the sandbox',
  'type-mismatch': 'File type does not match its extension',
  adware: 'Adds itself to startup or bundles extra software',
  'admin-request': 'Asks for admin rights',
  'unknown-hosts': 'Contacts unknown hosts (blocked)',
  'system-survey': 'Surveys the system',
  'hidden-commands': 'Runs system tools with hidden or encoded commands',
  obfuscated: 'Obfuscated, encoded or packed',
  unsigned: 'Unsigned or invalid signature',
  incomplete: 'Incomplete run: not every check could finish',
  'other-suspicious': 'Other suspicious behaviour',
};

const normalise = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function familyName(family, depth) {
  const entry = FAMILIES[normalise(family)];
  if (!entry) return String(family ?? 'Unknown');
  return ['midnight', 'abyss', 'trench'].includes(depth) ? entry.attack : entry.neutral;
}

// Display facts for a finding event or report finding. The id picks the entry; the event's `creature` is the fallback.
export function findingFacts(finding) {
  const known = FINDINGS[finding?.id];
  return {
    id: String(finding?.id ?? ''),
    creature: known?.creature ?? String(finding?.creature ?? 'Unknown creature'),
    label: known?.label ?? String(finding?.id ?? 'Finding'),
    depth: finding?.depth ?? known?.depth ?? 'midnight',
    sprite: known ? known.sprite : null,
  };
}

export const signalLabel = id => SIGNALS[id] ?? String(id);

// Names for uploaded fish. A name is two real words picked from the job id (random per upload, so it says nothing about the
// file's name or content), alliterating with the species where it can ("Salty Sprocket" for a snake eel). Names live only in
// this browser: the host page passes its web storage in (job-view code never touches storage itself, tests/detonation-job-view);
// the shared ocean shows counts, never who uploaded what. Without storage, names last for the visit.
const ADJECTIVES = ['Amber', 'Brave', 'Breezy', 'Bubbly', 'Calm', 'Cheery', 'Coral', 'Cosy', 'Dapper', 'Dizzy', 'Dreamy', 'Eager', 'Fizzy',
  'Fluffy', 'Gentle', 'Giddy', 'Glossy', 'Happy', 'Hazy', 'Jolly', 'Jumpy', 'Kind', 'Lively', 'Lucky', 'Lunar', 'Merry', 'Misty', 'Mossy',
  'Nimble', 'Noble', 'Peppy', 'Perky', 'Plucky', 'Quick', 'Quiet', 'Rosy', 'Rusty', 'Salty', 'Shiny', 'Silver', 'Sleepy', 'Snappy', 'Sunny',
  'Swift', 'Tidal', 'Tiny', 'Twinkly', 'Velvet', 'Wavy', 'Wiggly', 'Witty', 'Zesty', 'Zippy'];
const NOUNS = ['Anchor', 'Barnacle', 'Biscuit', 'Bobbin', 'Button', 'Comet', 'Cobble', 'Cricket', 'Dumpling', 'Ember', 'Fig', 'Flint', 'Fritter',
  'Gizmo', 'Glimmer', 'Gumdrop', 'Hopper', 'Jellybean', 'Juniper', 'Kettle', 'Kipper', 'Lantern', 'Marble', 'Muffin', 'Nugget', 'Noodle',
  'Pebble', 'Pickle', 'Pip', 'Puddle', 'Quill', 'Ripple', 'Rocket', 'Scallop', 'Sprocket', 'Sprout', 'Tadpole', 'Thimble', 'Toffee',
  'Trinket', 'Tumble', 'Waffle', 'Whisker', 'Widget', 'Wobble', 'Zephyr'];
const KEY = 'ocean-fish-names';
const hash = text => [...String(text)].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
const initial = species => String(species ?? '').trim().charAt(0).toUpperCase();

/** A two-word name for `jobId`, alliterating with `species` where a word fits, and not in `taken`. `turn` rerolls. */
export function generateName(jobId, species, taken = [], turn = 0) {
  const used = new Set([...taken].map(n => String(n).toLowerCase()));
  const start = initial(species);
  const pick = list => { const same = list.filter(w => w.startsWith(start)); return same.length ? same : list; };
  const adjectives = pick(ADJECTIVES), nouns = pick(NOUNS);
  const all = adjectives.length * nouns.length;
  for (let k = 0; k < all * 3; k += 1) {
    const h = hash(`${jobId}:${turn}:${k}`);
    // Past every alliterating pair the full lists take over, so a name is always found.
    const [a, n] = k < all ? [adjectives, nouns] : [ADJECTIVES, NOUNS];
    const name = `${a[h % a.length]} ${n[(h >>> 12) % n.length]}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `${ADJECTIVES[hash(jobId) % ADJECTIVES.length]} ${NOUNS[hash(`${jobId}!`) % NOUNS.length]} ${used.size + 1}`;
}

/** Tidy a typed name: printable text only, single spaces, at most 24 characters. Empty means "use the generated one". */
export function cleanName(value) {
  return String(value ?? '').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function readAll(storage) {
  try { const all = JSON.parse(storage?.getItem(KEY) ?? '{}'); return all && typeof all === 'object' ? all : {}; } catch { return {}; }
}

/** The stored name for `jobId`, or a new unique generated one (stored straight away). */
export function nameFor(jobId, species, storage = null) {
  const all = readAll(storage);
  if (typeof all[jobId] === 'string' && all[jobId]) return all[jobId];
  const name = generateName(jobId, species, Object.values(all));
  saveName(jobId, name, storage);
  return name;
}

export function saveName(jobId, name, storage = null) {
  const all = readAll(storage);
  all[jobId] = name;
  try { storage?.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or blocked: the name lasts this visit */ }
}

/** Every stored name except `jobId`'s own, for uniqueness when rerolling. */
export function otherNames(jobId, storage = null) {
  const { [jobId]: _own, ...rest } = readAll(storage);
  return Object.values(rest);
}

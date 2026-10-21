// The generic sync assertion: after an OS swap, the shell on screen shows exactly the parent's world. It checks the
// visible shell, swaps to the other OS and checks it, then swaps back and checks again. "Shows" is
// OceanWorldAdapter.snapshot() (each shell's own projection of what it renders) deep-equal to
// OceanWorldModel.normalise(world). No case-, store- or scenario-specific code.
//   const problems = await assertSynced(s);   // s from openScene() in desktops-e2e-lib.mjs; [] when both shells match
// Each problem is one differing path: "<os> /<path>: shell … vs world …".
import { createRequire } from 'node:module';

const WM = createRequire(import.meta.url)('../../ui/desktop/world-model.js');

// Paths where two canonical values differ (at most `max`).
export function differences(a, b, at = '', out = [], max = 6) {
  if (out.length >= max || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${at}/${key}`, out, max);
  } else {
    out.push(`${at}: shell ${JSON.stringify(a)?.slice(0, 90)} vs world ${JSON.stringify(b)?.slice(0, 90)}`);
  }
  return out;
}

// Waits until the visible shell `os` renders the current world; returns the last differences.
async function visibleMatches(s, os, timeout) {
  const end = Date.now() + timeout;
  for (;;) {
    const [shown, world] = await Promise.all([s.frame(os).evaluate(() => window.OceanWorldAdapter.snapshot()), s.world()]);
    const diff = differences(shown, WM.normalise(world));
    if (!diff.length || Date.now() > end) return diff;
    await s.page.waitForTimeout(300);
  }
}

export async function assertSynced(s, timeout = 8000) {
  const first = await s.page.evaluate(() => document.body.dataset.os);
  const problems = [];
  for (const os of [first, first === 'windows' ? 'macos' : 'windows', first]) {
    if (await s.page.evaluate(() => document.body.dataset.os) !== os) await s.swap(os);
    const diff = await visibleMatches(s, os, timeout);
    for (const line of diff) if (!problems.includes(`${os} ${line}`)) problems.push(`${os} ${line}`);
  }
  return problems;
}

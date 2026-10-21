// Mock event source for development and tests. job.html?mock=<name> plays tests/fixtures/detonation/events/<name>.json
// instead of calling the network. It is refused unless the page is served from localhost.
//
// Fixture file: { jobId, events: [{id, event, data, delay?}], artifacts?: {name: {type, base64? | text?}} }
// `delay` (ms, fixture-only) is the pause before the event. `?speed=<n>` scales every delay and animation (default 1).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FIXTURE_NAME = /^[a-z0-9-]{1,40}$/;

export const isLocalHost = hostname => LOCAL_HOSTS.has(hostname);

const pause = (ms, signal) => new Promise(resolve => {
  if (ms <= 0 || signal?.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

function bytesOf(base64) {
  const raw = atob(base64);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export async function createMockSource(name, { speed = 1, fetchImpl = fetch } = {}) {
  if (!FIXTURE_NAME.test(name)) throw new Error('Unknown mock fixture.');
  const response = await fetchImpl(`/tests/fixtures/detonation/events/${name}.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Mock fixture "${name}" not found.`);
  const fixture = await response.json();
  const reportEvent = fixture.events.findLast(item => item.event === 'report');
  return {
    jobId: fixture.jobId,
    async stream(onEvent, signal) {
      for (const { delay = 0, ...event } of fixture.events) {
        await pause(delay * speed, signal);
        if (signal?.aborted) return;
        onEvent(event);
      }
    },
    async fetchJob() {
      return reportEvent ? { status: 'done', report: reportEvent.data } : { status: 'failed' };
    },
    async fetchArtifact(artifact) {
      const item = fixture.artifacts?.[artifact];
      if (!item) throw new Error('Artifact not found.');
      const part = item.base64 ? bytesOf(item.base64) : item.text;
      return { type: item.type, blob: new Blob([part], { type: item.type }) };
    },
  };
}

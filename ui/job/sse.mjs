// Fetch-based server-sent events (the built-in event-stream class cannot send an Authorization header) and the job API client.
// The bearer token is only ever placed in the Authorization header of same-origin /api/jobs/<id> requests.

export class SseParser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = '';
    this.fields = { event: '', data: [], id: undefined };
  }

  push(chunk) {
    this.buffer += chunk;
    const lines = /\r\n|\n|\r/g;
    let start = 0;
    for (let hit = lines.exec(this.buffer); hit; hit = lines.exec(this.buffer)) {
      // A trailing "\r" may be the first half of "\r\n": wait for the next chunk.
      if (hit[0] === '\r' && hit.index + 1 === this.buffer.length) break;
      this.line(this.buffer.slice(start, hit.index));
      start = hit.index + hit[0].length;
    }
    this.buffer = this.buffer.slice(start);
  }

  line(text) {
    if (text === '') return this.dispatch();
    if (text.startsWith(':')) return undefined;
    const colon = text.indexOf(':');
    const name = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'event') this.fields.event = value;
    else if (name === 'data') this.fields.data.push(value);
    else if (name === 'id' && !value.includes('\0')) this.fields.id = value;
    return undefined;
  }

  dispatch() {
    const { event, data, id } = this.fields;
    this.fields = { event: '', data: [], id: undefined };
    if (!data.length) return;
    let parsed;
    try { parsed = JSON.parse(data.join('\n')); } catch { return; } // a malformed event is dropped, not shown
    this.onMessage({ id: id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined, event: event || 'message', data: parsed });
  }
}

export class JobLinkError extends Error {
  constructor(status) {
    super(status === 401 || status === 403 || status === 404 ? 'This job link is invalid or has expired.' : `The server answered ${status}.`);
    this.status = status;
  }
}

const FATAL = new Set([400, 401, 403, 404]);

// One connection. Resolves when the server closes the stream; rejects with JobLinkError on an HTTP error.
export async function readEventStream({ url, token, lastEventId = 0, signal, onEvent, fetchImpl = fetch }) {
  const headers = { Accept: 'text/event-stream', Authorization: `Bearer ${token}` };
  if (lastEventId > 0) headers['Last-Event-ID'] = String(lastEventId);
  const response = await fetchImpl(url, { headers, signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new JobLinkError(response.status);
  const parser = new SseParser(onEvent);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
}

// Reads until the job reaches a terminal state, reconnecting with Last-Event-ID after a dropped connection.
export async function followEvents({ url, token, signal, onEvent, isTerminal, getLastEventId, fetchImpl, retryDelays = [500, 1500, 3000, 5000, 8000], sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await readEventStream({ url, token, lastEventId: getLastEventId(), signal, onEvent, fetchImpl });
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof JobLinkError && FATAL.has(error.status)) throw error;
      if (attempt >= retryDelays.length) throw error;
    }
    if (isTerminal()) return;
    if (attempt >= retryDelays.length) throw new Error('The event stream ended before the job finished.');
    await sleep(retryDelays[attempt]);
    if (signal?.aborted) return;
  }
}

const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ARTIFACT_NAME = /^[A-Za-z0-9._-]{1,80}$/;

export function createNetworkSource({ jobId, token, fetchImpl = fetch }) {
  if (!JOB_ID.test(jobId)) throw new JobLinkError(404);
  const base = `/api/jobs/${encodeURIComponent(jobId)}`;
  const get = (path, accept) => fetchImpl(`${base}${path}`, {
    headers: { Accept: accept, Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  return {
    jobId,
    stream: (onEvent, signal, isTerminal, getLastEventId) => followEvents({ url: `${base}/events`, token, signal, onEvent, isTerminal, getLastEventId, fetchImpl }),
    async fetchJob() {
      const response = await get('', 'application/json');
      if (!response.ok) throw new JobLinkError(response.status);
      return response.json();
    },
    async fetchArtifact(name) {
      if (!ARTIFACT_NAME.test(name)) throw new Error('Invalid artifact name.');
      const response = await get(`/artifacts/${encodeURIComponent(name)}`, '*/*');
      if (!response.ok) throw new JobLinkError(response.status);
      const blob = await response.blob();
      return { type: blob.type, blob };
    },
  };
}

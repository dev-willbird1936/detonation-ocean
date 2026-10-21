// Detonation Ocean inference client (SPEC §8, §7.3, §10). Vultr Serverless Inference only, no base-URL override.

export const INFERENCE_URL = 'https://api.vultrinference.com/v1/chat/completions';

const TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_COMPLETION_TOKENS = 4096;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_DAILY_CAP = 300;

export class InferenceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function readBoundedResponseBody(body) {
  let reader;
  const chunks = [];
  let size = 0;
  try {
    reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new InferenceError('request-failed');
      const nextSize = size + value.byteLength;
      if (nextSize > MAX_RESPONSE_BYTES) {
        try { await reader.cancel?.(); } catch {}
        throw new InferenceError('response-too-large');
      }
      chunks.push(Buffer.from(value));
      size = nextSize;
    }
  } catch (error) {
    if (error instanceof InferenceError) throw error;
    throw new InferenceError('request-failed');
  } finally {
    try { reader?.releaseLock?.(); } catch {}
  }
  return Buffer.concat(chunks, size);
}

// `complete(messages, {model: 'code' | 'vision'})` resolves to the reply text or throws InferenceError
// (`disabled`, `cap-reached`, `request-too-large`, `request-failed`, `http-error`, `response-too-large`, `invalid-response`).
export function createInferenceClient({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const key = env.VULTR_INFERENCE_API_KEY;
  const enabled = env.DETONATION_INFERENCE_ENABLED === 'true' && typeof key === 'string' && key.length > 0;
  const cap = Number.parseInt(env.DAILY_INFERENCE_CALL_CAP ?? '', 10);
  const dailyCap = Number.isInteger(cap) && cap >= 0 ? cap : DEFAULT_DAILY_CAP;
  const models = { code: env.VULTR_INFERENCE_CODE_MODEL, vision: env.VULTR_INFERENCE_VISION_MODEL };
  const reasoningEffort = env.VULTR_INFERENCE_REASONING_EFFORT;
  let day = '';
  let used = 0;

  function today() {
    const current = now().toISOString().slice(0, 10);
    if (current !== day) { day = current; used = 0; }
    return current;
  }

  function available(kind = 'code') {
    today();
    return enabled && Boolean(models[kind]) && typeof fetchImpl === 'function' && used < dailyCap;
  }

  async function complete(messages, { model = 'code' } = {}) {
    if (!available(model)) throw new InferenceError(enabled && used >= dailyCap ? 'cap-reached' : 'disabled');
    const payload = { model: models[model], temperature: 0.2, max_tokens: MAX_COMPLETION_TOKENS, messages };
    if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new InferenceError('request-too-large');
    used += 1;
    let response;
    try {
      response = await fetchImpl(INFERENCE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new InferenceError('request-failed');
    }
    if (!response || response.status !== 200) throw new InferenceError('http-error');
    let bytes;
    if (response.body === null) bytes = Buffer.alloc(0);
    else {
      if (!response.body || typeof response.body.getReader !== 'function') throw new InferenceError('http-error');
      bytes = await readBoundedResponseBody(response.body);
    }
    let content;
    try { content = JSON.parse(bytes.toString('utf8'))?.choices?.[0]?.message?.content; }
    catch { throw new InferenceError('invalid-response'); }
    if (typeof content !== 'string') throw new InferenceError('invalid-response');
    return content;
  }

  return { available, complete, get calls() { today(); return used; } };
}

import { createHash } from 'node:crypto';

// Host-only Vultr Serverless Inference vision check. No other provider, no base-URL override.

export const VULTR_INFERENCE_URL = 'https://api.vultrinference.com/v1/chat/completions';
export const VULTR_INFERENCE_APPROVAL = 'I_APPROVE_UP_TO_TEN_VULTR_INFERENCE_CHECKS_PER_PROCESS';
export const VISION_PASS_VERDICT = 'synthetic-allow-visible';
export const VISION_DENY_VERDICT = 'synthetic-deny-no-access-visible';

const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_SHOT_BYTES = 512 * 1024;
const EXPECTED_STAGES = ['desktop-before-optin', 'consent-ready', 'receipt'];
function fixedPrompt(decision) {
  const expected = decision === 'allow' ? VISION_PASS_VERDICT : VISION_DENY_VERDICT;
  const receipt = decision === 'allow' ? 'Simulate Allow with synthetic records exposed' : 'Simulate Deny with no token and no records accessed';
  return `You verify one synthetic OAuth training screenshot set. Reply with only {"verdict":"${expected}"} if the images show a fictional ${receipt} receipt, otherwise only {"verdict":"not-visible"}. Do not browse, execute code, or request secrets.`;
}

export function visionGate(env = process.env) {
  const key = env.VULTR_INFERENCE_API_KEY;
  const model = env.VULTR_INFERENCE_MODEL;
  const approved = env.VULTR_INFERENCE_APPROVAL === VULTR_INFERENCE_APPROVAL
    && typeof key === 'string' && key.length >= 8 && key.length <= 256
    && typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(model);
  return { approved, model: approved ? model : null };
}

function failed(reason, providerCall = 'not_made') {
  return {
    status: 'failed',
    provider: 'vultr-serverless-inference',
    providerCall,
    live: false,
    reason,
  };
}

function notRun(reason) {
  return {
    status: 'not_run',
    provider: 'vultr-serverless-inference',
    providerCall: 'not_made',
    live: false,
    reason,
  };
}

export function validateVisionScreenshots(screenshots) {
  if (!Array.isArray(screenshots) || screenshots.length !== EXPECTED_STAGES.length) return false;
  const stages = new Set();
  for (const shot of screenshots) {
    if (!shot || shot.mimeType !== 'image/jpeg' || !EXPECTED_STAGES.includes(shot.stage) || stages.has(shot.stage)) return false;
    if (typeof shot.base64 !== 'string' || typeof shot.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(shot.sha256)) return false;
    let bytes;
    try { bytes = Buffer.from(shot.base64, 'base64'); }
    catch { return false; }
    if (bytes.length < 4 || bytes.length > MAX_SHOT_BYTES || bytes.toString('base64') !== shot.base64) return false;
    if (!bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) || !bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) return false;
    if (createHash('sha256').update(bytes).digest('hex') !== shot.sha256) return false;
    stages.add(shot.stage);
  }
  return stages.size === EXPECTED_STAGES.length;
}

export async function verifyOAuthScreenshots({
  screenshots,
  decision = 'allow',
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  if (!['allow', 'deny'].includes(decision)) return failed('invalid_decision');
  const gate = visionGate(env);
  if (!gate.approved) return notRun('approval_or_model_missing');
  if (!validateVisionScreenshots(screenshots)) return failed('invalid_screenshots');
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > TIMEOUT_MS) {
    return failed('invalid_verifier');
  }

  const payload = {
    model: gate.model,
    temperature: 0,
    max_tokens: 40,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `${fixedPrompt(decision)}\nsha256:\n${screenshots.map(shot => shot.sha256).join('\n')}` },
        ...screenshots.map(shot => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot.base64}` } })),
      ],
    }],
  };
  const body = JSON.stringify(payload);
  if (body.includes(env.VULTR_INFERENCE_API_KEY)) return failed('secret_in_request');

  let response;
  try {
    response = await fetchImpl(VULTR_INFERENCE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.VULTR_INFERENCE_API_KEY}`,
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return failed('provider_request_failed', 'failed');
  }
  if (!response || response.status !== 200 || typeof response.arrayBuffer !== 'function') {
    return failed('provider_http_error', 'failed');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_RESPONSE_BYTES) return failed('response_too_large', 'failed');

  let content;
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    content = parsed?.choices?.[0]?.message?.content;
  } catch {
    return failed('invalid_provider_json', 'completed');
  }
  if (typeof content !== 'string') return { status: 'failed', provider: 'vultr-serverless-inference', providerCall: 'completed', live: true, reason: 'invalid_provider_json' };
  let verdict;
  try { verdict = JSON.parse(content.trim()); }
  catch { return { status: 'failed', provider: 'vultr-serverless-inference', providerCall: 'completed', live: true, reason: 'verdict_rejected' }; }
  const expectedVerdict = decision === 'allow' ? VISION_PASS_VERDICT : VISION_DENY_VERDICT;
  if (!verdict || Object.keys(verdict).length !== 1 || verdict.verdict !== expectedVerdict) {
    return { status: 'failed', provider: 'vultr-serverless-inference', providerCall: 'completed', live: true, reason: 'verdict_rejected' };
  }
  return { status: 'passed', provider: 'vultr-serverless-inference', providerCall: 'completed', live: true, reason: null };
}

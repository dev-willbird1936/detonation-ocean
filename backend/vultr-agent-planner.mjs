import { VULTR_INFERENCE_URL, visionGate } from './vultr-inference.mjs';
import { OCEAN_PROFILE_ACTIONS } from './ocean-profile-simulation.mjs';

// Host-only Vultr Serverless Inference planner. The model may only echo one fixed action ID
// for one catalogued profile; it never supplies commands, URLs, credentials or free text.

const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 16_384;
const NO_ACTION = 'none';

function result(status, reason, extra = {}) {
  return { status, provider: 'vultr-serverless-inference', providerCall: 'not_made', live: false, actionId: null, reason, ...extra };
}

export function allowedPlannerActions(depthId) {
  const action = OCEAN_PROFILE_ACTIONS[depthId];
  return action ? [action.id ?? NO_ACTION] : [];
}

export async function planProfileAction({
  profile,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const allowed = allowedPlannerActions(profile?.depthId);
  if (allowed.length === 0 || typeof profile.familyId !== 'string') return result('failed', 'invalid_profile');
  const gate = visionGate(env);
  if (!gate.approved) return result('not_run', 'approval_or_model_missing');
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > TIMEOUT_MS) {
    return result('failed', 'invalid_planner');
  }

  const body = JSON.stringify({
    model: gate.model,
    temperature: 0,
    max_tokens: 30,
    messages: [{
      role: 'user',
      content: `You plan one step of a fictional, synthetic security-awareness simulation (family "${profile.familyId}", depth "${profile.depthId}"). Reply with only {"actionId":"<id>"} where <id> is exactly one of: ${allowed.join(', ')}. Do not add commands, URLs, credentials or other text.`,
    }],
  });

  let response;
  try {
    response = await fetchImpl(VULTR_INFERENCE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.VULTR_INFERENCE_API_KEY}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return result('failed', 'provider_request_failed', { providerCall: 'failed' });
  }
  if (!response || response.status !== 200 || typeof response.arrayBuffer !== 'function') {
    return result('failed', 'provider_http_error', { providerCall: 'failed' });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_RESPONSE_BYTES) return result('failed', 'response_too_large', { providerCall: 'failed' });

  const completed = { providerCall: 'completed', live: true };
  let content;
  try { content = JSON.parse(bytes.toString('utf8'))?.choices?.[0]?.message?.content; }
  catch { return result('failed', 'invalid_provider_json', completed); }
  if (typeof content !== 'string') return result('failed', 'invalid_provider_json', completed);
  let plan;
  try { plan = JSON.parse(content.trim()); }
  catch { return result('failed', 'plan_rejected', completed); }
  if (!plan || Object.keys(plan).length !== 1 || !allowed.includes(plan.actionId)) {
    return result('failed', 'plan_rejected', completed);
  }
  return result('planned', null, { ...completed, actionId: plan.actionId === NO_ACTION ? null : plan.actionId });
}

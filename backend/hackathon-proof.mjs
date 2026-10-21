import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBrowserOAuthInContainer } from './browser-container.mjs';
import { verifyOAuthScreenshots } from './vultr-inference.mjs';

export const HACKATHON_PROOF_SCENARIO = 'oauth-2023';
export const HACKATHON_PROOF_PERSONA = 'persona-game-001';
const DECISIONS = new Set(['allow', 'deny']);
export const REQUIRED_DOCKERFILE_LINES = [
  'COPY backend/ ./backend/',
  'COPY data/personas.json ./data/personas.json',
  'COPY data/training-scenarios.json ./data/training-scenarios.json',
  'COPY data/ocean-taxonomy.json ./data/ocean-taxonomy.json',
  'COPY server.mjs ./server.mjs',
  'COPY chamber.html ./chamber.html',
  'COPY ui/desktop/ ./ui/desktop/',
  'COPY ocean-style-prototypes/retrodiffusion-creature-animation/manifest.json ./ocean-style-prototypes/retrodiffusion-creature-animation/manifest.json',
  'COPY ocean-style-prototypes/retrodiffusion-creature-animation/animations/*-256.gif ./ocean-style-prototypes/retrodiffusion-creature-animation/animations/',
  'ENV ENABLE_TEMPLATE_DESKTOPS=false',
];
export const REQUIRED_IMAGE_SOURCES = [
  'backend/browser-runner-entry.mjs',
  'backend/training-session.mjs',
  'backend/ocean-profiles.mjs',
  'backend/ocean-profile-simulation.mjs',
  'server.mjs',
  'data/personas.json',
  'data/training-scenarios.json',
  'data/ocean-taxonomy.json',
  'ocean-style-prototypes/retrodiffusion-creature-animation/manifest.json',
  'ocean-style-prototypes/retrodiffusion-creature-animation/animations/anglerfish-sunlight-256.gif',
  'ui/desktop/index.html',
  'ui/desktop/ocean-profiles.html',
  'ui/desktop/ocean-profiles.js',
  'ui/desktop/ocean-profiles.css',
  'ui/desktop/ocean-entry.html',
  'ui/desktop/ocean-entry.css',
  'ui/desktop/ocean-entry.js',
  'chamber.html',
  'deploy/browser/Dockerfile',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function notRunVision() {
  return {
    status: 'not_run',
    provider: 'vultr-serverless-inference',
    providerCall: 'not_made',
    live: false,
    reason: 'execution_not_ready',
  };
}

function report(fields) {
  const evidenceClass = fields.evidenceClass || 'host-docker';
  const vision = fields.vision || notRunVision();
  return {
    schemaVersion: 1,
    pattern: 'B',
    scenarioId: HACKATHON_PROOF_SCENARIO,
    decision: DECISIONS.has(fields.decision) ? fields.decision : 'allow',
    contractMet: fields.contractMet === true,
    submissionValid: false,
    submissionGap: 'This slice is not a Vultr VM deployment, public URL, or GitHub submission.',
    evidenceClass,
    labels: {
      injectedResultsAreTestEvidence: evidenceClass === 'injected',
      hostDockerIsNotVultr: true,
      visionLiveProof: evidenceClass === 'host-docker' && vision.live === true && vision.status === 'passed',
    },
    containerTeardown: fields.containerTeardown || 'not_started',
    exposedMessageCount: fields.exposedMessageCount ?? null,
    tokenIssued: fields.tokenIssued ?? null,
    screenshotStages: fields.screenshotStages || [],
    vision,
    ...(Array.isArray(fields.screenshots) ? { screenshots: fields.screenshots } : {}),
    error: fields.error || null,
    vultrCompute: 'not_run',
    oceanDesktop: 'out_of_scope',
  };
}

export function checkBrowserImagePackaging(repoRoot = root) {
  const dockerfilePath = join(repoRoot, 'deploy/browser/Dockerfile');
  const missingSources = REQUIRED_IMAGE_SOURCES.filter(relative => !existsSync(join(repoRoot, relative)));
  let missingLines = REQUIRED_DOCKERFILE_LINES;
  if (existsSync(dockerfilePath)) {
    const text = readFileSync(dockerfilePath, 'utf8');
    missingLines = REQUIRED_DOCKERFILE_LINES.filter(line => !text.includes(line));
  }
  return { ok: missingSources.length === 0 && missingLines.length === 0, missingSources, missingLines };
}

function executionReady(execution, decision) {
  const receipt = execution?.receipt;
  const stages = Array.isArray(execution?.screenshots) ? execution.screenshots.map(shot => shot.stage) : [];
  const allowed = decision === 'allow';
  const expectedStatus = allowed ? 'complete' : 'denied';
  const ready = execution?.ok === true && execution.status === expectedStatus && execution.decision === decision &&
    execution?.containerTeardown === 'confirmed' && receipt?.status === expectedStatus &&
    receipt?.scenarioId === HACKATHON_PROOF_SCENARIO && receipt?.decision === decision &&
    receipt?.personaId === HACKATHON_PROOF_PERSONA && receipt?.tokenIssued === allowed &&
    Number.isInteger(receipt?.exposedMessageCount) &&
    (allowed ? receipt.exposedMessageCount > 0 : receipt.exposedMessageCount === 0) && stages.length === 3;
  return { ready, stages, receipt };
}

export async function runHackathonPatternB({
  optIn,
  containerOptIn,
  inferenceAcknowledged,
  decision = 'allow',
  includeScreenshots = false,
  evidenceClass = 'host-docker',
  runContainer = runBrowserOAuthInContainer,
  verifyVision = verifyOAuthScreenshots,
  env = process.env,
} = {}) {
  if (!['host-docker', 'injected'].includes(evidenceClass)) {
    return report({ evidenceClass: 'host-docker', decision, error: 'invalid_evidence_class' });
  }
  if (optIn !== true || containerOptIn !== true || inferenceAcknowledged !== true) {
    return report({ evidenceClass, decision, error: 'explicit_opt_in_required' });
  }
  if (!DECISIONS.has(decision)) return report({ evidenceClass, decision, error: 'invalid_decision' });

  let execution;
  try {
    execution = await runContainer({
      optIn: true,
      decision,
      personaId: HACKATHON_PROOF_PERSONA,
    });
  } catch (error) {
    return report({
      evidenceClass,
      decision,
      containerTeardown: error?.containerTeardown || 'unconfirmed',
      error: typeof error?.code === 'string' ? error.code : 'container_run_failed',
    });
  }

  const checked = executionReady(execution, decision);
  if (!checked.ready) {
    return report({
      evidenceClass,
      decision,
      containerTeardown: execution?.containerTeardown || 'unconfirmed',
      exposedMessageCount: checked.receipt?.exposedMessageCount ?? null,
      tokenIssued: checked.receipt?.tokenIssued ?? null,
      screenshotStages: checked.stages,
      error: 'execution_evidence_rejected',
    });
  }

  let vision;
  try {
    vision = await verifyVision({ screenshots: execution.screenshots, decision, env });
  } catch {
    vision = { status: 'failed', provider: 'vultr-serverless-inference', providerCall: 'failed', live: false, reason: 'verifier_threw' };
  }
  const contractMet = evidenceClass === 'host-docker' && vision?.status === 'passed' &&
    vision.providerCall === 'completed' && vision.live === true;
  return report({
    evidenceClass,
    decision,
    contractMet,
    containerTeardown: 'confirmed',
    exposedMessageCount: checked.receipt.exposedMessageCount,
    tokenIssued: checked.receipt.tokenIssued,
    screenshotStages: checked.stages,
    ...(includeScreenshots ? { screenshots: execution.screenshots } : {}),
    vision,
    error: contractMet ? null : 'vision_not_passed',
  });
}

// Receipt (docs/SPEC.md 7.5): built from container records and the teardown result, validated before it is shown.
// A job is `done` only if teardownConfirmed and the host canary is unchanged.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EXIT_REASONS, LIMITS, ROLES, ROLE_RUNTIME, pidsLimitFor } from './containers.mjs';

export const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex');

/** `unchanged` only when both hashes exist and match. */
export const compareCanary = (before, after) => (before && before === after ? 'unchanged' : 'changed');

export const WINE_NOTE = 'Ran under Wine without gVisor: runc with the verified Wine seccomp profile, no network, read-only root and dropped capabilities. AppArmor status is recorded for each Wine container; unavailable means no AppArmor protection.';

/**
 * `containers` are `verifyIsolation` records plus `exit: {code, reason}` (`classifyExit`).
 * `teardown` is the `teardown(jobId)` result; the home volume counts as removed when teardown is confirmed.
 * A receipt with a `wine` container carries `notes: [WINE_NOTE]`.
 */
export function buildReceipt({ jobId, containers, teardown, uploadDeleted, hostCanary, inference }) {
  return {
    jobId,
    containers: containers.map(({ role, runtime, network, readOnlyRoot, capDrop, user, memoryBytes, pidsLimit, nanoCpus, secretEnvVars, createdAt, exit, appArmor }) =>
      ({ role, runtime, network, readOnlyRoot, capDrop, user, memoryBytes, pidsLimit, nanoCpus, secretEnvVars, createdAt, exit, removedAt: teardown.removedAt, ...(role === 'wine' ? { appArmor } : {}) })),
    limitsHit: [...new Set(containers.map(container => container.exit?.reason).filter(Boolean))],
    volumesRemoved: teardown.confirmed,
    uploadDeleted,
    hostCanary,
    teardownConfirmed: teardown.confirmed,
    inference,
    ...(containers.some(container => container.role === 'wine') ? { notes: [WINE_NOTE] } : {}),
  };
}

/** `{ok, problems}`: the receipt must show the 6.3 limits on every container and agree with itself. */
export function validateReceipt(receipt) {
  const problems = [];
  const bad = name => problems.push(name);
  if (typeof receipt?.jobId !== 'string' || !receipt.jobId) bad('jobId');
  const containers = Array.isArray(receipt?.containers) ? receipt.containers : [];
  if (!containers.length) bad('containers');
  containers.forEach((c, index) => {
    const at = field => bad(`containers[${index}].${field}`);
    if (!ROLES.includes(c?.role)) at('role');
    if (c?.runtime !== ROLE_RUNTIME[c?.role]) at('runtime');
    if (c?.role === 'wine' && !['docker-default', 'unavailable'].includes(c?.appArmor)) at('appArmor');
    if (c?.network !== 'none') at('network');
    if (c?.readOnlyRoot !== true) at('readOnlyRoot');
    if (!Array.isArray(c?.capDrop) || !c.capDrop.includes('ALL')) at('capDrop');
    if (c?.user !== LIMITS.user) at('user');
    if (c?.memoryBytes !== LIMITS.memoryBytes) at('memoryBytes');
    if (c?.pidsLimit !== pidsLimitFor(c?.role)) at('pidsLimit');
    if (c?.nanoCpus !== LIMITS.nanoCpus) at('nanoCpus');
    if (c?.secretEnvVars !== 0) at('secretEnvVars');
    if (typeof c?.createdAt !== 'string') at('createdAt');
    if (!Number.isInteger(c?.exit?.code) || ![null, ...EXIT_REASONS].includes(c.exit.reason)) at('exit');
    if (receipt.teardownConfirmed === true ? typeof c?.removedAt !== 'string' : c?.removedAt != null) at('removedAt');
  });
  const hit = new Set(containers.map(c => c?.exit?.reason).filter(Boolean));
  if (!Array.isArray(receipt?.limitsHit) || receipt.limitsHit.length !== hit.size
    || !receipt.limitsHit.every(reason => hit.has(reason)) || [...hit].some(reason => !receipt.limitsHit.includes(reason))) bad('limitsHit');
  for (const field of ['volumesRemoved', 'uploadDeleted', 'teardownConfirmed']) if (typeof receipt?.[field] !== 'boolean') bad(field);
  if (!['unchanged', 'changed'].includes(receipt?.hostCanary)) bad('hostCanary');
  if (receipt?.volumesRemoved === true && receipt.teardownConfirmed !== true) bad('volumesRemoved');
  if (typeof receipt?.inference?.provider !== 'string' || !Number.isInteger(receipt.inference.calls)) bad('inference');
  return { ok: problems.length === 0, problems };
}

/**
 * True only for a valid receipt with confirmed teardown, a deleted upload and an unchanged host canary. A finished job
 * always ran detonate and collect, so both must appear (analyse runs a container only when the model wrote a script).
 */
export const receiptAllowsDone = receipt => validateReceipt(receipt).ok && receipt.teardownConfirmed === true && receipt.uploadDeleted === true
  && receipt.hostCanary === 'unchanged' && ['detonate', 'collect'].every(role => receipt.containers.some(c => c.role === role));

// Answers the docker calls that the job controller makes for its seed and holder containers (create, container inspect, start),
// for tests whose fake daemon has no Docker behind it. The inspect JSON is the real `docker inspect` capture of that role
// (tests/fixtures/detonation/inspect), with only what `create` set per container swapped in: name, labels and mounts. So
// `verifyIsolation` still checks every other flag, the pinned image and the mounts the arguments asked for.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const captures = new Map();
const capture = role => {
  if (!captures.has(role)) captures.set(role, JSON.parse(readFileSync(new URL(`./inspect/${role}.json`, import.meta.url), 'utf8'))[0]);
  return structuredClone(captures.get(role));
};
const valuesOf = (args, flag) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []));
const parseMount = text => Object.fromEntries(text.split(',').map(part => (part.includes('=') ? part.split(/=(.*)/s).slice(0, 2) : [part, true])));

function inspectOf(args) {
  const name = args[args.indexOf('--name') + 1];
  const labels = Object.fromEntries(valuesOf(args, '--label').map(label => label.split(/=(.*)/s).slice(0, 2)));
  const container = capture(labels['detonation-ocean.role']);
  const mounts = valuesOf(args, '--mount').map(parseMount);
  container.Id = createHash('sha256').update(name).digest('hex');
  container.Name = `/${name}`;
  container.Config.Labels = labels;
  container.Mounts = mounts.map(mount => (mount.type === 'volume'
    ? { Type: 'volume', Name: mount.src, Source: `/var/lib/docker/volumes/${mount.src}/_data`, Destination: mount.dst, Driver: 'local', Mode: 'z', RW: !mount.readonly, Propagation: '' }
    : { Type: 'bind', Source: mount.src, Destination: mount.dst, Mode: '', RW: !mount.readonly, Propagation: 'rprivate' }));
  container.HostConfig.Mounts = mounts.map(mount => ({ Type: mount.type, Source: mount.src, Target: mount.dst, ...(mount.readonly ? { ReadOnly: true } : {}) }));
  return { name, labels, container };
}

/**
 * `state.containers` is the fake daemon's list of `{id, labels}`. Returns the docker result for `create`, `container inspect <name>`
 * and `start [-a] <name>`, or undefined for any other call. `state.created` maps container names to their inspect JSON.
 */
export function answerContainerCall(args, state) {
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', timedOut: false, truncated: false });
  state.created ??= new Map();
  if (args[0] === 'create') {
    const { name, labels, container } = inspectOf(args);
    state.created.set(name, JSON.stringify([container]));
    state.containers.push({ id: container.Id, labels, created: '2026-01-01T00:00:00Z' });
    return ok(`${container.Id}\n`);
  }
  if (args[0] === 'container' && args[1] === 'inspect' && args.length === 3) {
    const json = state.created.get(args[2]);
    return json ? ok(json) : { code: 1, stdout: '', stderr: `Error: No such container: ${args[2]}`, timedOut: false, truncated: false };
  }
  if (args[0] === 'start') return ok();
  return undefined;
}

// Records `wine.json`: the `docker inspect` of a created (never started) wine container, built from the controller's own argument list.
// Run where Docker and gVisor run (the WSL distro), as root, after build-images.sh: `node tests/fixtures/detonation/inspect/record-wine.mjs`.
// It makes the job directory the fixtures use (/var/lib/detonation-ocean/jobs/j-abc123), creates the container and removes everything again.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContainerArgs, homeVolumeName } from '../../../../backend/detonation/containers.mjs';

const jobId = 'j-abc123';
const jobDir = '/var/lib/detonation-ocean/jobs/j-abc123';
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

mkdirSync(jobDir, { recursive: true });
writeFileSync(`${jobDir}/sample.bin`, 'x');
try {
  const created = docker(...buildContainerArgs({ jobId, role: 'wine', image: 'detonation-ocean/wine', jobDir }));
  if (created.status !== 0) throw new Error(created.stderr);
  const inspected = docker('container', 'inspect', `do-${jobId}-wine-i0-a1`);
  if (inspected.status !== 0) throw new Error(inspected.stderr);
  writeFileSync(fileURLToPath(new URL('./wine.json', import.meta.url)), `${JSON.stringify(JSON.parse(inspected.stdout), null, 2)}\n`);
  console.log('recorded wine.json');
} finally {
  docker('rm', '-f', '-v', `do-${jobId}-wine-i0-a1`);
  docker('volume', 'rm', homeVolumeName(jobId));
  rmSync(jobDir, { recursive: true, force: true });
}

// A fetch replacement that relays the guest-control requests of PrivateGuestTransport through the in-VPC controller
// host (reached over SSH): the guest is private-only, so only a host inside the VPC can reach it. The relay runs
// `curl` on the controller against one exact private URL and returns a minimal Response-like object.
import { spawn } from 'node:child_process';

const URL_RE = /^http:\/\/(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}:4174\/internal\/(?:attestation|idp\/issue|mailbox\/read|teardown|sandbox\/run)$/;
const AUTH_RE = /^Bearer ctl_[A-Za-z0-9_-]{32,80}$/;

export function sshOptions({ keyPath, knownHostsPath }) {
  return [
    '-i', keyPath, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHostsPath}`, '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=5',
  ];
}

export function buildRelayScript({ url, authorization, body }) {
  if (!URL_RE.test(url)) throw new Error('Relay target must be a private guest control URL.');
  if (!AUTH_RE.test(authorization)) throw new Error('Relay authorization must be a guest control token.');
  if (typeof body !== 'string' || /^BRZ_BODY$/m.test(body)) throw new Error('Relay body is invalid.');
  return [
    `curl -sS -m 9 -X POST -H 'Authorization: ${authorization}' -H 'Content-Type: application/json' --data-binary @- -w '\\n%{http_code}' '${url}' <<'BRZ_BODY'`,
    body,
    'BRZ_BODY',
    '',
  ].join('\n');
}

export function createSshGuestFetch({ controllerHost, keyPath, knownHostsPath, spawnImpl = spawn }) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(controllerHost)) throw new Error('controllerHost must be an IPv4 address.');
  return async (url, init = {}) => {
    const script = buildRelayScript({ url: String(url), authorization: init.headers?.Authorization ?? '', body: init.body ?? '' });
    const child = spawnImpl('ssh', [...sshOptions({ keyPath, knownHostsPath }), `root@${controllerHost}`, 'bash -s'], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.resume();
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => resolve(code));
    });
    init.signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    child.stdin.end(script);
    const code = await done;
    const split = stdout.lastIndexOf('\n');
    const status = Number(stdout.slice(split + 1).trim());
    if (code !== 0 || !Number.isInteger(status) || status < 100) throw new Error('Controller relay failed.');
    const text = stdout.slice(0, split);
    return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) };
  };
}

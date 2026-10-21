import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { loadAbyssAssets } from '../backend/abyss-assets.mjs';

const root = process.cwd();
const screenshotAllowlist = new Set([
  'docs/evidence/browser-desktop.png',
  'docs/evidence/browser-mobile-drawer.png',
  'docs/evidence/browser-oauth-plan-mobile.png',
  'docs/evidence/browser-oauth-allow-mobile.png',
  'docs/evidence/browser-oauth-deny-mobile.png',
]);
const riskyExtensions = new Set([
  '.apk', '.appx', '.bin', '.cab', '.class', '.cmd', '.com', '.crx', '.deb', '.dll', '.dmg',
  '.dylib', '.elf', '.exe', '.gz', '.hta', '.img', '.ipa', '.iso', '.jar', '.key', '.msi',
  '.msp', '.msix', '.pcap', '.pcapng', '.pem', '.pl', '.pkg', '.ps1', '.py', '.pyc', '.rar',
  '.scr', '.sh', '.so', '.svg', '.tar', '.vbs', '.vhd', '.vhdx', '.vmdk', '.war', '.wasm',
  '.xlsm', '.xpi', '.zip', '.7z',
]);
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/,
  /\bBearer\s+eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/i,
];
const secretAssignmentPattern = /\b(?:[A-Z0-9]+_)?(?:api[_-]?key|client[_-]?secret|secret|password|private[_-]?key|(?:access|refresh)[_-]?token)\b\s*[:=]\s*['"]?([^'"\s;]{20,})/gi;
const placeholderSecretPattern = /^(?:mock|test|fake|synthetic|example|placeholder|dummy)(?:[-_ ]|$)|(?:not[-_ ]a[-_ ]real|never-stored|not-accepted)/i;
const blobPatterns = [
  /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{180,}={0,2}(?![A-Za-z0-9+/])/g,
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{180,}(?![A-Za-z0-9_-])/g,
  /(?<![0-9a-f])[0-9a-f]{200,}(?![0-9a-f])/gi,
  /data:[^,;]+(?:;[^,]*)?,[A-Za-z0-9%+/=_-]{1024,}/i,
];
const dependencyManifestNames = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock',
  'requirements.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'Cargo.toml', 'Cargo.lock',
  'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock',
]);
const builtinNames = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));
const runtimeRoots = new Set(['backend', 'deploy', 'src', 'tests', 'tools']);
const runtimeFiles = new Set(['server.mjs', 'build.mjs']);
const allowedNetworkHosts = new Set([
  '127.0.0.1', 'localhost', 'api.vultr.com', 'guest.local',
  'example.invalid', '10.10.0.20', '203.0.113.8',
]);
const allowedRuntimeIPv4 = new Map([
  ['0.0.0.0', 'unspecified bind/no-public-address test sentinel'],
  ['10.10.0.0', 'RFC1918 mock VPC CIDR'],
  ['10.10.0.1', 'non-canonical VPC CIDR rejection test fixture'],
  ['10.10.0.2', 'RFC1918 controller test fixture'],
  ['10.10.0.20', 'RFC1918 guest test fixture'],
  ['10.11.0.20', 'out-of-CIDR rejection test fixture'],
  ['010.10.0.0', 'non-canonical CIDR rejection test fixture'],
  ['010.10.0.2', 'non-canonical IPv4 rejection test fixture'],
  ['127.0.0.1', 'loopback listener/test origin'],
  ['169.254.169.254', 'link-local metadata bootstrap exception; removed before runtime attestation'],
  ['198.51.100.9', 'RFC5737 TEST-NET-2 rejected public-IP fixture'],
  ['203.0.113.8', 'RFC5737 TEST-NET-3 rejected public-target fixture'],
]);

function posixPath(value) {
  return value.split(path.sep).join('/');
}

async function walk(directory, files, symlinks, specialEntries, directories) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = posixPath(path.relative(root, absolute));
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      symlinks.push(relative);
    } else if (info.isDirectory()) {
      directories.push(relative);
      await walk(absolute, files, symlinks, specialEntries, directories);
    } else if (info.isFile()) {
      files.push({ absolute, relative, size: info.size });
    } else {
      specialEntries.push(relative);
    }
  }
}

function fileKind(buffer) {
  const starts = (...bytes) => buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'PNG';
  if (starts(0xff, 0xd8, 0xff)) return 'JPEG';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'GIF';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'WebP';
  if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'glTF' && buffer.readUInt32LE(4) === 2 && buffer.readUInt32LE(8) === buffer.length && buffer.readUInt32LE(16) === 0x4e4f534a) return 'GLB';
  if (buffer.toString('ascii', 0, 4) === 'wOFF') return 'WOFF';
  if (buffer.toString('ascii', 0, 5) === '%PDF-') return 'PDF';
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06) || starts(0x50, 0x4b, 0x07, 0x08)) return 'ZIP';
  if (starts(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return '7-Zip';
  if (starts(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)) return 'RAR';
  if (starts(0x1f, 0x8b)) return 'GZIP';
  if (starts(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00)) return 'XZ';
  if (starts(0x4d, 0x53, 0x43, 0x46)) return 'CAB';
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'OLE compound document';
  if (buffer.toString('ascii', 0, 8) === '!<arch>\n') return 'AR archive';
  if (buffer.length >= 262 && buffer.toString('ascii', 257, 262) === 'ustar') return 'TAR';
  if (buffer.length >= 32774 && buffer.toString('ascii', 32769, 32774) === 'CD001') return 'ISO 9660';
  if (starts(0x7f, 0x45, 0x4c, 0x46)) return 'ELF';
  if (buffer.toString('ascii', 0, 2) === 'MZ') return 'PE/DOS executable';
  if ([0xfe, 0xed, 0xfa, 0xce].every((byte, i) => buffer[i] === byte) ||
      [0xce, 0xfa, 0xed, 0xfe].every((byte, i) => buffer[i] === byte) ||
      [0xcf, 0xfa, 0xed, 0xfe].every((byte, i) => buffer[i] === byte)) return 'Mach-O';
  if (starts(0x00, 0x61, 0x73, 0x6d)) return 'WebAssembly';
  if (starts(0xca, 0xfe, 0xba, 0xbe)) return 'Java class';
  if (buffer.toString('ascii', 0, 16) === 'SQLite format 3\u0000') return 'SQLite';
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/.test(text) ? 'unknown binary' : 'UTF-8 text';
  } catch {
    return 'unknown binary';
  }
}

function isRuntimeFile(relative) {
  if (relative === 'tools/scan-safety.mjs') return false;
  const first = relative.split('/')[0];
  return runtimeFiles.has(relative) || runtimeRoots.has(first);
}

const files = [], directories = [], symlinks = [], specialEntries = [];
await walk(root, files, symlinks, specialEntries, directories);
files.sort((a, b) => a.relative.localeCompare(b.relative));

const unexpectedBinary = [];
const riskyExtensionFiles = [];
const credentialFindings = [];
const blobFindings = [];
const dependencyManifests = [];
const declaredDependencies = [];
const thirdPartyImports = [];
const approvedContainerImports = [];
const approvedQaImports = [];
const runtimeNetworkReferences = [];
const runtimeIPv4Literals = [];
const unexpectedRuntimeIPv4 = [];
const unexpectedNetworkHosts = [];
const rejectedOriginFixtures = [];
const fileKinds = {};
const approvedImages = [];
const approvedRenderingAssets = [], renderingManifestErrors = [];
let renderingAssets = new Map();
try { renderingAssets = loadAbyssAssets(root); } catch (e) { renderingManifestErrors.push(e.message); }
const renderingKinds = { '.woff':'WOFF', '.glb':'GLB', '.jpg':'JPEG', '.jpeg':'JPEG', '.png':'PNG', '.webp':'WebP', '.js':'UTF-8 text', '.css':'UTF-8 text', '.html':'UTF-8 text', '.json':'UTF-8 text', '.txt':'UTF-8 text', '.md':'UTF-8 text' };

for (const file of files) {
  const ext = path.extname(file.relative).toLowerCase();
  const buffer = await readFile(file.absolute);
  const kind = fileKind(buffer);
  fileKinds[kind] = (fileKinds[kind] || 0) + 1;
  const reviewedRenderer = renderingAssets.has('/' + file.relative) && renderingKinds[ext] === kind;
  if (reviewedRenderer) {
    approvedRenderingAssets.push({ path:file.relative, bytes:file.size, kind });
    if (kind === 'GLB') {
      try {
        const json = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
        if ([...(json.buffers || []), ...(json.images || [])].some(v => v.uri)) renderingManifestErrors.push('GLB must embed its buffers and images: ' + file.relative);
      } catch { renderingManifestErrors.push('Invalid GLB JSON: ' + file.relative); }
    }
  }

  if (riskyExtensions.has(ext)) riskyExtensionFiles.push({ path: file.relative, extension: ext, kind });
  if (kind !== 'UTF-8 text') {
    if (reviewedRenderer) {
      // Only exact manifest paths, hashes and recognized graphics signatures are approved. No general binary exemption.
    } else if (kind === 'PNG' && screenshotAllowlist.has(file.relative)) {
      approvedImages.push({ path: file.relative, bytes: file.size, kind });
    } else {
      unexpectedBinary.push({ path: file.relative, bytes: file.size, kind, reason: 'binary file is not an allowlisted verification screenshot' });
    }
    continue;
  }

  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  for (const pattern of credentialPatterns) {
    if (pattern.test(text)) credentialFindings.push({ path: file.relative, marker: pattern.source });
  }
  secretAssignmentPattern.lastIndex = 0;
  for (const match of text.matchAll(secretAssignmentPattern)) {
    if (!placeholderSecretPattern.test(match[1])) {
      credentialFindings.push({ path: file.relative, marker: secretAssignmentPattern.source });
    }
  }
  for (const pattern of blobPatterns) {
    // Known, integrity-checked browser bundles contain the trusted mesh decoder. Credential checks above remain active.
    if (reviewedRenderer && ext === '.js') continue;
    pattern.lastIndex = 0;
    if (pattern.test(text)) blobFindings.push({ path: file.relative, reason: pattern.source });
  }

  if (dependencyManifestNames.has(path.basename(file.relative))) {
    dependencyManifests.push(file.relative);
    if (path.basename(file.relative) === 'package.json') {
      try {
        const manifest = JSON.parse(text);
        for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
          for (const name of Object.keys(manifest[section] || {})) declaredDependencies.push({ path: file.relative, section, name });
        }
      } catch {
        declaredDependencies.push({ path: file.relative, error: 'invalid package.json' });
      }
    }
  }
  if (file.relative.endsWith('.mjs')) {
    const imports = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
    for (const match of text.matchAll(imports)) {
      const specifier = match[1];
      const rootName = specifier.replace(/^node:/, '').split('/')[0];
      if (!specifier.startsWith('node:') && !specifier.startsWith('.') && !builtinNames.has(rootName)) {
        const entry = { path: file.relative, specifier };
        if (file.relative === 'backend/browser-runner-entry.mjs' && specifier === 'playwright') {
          approvedContainerImports.push(entry);
        } else if (file.relative === '.pi/ocean-check.mjs' && specifier === 'C:/Users/warcr/AppData/Roaming/npm/node_modules/promptfoo/node_modules/playwright-core') {
          // Existing file-only 2D browser QA uses the harness installation, not an application dependency.
          approvedQaImports.push(entry);
        } else {
          thirdPartyImports.push(entry);
        }
      }
    }
  }

  if (!isRuntimeFile(file.relative)) continue;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const ip = match[0];
      const classification = allowedRuntimeIPv4.get(ip);
      runtimeIPv4Literals.push({ path: file.relative, line: index + 1, ip, classification: classification || 'UNREVIEWED' });
      if (!classification) unexpectedRuntimeIPv4.push({ path: file.relative, line: index + 1, ip });
    }
    if (!/(?:https?:\/\/|\bfetch\s*\(|\bhttps?\.request\s*\(|\bcreateServer\s*\(|\.listen\s*\(|\bhost\s*=\s*['"]|\bip\s+(?:saddr|daddr)\b|\bpolicy\s+drop\b)/i.test(line)) continue;
    runtimeNetworkReferences.push({ path: file.relative, line: index + 1, text: line.trim().slice(0, 220) });
    for (const match of line.matchAll(/https?:\/\/([^\s"'`<>]+)/gi)) {
      const rawHost = match[1].split(/[/:?#]/, 1)[0].toLowerCase();
      const host = rawHost.replace(/[),.;]+$/, '');
      const interpolation = /^\$\{(?:ip|host)\}$/i.test(host);
      if (file.relative === 'tests/training-http.test.mjs' && host === 'attacker.invalid') {
        rejectedOriginFixtures.push({path:file.relative,line:index+1,host,reason:'rejected Origin header fixture; not an outbound target'});
        continue;
      }
      if (!interpolation && !allowedNetworkHosts.has(host)) {
        unexpectedNetworkHosts.push({ path: file.relative, line: index + 1, host: rawHost });
      }
    }
  }
}

const report = {
  root,
  status: 'PASS',
  exclusions: [],
  scannedRegularFiles: files.length,
  scannedPaths: files.map(file => file.relative),
  scannedDirectories: directories.length,
  directoryPaths: directories.sort(),
  hiddenPathFiles: files.filter(file => file.relative.split('/').some(part => part.startsWith('.'))).length,
  hiddenPathDirectories: directories.filter(directory => directory.split('/').some(part => part.startsWith('.'))).length,
  fileKinds,
  approvedScreenshots: approvedImages,
  approvedRenderingAssets,
  renderingManifestErrors,
  symlinks,
  specialEntries,
  riskyExtensionFiles,
  unexpectedBinary,
  credentialFindings,
  blobFindings,
  dependencyManifests,
  declaredDependencies,
  nodeModulesPresent: directories.some(directory => directory.split('/').includes('node_modules')) ||
    files.some(file => file.relative.split('/').includes('node_modules')),
  thirdPartyImports,
  approvedContainerImports,
  approvedQaImports,
  runtimeNetworkReferences,
  runtimeIPv4Literals,
  allowedNetworkHosts: [...allowedNetworkHosts],
  unexpectedNetworkHosts,
  rejectedOriginFixtures,
  unexpectedRuntimeIPv4,
  networkAnalysisNote: 'tools/scan-safety.mjs was included in file-content scanning; its embedded allowlist examples are not application network targets and were excluded only from endpoint extraction.'
};

const failed = renderingManifestErrors.length || symlinks.length || specialEntries.length || riskyExtensionFiles.length || unexpectedBinary.length ||
  credentialFindings.length || blobFindings.length || dependencyManifests.length || declaredDependencies.length ||
  report.nodeModulesPresent || thirdPartyImports.length || unexpectedNetworkHosts.length || unexpectedRuntimeIPv4.length;
report.status = failed ? 'FAIL' : 'PASS';
const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--write-report')) {
  await writeFile(path.join(root, 'docs/evidence/safety-scan.json'), output, 'utf8');
}
process.stdout.write(output);
if (failed) process.exitCode = 1;

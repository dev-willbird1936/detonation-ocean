// Identify results (deploy/detonation/runner/identify.py) to evidence and a coverage detail (docs/SPEC.md 6.6 "Identify"). Pure.
// Static evidence adds Twilight signals only (EVIDENCE.md). Everything read here came out of the sandbox: shapes are checked, strings cut.

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, size = 120) => String(value ?? '').slice(0, size);
const item = (source, kind, at, detail, fields) => ({ source, kind, detail, at, ...fields });
const MAX_PINVOKE = 10;

/** One-line description of the headers for the coverage list, for example "PE x64 console; packed with UPX; unsigned". */
export function identifyDetail(identify) {
  const facts = isObject(identify) ? identify : {};
  if (!facts.format || facts.format === 'unknown') return 'The headers could not be read.';
  const packers = Array.isArray(facts.packers) ? facts.packers.map(name => text(name, 30)) : [];
  const signature = isObject(facts.signature) ? facts.signature.status : '';
  return [
    `${text(facts.format, 10).toUpperCase()} ${[facts.arch, facts.subsystem].filter(Boolean).map(value => text(value, 12)).join(' ')}`.trim(),
    packers.length ? `packed with ${packers.join(', ')}` : '',
    facts.dotnet === true ? '.NET assembly' : '',
    signature === 'unsigned' ? 'unsigned' : signature === 'invalid' ? 'signature does not verify' : signature === 'valid' ? 'signed' : '',
  ].filter(Boolean).join('; ');
}

/**
 * Items for one `identify` object and the optional `dotnet` metadata. A missing or invalid Authenticode signature is `unsigned`
 * (a signature that verifies is not evidence of anything). A packer or high-entropy code is `obfuscation`. A .NET assembly is read
 * with dnfile and never run, which is `emulation-stopped` (`dotnet-static-only`): its P/Invoke list and names add `suspicious` and
 * `obfuscation` items.
 */
export function mapIdentify(identify, dotnet, { at }) {
  const facts = isObject(identify) ? identify : {};
  const items = [];
  const signature = isObject(facts.signature) ? facts.signature : {};
  if (['unsigned', 'invalid'].includes(signature.status)) {
    items.push(item('identify', 'unsigned', at, text(signature.detail, 160) || 'No valid Authenticode signature.', { reason: signature.status === 'unsigned' ? 'no Authenticode signature' : 'the Authenticode signature does not verify' }));
  }
  const packers = Array.isArray(facts.packers) ? facts.packers.map(name => text(name, 30)).filter(Boolean) : [];
  const highEntropy = Array.isArray(facts.highEntropyCode) ? facts.highEntropyCode.map(name => text(name, 16)) : [];
  if (packers.length) items.push(item('static', 'obfuscation', at, `The program is packed with ${packers.join(', ')}.`, { technique: `packed with ${packers.join(', ')}` }));
  else if (highEntropy.length) items.push(item('static', 'obfuscation', at, 'An executable section has near-random content.', { technique: 'high-entropy code section' }));
  if (isObject(dotnet) && !dotnet.error) {
    items.push(item('static', 'emulation-stopped', at, 'A .NET assembly is read statically; it is not run.', { reason: 'dotnet-static-only' }));
    const pinvoke = Array.isArray(dotnet.suspiciousPinvoke) ? dotnet.suspiciousPinvoke.slice(0, MAX_PINVOKE) : [];
    for (const name of pinvoke) items.push(item('static', 'suspicious', at, `The assembly imports ${text(name, 60)} through P/Invoke.`, { indicator: `dotnet p/invoke ${text(name, 60)}`, tool: 'dnfile' }));
    if (Number(dotnet.oddNameRatio) >= 0.5 && Number(dotnet.namesChecked) >= 10) items.push(item('static', 'obfuscation', at, 'Most type and method names are unreadable.', { technique: 'obfuscated .NET names' }));
  } else if (facts.dotnet === true) {
    items.push(item('static', 'emulation-stopped', at, 'A .NET assembly could not be read, and it is not run.', { reason: 'dotnet-static-only' }));
  }
  return items;
}

// Static checks of the M4/M4b demo samples (docs/SPEC.md 11, 12; AT-13, AT-14, AT-19 to AT-24). Nothing here runs a sample or a binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const samples = join(root, 'samples');
const header = 'Demo sample for Detonation Ocean. Refuses to run outside the sandbox.';
const read = (...parts) => readFileSync(join(samples, ...parts));
const top = (text, lines = 12) => text.split('\n').slice(0, lines).join('\n');

function zipEntries(buffer) {
  const entries = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const dataStart = offset + 30 + nameLength + buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const packed = buffer.subarray(dataStart, dataStart + size);
    entries[name] = method === 8 ? inflateRawSync(packed) : packed;
    offset = dataStart + size;
  }
  return entries;
}

// MS-CFB version 3 reader, enough to pull one stream out of vbaProject.bin.
function cfbStreams(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1', 'compound file signature');
  const sector = (id) => buffer.subarray(512 + id * 512, 512 + (id + 1) * 512);
  const fat = [];
  for (let i = 0; i < buffer.readUInt32LE(44); i++) {
    const data = sector(buffer.readUInt32LE(76 + i * 4));
    for (let at = 0; at < 512; at += 4) fat.push(data.readUInt32LE(at));
  }
  const chain = (start) => {
    const ids = [];
    for (let id = start; id < 0xfffffffa; id = fat[id]) ids.push(id);
    return ids;
  };
  const join = (start) => Buffer.concat(chain(start).map(sector));
  const directory = join(buffer.readUInt32LE(48));
  const entries = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameLength = directory.readUInt16LE(at + 64);
    if (nameLength === 0) continue;
    entries.push({
      name: directory.toString('utf16le', at, at + nameLength - 2),
      type: directory[at + 66],
      start: directory.readUInt32LE(at + 116),
      size: directory.readUInt32LE(at + 120),
    });
  }
  const miniStream = join(entries[0].start).subarray(0, entries[0].size);
  const miniFat = [];
  const miniFatData = join(buffer.readUInt32LE(60));
  for (let at = 0; at < miniFatData.length; at += 4) miniFat.push(miniFatData.readUInt32LE(at));
  const streams = {};
  for (const entry of entries.filter((candidate) => candidate.type === 2)) {
    assert.ok(entry.size < 4096, `${entry.name} lives in the mini stream`);
    const parts = [];
    for (let id = entry.start; id < 0xfffffffa; id = miniFat[id]) parts.push(miniStream.subarray(id * 64, id * 64 + 64));
    streams[entry.name] = Buffer.concat(parts).subarray(0, entry.size);
  }
  return streams;
}

// MS-OVBA 2.4.1 decompression.
function ovbaDecompress(data) {
  assert.equal(data[0], 1, 'compressed container signature');
  const out = [];
  let pos = 1;
  while (pos < data.length) {
    const head = data.readUInt16LE(pos);
    const end = pos + (head & 0xfff) + 3;
    const chunkStart = out.length;
    pos += 2;
    if (!(head & 0x8000)) {
      out.push(...data.subarray(pos, end));
      pos = end;
      continue;
    }
    while (pos < end) {
      const flags = data[pos++];
      for (let bit = 0; bit < 8 && pos < end; bit++) {
        if (flags & (1 << bit)) {
          const token = data.readUInt16LE(pos);
          pos += 2;
          const bits = Math.max(Math.ceil(Math.log2(out.length - chunkStart)), 4);
          const length = (token & (0xffff >> bits)) + 3;
          const offset = (token >> (16 - bits)) + 1;
          for (let i = 0; i < length; i++) out.push(out[out.length - offset]);
        } else {
          out.push(data[pos++]);
        }
      }
    }
  }
  return Buffer.from(out).toString('latin1');
}

function peSections(buffer) {
  assert.equal(buffer.toString('latin1', 0, 2), 'MZ');
  const pe = buffer.readUInt32LE(0x3c);
  assert.equal(buffer.toString('latin1', pe, pe + 4), 'PE\0\0');
  const count = buffer.readUInt16LE(pe + 6);
  const table = pe + 24 + buffer.readUInt16LE(pe + 20);
  return Array.from({ length: count }, (_, i) => buffer.toString('latin1', table + i * 40, table + i * 40 + 8).replace(/\0+$/, ''));
}

test('report.pdf carries a harmless /OpenAction JavaScript and a valid xref pointer', () => {
  const text = read('report.pdf').toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.ok(text.includes(header));
  for (const token of ['/OpenAction', '/JavaScript', '/JS', 'app.alert']) assert.ok(text.includes(token), token);
  assert.ok(!/app\.(launchURL|submitForm)|this\.exportData|\/Launch|\/URI|\/SubmitForm/.test(text), 'no action beyond the alert');
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
});

test('budget.docm is a macro-enabled OOXML package holding a vbaProject.bin with the guarded macro', () => {
  const parts = zipEntries(read('budget.docm'));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/vbaProject.bin']) {
    assert.ok(name in parts, name);
  }
  assert.match(parts['[Content_Types].xml'].toString(), /macroEnabled\.main\+xml/);
  assert.match(parts['word/_rels/document.xml.rels'].toString(), /relationships\/vbaProject"[^>]*Target="vbaProject\.bin"/);
  const streams = cfbStreams(parts['word/vbaProject.bin']);
  for (const name of ['PROJECT', 'PROJECTwm', 'dir', '_VBA_PROJECT', 'ThisDocument', 'DemoMacro']) assert.ok(name in streams, name);
  const macro = ovbaDecompress(streams.DemoMacro).replace(/\r\n/g, '\n');
  assert.equal(macro, readFileSync(join(samples, 'src', 'DemoMacro.bas'), 'utf8'), 'embedded macro equals samples/src/DemoMacro.bas');
});

test('the macro source carries the header and the sandbox guard', () => {
  const source = readFileSync(join(samples, 'src', 'DemoMacro.bas'), 'utf8');
  assert.ok(source.includes(header));
  assert.ok(top(source).includes('Environ("DETONATION_SANDBOX") <> "1" Then Exit Sub'));
  assert.ok(top(source).includes('Dir("/home/dana/Documents"'));
  assert.ok(source.indexOf('Exit Sub') < source.indexOf('Open "'), 'guard comes before the file write');
});

test('hello.html and badge.svg are inert and headed', () => {
  const html = read('hello.html').toString('utf8');
  const svg = read('badge.svg').toString('utf8');
  assert.ok(html.includes(header) && svg.includes(header));
  assert.ok(!/https?:|<form|<iframe|fetch\(|XMLHttpRequest|src=|href=/i.test(html), 'hello.html makes no request');
  assert.ok(!/<script|https?:\/\/(?!www\.w3\.org)|href=/i.test(svg), 'badge.svg has no script or external reference');
});

test('hello.vbs and hello.bat carry the guard before any write', () => {
  const vbs = read('hello.vbs').toString('utf8');
  const bat = read('hello.bat').toString('utf8');
  for (const [name, text] of [['hello.vbs', vbs], ['hello.bat', bat]]) {
    assert.ok(text.includes(header), `${name}: header`);
    assert.ok(top(text).includes('DETONATION_SANDBOX'), `${name}: DETONATION_SANDBOX near the top`);
    assert.ok(top(text).includes('/home/dana/Documents'), `${name}: Documents path near the top`);
  }
  assert.ok(vbs.indexOf('WScript.Quit 0') < vbs.indexOf('CreateTextFile'));
  assert.ok(bat.indexOf('exit /b 0') < bat.indexOf('echo hello'));
});

test('notice.eml parses to a text body plus a zip attachment holding clean-chart.py', () => {
  const raw = read('notice.eml').toString('latin1');
  assert.ok(raw.includes(header));
  const headers = raw.slice(0, raw.indexOf('\r\n\r\n'));
  const boundary = /boundary="([^"]+)"/.exec(headers)[1];
  assert.match(headers, /Content-Type: multipart\/mixed/);
  const parts = raw.slice(headers.length + 4).split(`--${boundary}`).slice(1, -1).map((part) => part.replace(/^\r\n/, ''));
  assert.equal(parts.length, 2);
  const [textPart, attachmentPart] = parts.map((part) => {
    const at = part.indexOf('\r\n\r\n');
    return { headers: part.slice(0, at), body: part.slice(at + 4) };
  });
  assert.match(textPart.headers, /Content-Type: text\/plain/);
  assert.ok(textPart.body.trim().length > 0);
  assert.match(attachmentPart.headers, /Content-Disposition: attachment; filename="bundle\.zip"/);
  const attachment = Buffer.from(attachmentPart.body.replace(/\s+/g, ''), 'base64');
  assert.deepEqual(Object.keys(zipEntries(attachment)), ['clean-chart.py']);
  assert.deepEqual(zipEntries(attachment)['clean-chart.py'], read('clean-chart.py'));
});

const sources = {
  'runkey.c': ['GetEnvironmentVariableA("DETONATION_SANDBOX"', 'RegCreateKeyExA', 'demo-note.txt', 'Detonation Ocean demo'],
  'wine-check.c': ['GetEnvironmentVariableA("DETONATION_SANDBOX"', 'Software\\\\Wine'],
  'needs-unimplemented.c': ['GetEnvironmentVariableA("DETONATION_SANDBOX"'],
};

test('every C source and the installer script carry the header and the guard', () => {
  for (const [name, needles] of Object.entries(sources)) {
    const text = readFileSync(join(samples, 'src', name), 'utf8');
    assert.ok(text.includes(header), `${name}: header`);
    assert.ok(top(text, 3).includes('DETONATION_SANDBOX') && top(text, 3).includes('/home/dana/Documents'), `${name}: guard comment`);
    for (const needle of needles) assert.ok(text.includes(needle), `${name}: ${needle}`);
  }
  const iss = readFileSync(join(samples, 'src', 'setup-demo.iss'), 'utf8');
  assert.ok(iss.includes(header));
  assert.ok(top(iss, 3).includes('DETONATION_SANDBOX'));
  assert.ok(iss.includes("GetEnv('DETONATION_SANDBOX') = '1'"));
  assert.ok(iss.includes('Source: "runkey.exe"'));
});

const binaries = ['runkey.exe', 'runkey-upx.exe', 'needs-unimplemented.exe', 'wine-check.exe', 'setup-demo.exe'];

test('the test binaries exist and are PE files with no network imports', () => {
  for (const name of binaries) {
    const buffer = read('bin', name);
    assert.ok(buffer.length > 1024, `${name}: size`);
    peSections(buffer);
  }
  for (const name of ['runkey.exe', 'runkey-upx.exe', 'needs-unimplemented.exe', 'wine-check.exe']) {
    assert.ok(!/ws2_32|wininet|winhttp|urlmon|wsock32/i.test(read('bin', name).toString('latin1')), `${name}: no network DLL name`);
  }
});

test('runkey-upx.exe is UPX-packed and runkey.exe is not', () => {
  assert.deepEqual(peSections(read('bin', 'runkey-upx.exe')).slice(0, 2), ['UPX0', 'UPX1']);
  assert.ok(!peSections(read('bin', 'runkey.exe')).some((name) => name.startsWith('UPX')));
  assert.ok(read('bin', 'runkey-upx.exe').length < read('bin', 'runkey.exe').length);
});

test('runkey.exe carries the strings of its behaviour and its guard', () => {
  const text = read('bin', 'runkey.exe').toString('latin1');
  for (const needle of ['DETONATION_SANDBOX', 'USERPROFILE', 'DemoSample', 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'demo-note.txt', 'Detonation Ocean demo']) {
    assert.ok(text.includes(needle), needle);
  }
});

test('wine-check.exe reads HKCU\\Software\\Wine and needs-unimplemented.exe imports the stub-only function', () => {
  assert.ok(read('bin', 'wine-check.exe').toString('latin1').includes('Software\\Wine'));
  const source = readFileSync(join(samples, 'src', 'needs-unimplemented.c'), 'utf8');
  const api = /Stub-only API: (\w+) in (\S+\.dll)/.exec(source);
  assert.ok(api, 'source names the API it relies on');
  const binary = read('bin', 'needs-unimplemented.exe').toString('latin1');
  assert.ok(binary.includes(api[1]), `${api[1]} is in the import table`);
  assert.ok(binary.toLowerCase().includes(api[2].toLowerCase()), `${api[2]} is in the import table`);
});

test('setup-demo.exe is an Inno Setup installer', () => {
  const buffer = read('bin', 'setup-demo.exe');
  assert.ok(buffer.includes(Buffer.from('Inno Setup Setup Data')), 'Inno Setup Setup Data marker');
});

test('samples/README.md lists every M4 file with its expected verdict and acceptance test', () => {
  const readme = readFileSync(join(samples, 'README.md'), 'utf8');
  const files = ['report.pdf', 'budget.docm', 'hello.html', 'badge.svg', 'notice.eml', 'hello.vbs', 'hello.bat', ...binaries.map((name) => `bin/${name}`)];
  for (const name of files) assert.ok(readme.includes(`\`${name}\``), name);
  for (const id of ['AT-13', 'AT-14', 'AT-19', 'AT-20', 'AT-22', 'AT-23', 'AT-24']) assert.ok(readme.includes(id), id);
});

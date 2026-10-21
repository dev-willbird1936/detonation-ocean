// Builds samples/bundle.zip, samples/report.pdf (harmless /OpenAction JavaScript) and samples/notice.eml (text body plus a zip attachment
// of clean-chart.py). With --bomb <dir> (dir must be inside the OS temp directory), also writes a nested zip bomb that exceeds the
// SPEC section 5.3 caps. The Office, Windows and installer samples are built by make-office-sample.py and build-test-binaries.sh.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const samples = join(root, 'samples');
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, method } of entries) {
    const nameBytes = Buffer.from(name);
    const packed = method === 8 ? deflateRawSync(data, { level: 9 }) : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, packed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

function nestedBomb() {
  let archive = zip([
    { name: 'zeros.bin', data: Buffer.alloc(60 * 1024 * 1024), method: 8 },
    ...Array.from({ length: 50 }, (_, index) => ({ name: `pad-${index}.txt`, data: Buffer.from('x'), method: 8 })),
  ]);
  for (let depth = 1; depth <= 4; depth++) {
    archive = zip([{ name: `level-${depth}.zip`, data: archive, method: 0 }]);
  }
  return archive;
}

const bundle = zip([
  { name: 'clean-chart.py', data: readFileSync(join(samples, 'clean-chart.py')), method: 8 },
  { name: 'obfuscated-hello.ps1', data: readFileSync(join(samples, 'obfuscated-hello.ps1')), method: 0 },
]);
writeFileSync(join(samples, 'bundle.zip'), bundle);
console.log(`wrote samples/bundle.zip (${bundle.length} bytes)`);

const HEADER = 'Demo sample for Detonation Ocean. Refuses to run outside the sandbox.';

// A PDF cannot read the environment, so it carries only a harmless alert: the sandbox is where pdfid and the renderer see it.
function pdf() {
  const content = 'BT /F1 18 Tf 72 700 Td (Demo sample report) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
    '<< /Type /Action /S /JavaScript /JS (app.alert\\("hello"\\);) >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = `%PDF-1.4\n% ${HEADER}\n`;
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(out);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function eml() {
  const attachment = zip([{ name: 'clean-chart.py', data: readFileSync(join(samples, 'clean-chart.py')), method: 8 }]);
  const wrapped = attachment.toString('base64').match(/.{1,76}/g).join('\r\n');
  const lines = [
    'From: Dana Demo <dana@example.invalid>',
    'To: Team <team@example.invalid>',
    'Subject: Notice: photo list attached',
    'Date: Thu, 01 Jan 2026 09:00:00 +0000',
    'Message-ID: <demo-notice@example.invalid>',
    'MIME-Version: 1.0',
    `X-Demo-Sample: ${HEADER}`,
    'Content-Type: multipart/mixed; boundary="demo-boundary"',
    '',
    '--demo-boundary',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    'Hello,',
    '',
    'The attached bundle holds the script that summarises the photo list.',
    '',
    '--demo-boundary',
    'Content-Type: application/zip; name="bundle.zip"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="bundle.zip"',
    '',
    wrapped,
    '--demo-boundary--',
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'latin1');
}

writeFileSync(join(samples, 'report.pdf'), pdf());
console.log('wrote samples/report.pdf');
writeFileSync(join(samples, 'notice.eml'), eml());
console.log('wrote samples/notice.eml');

const bombFlag = process.argv.indexOf('--bomb');
if (bombFlag !== -1) {
  const dir = resolve(process.argv[bombFlag + 1] ?? '');
  if (!dir.startsWith(resolve(tmpdir()) + sep)) throw new Error('--bomb must point inside the OS temp directory');
  mkdirSync(dir, { recursive: true });
  const bomb = nestedBomb();
  writeFileSync(join(dir, 'bomb.zip'), bomb);
  console.log(`wrote ${join(dir, 'bomb.zip')} (${bomb.length} bytes)`);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectType, sizeTier } from '../backend/detonation/filetype.mjs';

const text = (s) => Buffer.from(s, 'utf8');

function zipOf(...names) {
  return Buffer.concat(names.map((name) => {
    const header = Buffer.alloc(30);
    header.write('PK\x03\x04', 0, 'latin1');
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, Buffer.from(name, 'latin1')]);
  }));
}

function emptyZip(comment = Buffer.alloc(0)) {
  const buf = Buffer.alloc(22 + comment.length);
  buf.set([0x50, 0x4b, 0x05, 0x06]);
  buf.writeUInt16LE(comment.length, 20);
  comment.copy(buf, 22);
  return buf;
}

function pe(characteristics) {
  const buf = Buffer.alloc(0x100);
  buf.write('MZ', 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.write('PE\0\0', 0x80, 'latin1');
  buf.writeUInt16LE(characteristics, 0x80 + 22);
  return buf;
}

const ole2 = (...streams) => Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  ...streams.map((s) => Buffer.from(s, 'utf16le')),
]);

test('AT-14: invoice.pdf.html is detected as html and flags a mismatch against pdf', () => {
  const r = detectType(text('<!DOCTYPE html><html><body>Sign in</body></html>'), 'invoice.pdf.html');
  assert.deepEqual(r, { detectedType: 'html', claimedExtension: 'pdf', path: 'run', mismatch: true, supported: true });
});

test('a real pdf with a pdf name is consistent', () => {
  const r = detectType(text('%PDF-1.7\n1 0 obj'), 'invoice.pdf');
  assert.equal(r.detectedType, 'pdf');
  assert.equal(r.mismatch, false);
});

test('an exe disguised as a pdf is detected by content and runs under wine', () => {
  const r = detectType(pe(0x0102), 'invoice.pdf');
  assert.equal(r.detectedType, 'exe');
  assert.equal(r.path, 'wine');
  assert.equal(r.mismatch, true);
  assert.equal(r.claimedExtension, 'pdf');
});

test('PE characteristics separate dll from exe; scr is consistent with exe', () => {
  assert.equal(detectType(pe(0x2102), 'a.dll').detectedType, 'dll');
  assert.equal(detectType(pe(0x2102), 'a.dll').mismatch, false);
  assert.equal(detectType(pe(0x0102), 'a.scr').mismatch, false);
  assert.equal(detectType(pe(0x0102), 'a.dll').mismatch, true);
});

test('MZ without a PE signature is not an executable', () => {
  const buf = Buffer.alloc(0x100);
  buf.write('MZ', 0);
  assert.equal(detectType(buf, 'a.exe').detectedType, 'unknown');
});

test('ELF runs natively', () => {
  const r = detectType(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), 'tool');
  assert.deepEqual(r, { detectedType: 'elf', claimedExtension: '', path: 'run', mismatch: false, supported: false });
});

test('zip, OOXML and macro-enabled OOXML are told apart by entries', () => {
  assert.equal(detectType(zipOf('a.txt'), 'a.zip').detectedType, 'zip');
  assert.equal(detectType(zipOf('[Content_Types].xml', 'word/document.xml'), 'a.docx').detectedType, 'docx');
  assert.equal(detectType(zipOf('[Content_Types].xml', 'xl/workbook.xml'), 'a.xlsx').detectedType, 'xlsx');
  assert.equal(detectType(zipOf('[Content_Types].xml', 'ppt/presentation.xml'), 'a.pptx').detectedType, 'pptx');
  const macro = detectType(zipOf('[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'), 'report.docx');
  assert.equal(macro.detectedType, 'docm');
  assert.equal(macro.mismatch, true);
  assert.equal(detectType(zipOf('a.txt'), 'report.docx').mismatch, true);
});

test('zip entries identify jar and apk', () => {
  const jar = detectType(zipOf('META-INF/MANIFEST.MF', 'A.class'), 'a.jar');
  assert.deepEqual([jar.detectedType, jar.path, jar.mismatch, jar.supported], ['jar', 'run', false, false]);
  assert.equal(detectType(zipOf('com/x/B.class'), 'a.jar').detectedType, 'jar');
  const apk = detectType(zipOf('META-INF/MANIFEST.MF', 'AndroidManifest.xml', 'classes.dex'), 'a.apk');
  assert.deepEqual([apk.detectedType, apk.path, apk.mismatch], ['apk', 'inspect', false]);
});

test('standalone empty ZIP EOCD is recognized with comments without scanning them as entries', () => {
  const entryLikeComment = zipOf('[Content_Types].xml', 'word/document.xml');
  for (const buf of [emptyZip(), emptyZip(Buffer.from('comment')), emptyZip(entryLikeComment)]) {
    assert.deepEqual(detectType(buf, 'empty.zip'), {
      detectedType: 'zip', claimedExtension: 'zip', path: 'inspect', mismatch: false, supported: true,
    });
  }
});

test('empty ZIP detection rejects truncated or inconsistent EOCD records', () => {
  const badCommentLength = emptyZip();
  badCommentLength.writeUInt16LE(1, 20);
  const nonzeroField = (offset, write) => {
    const buf = emptyZip();
    write(buf, offset);
    return buf;
  };
  const invalid = [
    Buffer.concat([Buffer.from([0]), emptyZip()]),
    emptyZip().subarray(0, 21),
    badCommentLength,
    Buffer.concat([emptyZip(), Buffer.from([0])]),
    nonzeroField(4, (buf, at) => buf.writeUInt16LE(1, at)),
    nonzeroField(6, (buf, at) => buf.writeUInt16LE(1, at)),
    nonzeroField(8, (buf, at) => buf.writeUInt16LE(1, at)),
    nonzeroField(10, (buf, at) => buf.writeUInt16LE(1, at)),
    nonzeroField(12, (buf, at) => buf.writeUInt32LE(1, at)),
    nonzeroField(16, (buf, at) => buf.writeUInt32LE(1, at)),
  ];
  for (const buf of invalid) assert.equal(detectType(buf, 'empty.zip').detectedType, 'unknown');
});

test('Mach-O, fat Mach-O, dmg, pkg and OneNote are told apart; a Java class is not Mach-O', () => {
  const be = (...words) => Buffer.concat(words.map((w) => { const b = Buffer.alloc(4); b.writeUInt32BE(w); return b; }));
  for (const magic of [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]) assert.equal(detectType(be(magic, 7, 0), 'a.out').detectedType, 'macho');
  assert.equal(detectType(be(0xcafebabe, 2, 0, 0), 'fat').detectedType, 'macho');
  assert.equal(detectType(be(0xcafebabe, 0x34, 0, 0), 'A.class').detectedType, 'unknown');
  const dmg = detectType(Buffer.concat([Buffer.alloc(1024), Buffer.from('koly'), Buffer.alloc(508)]), 'a.dmg');
  assert.deepEqual([dmg.detectedType, dmg.path, dmg.mismatch], ['dmg', 'inspect', false]);
  assert.equal(detectType(Buffer.from('xar!\0\x1c\0\x01'), 'a.pkg').detectedType, 'pkg');
  const one = detectType(Buffer.from('e4525c7b8cd8a74daeb15378d02996d3', 'hex'), 'n.one');
  assert.deepEqual([one.detectedType, one.path, one.mismatch], ['one', 'inspect', false]);
});

test('paths and hackathon support follow DETONATION-DESIGN §2', () => {
  const msiMagic = Buffer.from([0x84, 0x10, 0x0c, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]);
  const cases = [
    // [detectedType, buffer, path, supported]
    ['pdf', text('%PDF-1.7'), 'run', true], ['html', text('<html></html>'), 'run', true], ['svg', text('<svg></svg>'), 'run', true],
    ['docx', zipOf('[Content_Types].xml', 'word/a'), 'run', true], ['docm', zipOf('[Content_Types].xml', 'word/vbaProject.bin'), 'run', true],
    ['xlsx', zipOf('[Content_Types].xml', 'xl/a'), 'run', true], ['xlsm', zipOf('[Content_Types].xml', 'xl/vbaProject.bin'), 'run', true],
    ['doc', ole2('WordDocument'), 'run', true], ['xls', ole2('Workbook'), 'run', true], ['pptx', zipOf('[Content_Types].xml', 'ppt/a'), 'run', true],
    ['ps1', text('Write-Host 1'), 'run', true], ['py', text('import os\n'), 'run', true], ['sh', text('#!/bin/sh\n'), 'run', true],
    ['js-node', text('require("fs")'), 'run', true], ['elf', Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'run', false],
    ['jar', zipOf('META-INF/MANIFEST.MF'), 'run', false],
    ['exe', pe(0x0102), 'wine', true], ['dll', pe(0x2102), 'wine', false], ['bat', text('@echo off'), 'wine', true],
    ['js-wsh', text('WScript.Echo(1)'), 'wine', true], ['vbs', text('Dim x'), 'wine', true], ['hta', text('<hta:application>'), 'wine', false],
    ['msi', Buffer.concat([ole2(), msiMagic]), 'wine', false],
    ['zip', zipOf('a.txt'), 'inspect', true], ['eml', text('Received: x\nFrom: a\nTo: b\nSubject: s\n\nhi'), 'inspect', true],
    ['msg', ole2('__properties_version1.0'), 'inspect', false], ['rtf', text('{\\rtf1'), 'inspect', false],
    ['lnk', Buffer.from([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0]), 'inspect', false], ['apk', zipOf('AndroidManifest.xml', 'classes.dex'), 'inspect', false],
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'inspect', false], ['text', text('hello'), 'inspect', false],
  ];
  for (const [type, buf, path, supported] of cases) {
    const r = detectType(buf);
    assert.deepEqual([r.detectedType, r.path, r.supported], [type, path, supported], type);
  }
});

test('OLE2 streams distinguish doc, xls and msi, else ole2', () => {
  assert.equal(detectType(ole2('WordDocument'), 'a.doc').detectedType, 'doc');
  assert.equal(detectType(ole2('Workbook'), 'a.xls').detectedType, 'xls');
  const msi = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from([0x84, 0x10, 0x0c, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46])]);
  const m = detectType(msi, 'setup.msi');
  assert.deepEqual([m.detectedType, m.path, m.mismatch], ['msi', 'wine', false]);
  assert.equal(detectType(ole2('Other'), 'a.bin').detectedType, 'ole2');
});

test('PostScript, RTF, eml, svg and hta are sniffed from text', () => {
  assert.equal(detectType(text('%!PS-Adobe-3.0'), 'a.ps').detectedType, 'ps');
  assert.equal(detectType(text('{\\rtf1\\ansi'), 'a.rtf').detectedType, 'rtf');
  const eml = 'Received: from x\r\nFrom: a@b.c\r\nTo: d@e.f\r\nSubject: hi\r\n\r\nbody';
  assert.equal(detectType(text(eml), 'mail.eml').detectedType, 'eml');
  assert.equal(detectType(text('<?xml version="1.0"?><svg xmlns="x"></svg>'), 'a.svg').detectedType, 'svg');
  assert.equal(detectType(text('<html><hta:application id="x"/></html>'), 'a.hta').detectedType, 'hta');
});

test('shebangs and text heuristics choose scripts and their paths', () => {
  const cases = [
    ['#!/usr/bin/env python3\nprint(1)', 'a.py', 'py', 'run'],
    ['#!/bin/sh\nls', 'a.sh', 'sh', 'run', true],
    ['#!/usr/bin/env node\nconsole.log(1)', 'a.js', 'js-node', 'run'],
    ['import os\nos.listdir(".")', 'a.py', 'py', 'run'],
    ['const fs = require("fs");', 'a.js', 'js-node', 'run'],
    ['var s = new ActiveXObject("WScript.Shell");', 'a.js', 'js-wsh', 'wine'],
    ['Dim x\nSet o = CreateObject("WScript.Shell")', 'a.vbs', 'vbs', 'wine'],
    ['@echo off\r\necho hi', 'a.bat', 'bat', 'wine'],
    ['Write-Host "hi"\n$x = 1', 'a.ps1', 'ps1', 'run'],
  ];
  for (const [body, name, detectedType, path, supported = true] of cases) {
    const r = detectType(text(body), name);
    assert.deepEqual([r.detectedType, r.path, r.mismatch, r.supported], [detectedType, path, false, supported], name + ': ' + body);
  }
});

test('plain text is inspected; a script claiming .txt is a mismatch', () => {
  assert.equal(detectType(text('hello world'), 'notes.txt').mismatch, false);
  assert.equal(detectType(text('import os\nos.getcwd()'), 'notes.txt').mismatch, true);
});

test('unsupported and unknown types are inspected and flagged unsupported', () => {
  const rtf = detectType(text('{\\rtf1'), 'a.rtf');
  assert.deepEqual([rtf.path, rtf.supported], ['inspect', false]);
  const bin = detectType(Buffer.from([0, 1, 2, 3, 4]), 'blob.dat');
  assert.deepEqual(bin, { detectedType: 'unknown', claimedExtension: 'dat', path: 'inspect', mismatch: false, supported: false });
  assert.equal(detectType(Buffer.from([0, 1, 2, 3]), 'fake.pdf').mismatch, true);
});

test('sizeTier follows SPEC 6.6', () => {
  const MB = 1024 * 1024;
  assert.equal(sizeTier(0), 'full');
  assert.equal(sizeTier(10 * MB), 'full');
  assert.equal(sizeTier(10 * MB + 1), 'static');
  assert.equal(sizeTier(100 * MB), 'static');
  assert.equal(sizeTier(100 * MB + 1), 'reject');
});

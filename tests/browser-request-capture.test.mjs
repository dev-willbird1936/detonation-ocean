import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../deploy/detonation/runner/browser.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function handleRequest(route) {');
const end = source.indexOf('\n}\n\nasync function shoot', start);
assert.ok(start >= 0 && end >= 0, 'browser request handler exists for isolated testing');
const handlerSource = source.slice(start, end + 2);
const password = 'CorrectHorse-TEST-CANARY';

function recordRequest(url, body = '', previousRequests = []) {
  const sandbox = {
    result: { requests: [...previousRequests] },
    credentialCaptured: false,
    password,
    LOCAL_URL: /^(?:file|data|blob|about|chrome|devtools):/i,
    BODY_CHARS: 1_024,
    room: list => list.length < 60,
    clip: (value, size = 300) => String(value ?? '').slice(0, size),
  };
  const handleRequest = vm.runInNewContext(`(${handlerSource})`, sandbox);
  let action;
  const request = {
    url: () => url,
    postData: () => body,
    method: () => body ? 'POST' : 'GET',
    resourceType: () => 'fetch',
  };
  const route = {
    request: () => request,
    continue: () => { action = 'continue'; },
    abort: reason => { action = `abort:${reason}`; },
  };
  handleRequest(route);
  return { action, captured: sandbox.credentialCaptured, requests: sandbox.result.requests };
}

test('capture checks the untruncated blocked request body and keeps its preview capped', () => {
  const result = recordRequest('https://example.invalid/login', `${'x'.repeat(1_024)}${password}`);
  assert.equal(result.captured, true);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].body.length, 1_024);
  assert.equal(result.requests[0].body.includes(password), false);
  assert.equal(result.action, 'abort:blockedbyclient');
});

test('capture checks the untruncated request URL and keeps its preview capped', () => {
  const url = `https://example.invalid/${'u'.repeat(500)}${password}`;
  const result = recordRequest(url);
  assert.equal(result.captured, true);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].url.length, 500);
  assert.equal(result.requests[0].url.includes(password), false);
  assert.equal(result.action, 'abort:blockedbyclient');
});

test('short token-free requests stay uncaptured and a short credential request is detected', () => {
  const ordinary = recordRequest('https://example.invalid/ping', 'name=dana');
  assert.equal(ordinary.captured, false);
  assert.equal(ordinary.requests.length, 1);

  const captured = recordRequest('https://example.invalid/login', `password=${password}`);
  assert.equal(captured.captured, true);
  assert.equal(captured.requests[0].body.includes(password), true);
});

test('local requests and requests rejected by the existing list cap do not count as blocked capture evidence', () => {
  const local = recordRequest(`file:///tmp/page?token=${password}`);
  assert.equal(local.captured, false);
  assert.equal(local.requests.length, 0);
  assert.equal(local.action, 'continue');

  const fullList = recordRequest('https://example.invalid/login', `password=${password}`, Array(60).fill({}));
  assert.equal(fullList.captured, false);
  assert.equal(fullList.requests.length, 60);
  assert.equal(fullList.action, 'abort:blockedbyclient');
});

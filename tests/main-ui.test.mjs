import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';
import { loadAbyssAssets } from '../backend/abyss-assets.mjs';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
async function local(run) {
  const previous=process.env.VULTR_SANDBOX_MODE; delete process.env.VULTR_SANDBOX_MODE;
  const server=createAppServer();
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try { await run('http://127.0.0.1:'+server.address().port); }
  finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); if(previous!==undefined)process.env.VULTR_SANDBOX_MODE=previous; }
}
test('Abyss is the root UI; the synthetic chamber remains separate',()=>local(async base=>{
  const main=await fetch(base+'/'), old=await fetch(base+'/chamber.html');
  assert.equal(main.status,200); assert.equal(old.status,200);
  const html=await main.text(), legacy=await old.text();
  assert.match(html,/<title>The Abyss/); assert.match(html,/href="\/chamber.html"/);
  assert.match(legacy,/__?DATA|Detonation Chamber/);
  assert.ok(main.headers.get('content-security-policy').includes("'wasm-unsafe-eval'"));
  assert.ok(!old.headers.get('content-security-policy').includes("'wasm-unsafe-eval'"));
  const js=html.match(/src="([^"]+\.js)"/)[1];
  const asset=await fetch(base+js); assert.equal(asset.status,200);
  assert.match(asset.headers.get('content-type'),/javascript/);
  const model=await fetch(base+'/ui/abyss/models/abyss-species/frogfish-a.glb');
  assert.equal(model.status,200); assert.equal(Buffer.from(await model.arrayBuffer()).toString('ascii',0,4),'glTF');
  for(const path of ['/backend/personas.mjs','/ui/abyss/not-in-manifest.js','/data/personas.json']) assert.equal((await fetch(base+path)).status,404);
}));
test('renderer integrity mismatch fails closed',()=>{
  const root=mkdtempSync(join(tmpdir(),'abyss-integrity-')), dir=join(root,'ui/abyss');
  mkdirSync(dir,{recursive:true}); writeFileSync(join(dir,'x.js'),'changed');
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({version:1,files:[{path:'ui/abyss/x.js',sha256:'0'.repeat(64),bytes:7,mime:'text/javascript'}]}));
  assert.throws(()=>loadAbyssAssets(root),/integrity mismatch/);
});
test('renderer manifest cannot name an unrelated file',()=>{
  const root=mkdtempSync(join(tmpdir(),'abyss-path-'));mkdirSync(join(root,'ui/abyss'),{recursive:true});
  writeFileSync(join(root,'ui/abyss/manifest.json'),JSON.stringify({version:1,files:[{path:'backend/personas.mjs',sha256:'0'.repeat(64),bytes:0,mime:'text/javascript'}]}));
  assert.throws(()=>loadAbyssAssets(root),/Invalid renderer asset/);
});

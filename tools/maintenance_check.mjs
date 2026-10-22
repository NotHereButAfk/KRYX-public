import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const handlers={},page=new Response('Going into maintenance');let network=()=>Promise.resolve(new Response('game')),claims=0;
const cached=new Map();const cache={put:async(k,v)=>cached.set(k,v)};
vm.runInNewContext(fs.readFileSync('public/maintenance-worker.js','utf8'),{
 URL,self:{location:{origin:'https://kryx.live'},addEventListener:(n,fn)=>handlers[n]=fn,skipWaiting:async()=>{},clients:{claim:async()=>claims++}},
 caches:{open:async()=>cache,match:async k=>cached.get(k)},fetch:(req)=>req==='/maintenance.html'?Promise.resolve(page):network(req)
});
let pending;handlers.install({waitUntil:p=>pending=p});await pending;handlers.activate({waitUntil:p=>pending=p});await pending;assert.equal(claims,1);
async function navigate(path='/',mode='navigate'){let result;handlers.fetch({request:{url:'https://kryx.live'+path,method:'GET',mode},respondWith:p=>result=p});return result?await result:undefined;}
assert.equal(await (await navigate()).text(),'game');
network=()=>Promise.resolve(new Response('nginx',{status:502}));assert.equal(await (await navigate()).clone().text(),'Going into maintenance');
network=()=>Promise.reject(new Error('offline'));assert.equal(await (await navigate()).clone().text(),'Going into maintenance');
assert.equal(await navigate('/api/account'),undefined);assert.equal(await navigate('/assets/main.js','cors'),undefined);
network=()=>Promise.resolve(new Response('not found',{status:404}));assert.equal((await navigate()).status,404);
network=()=>Promise.resolve(new Response('recovered'));assert.equal(await (await navigate()).text(),'recovered');
console.log('Maintenance fallback: 502, offline, recovery, API/asset exclusions and 404 preservation passed.');

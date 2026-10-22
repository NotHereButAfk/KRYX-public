import assert from 'node:assert/strict';
import { retryConnection } from '../src/net/ConnectionRetry.js';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeAuthServer } from '../server/authserver.mjs';

let attempts=0;
const delays=[];
assert.equal(await retryConnection(async()=>{
  if(++attempts<=7)throw new Error('temporary disconnect');
  return 'connected';
},{baseMs:1,maxMs:4,onRetry:(_error,_attempt,delay)=>delays.push(delay)}),'connected');
assert.deepEqual(delays,[1,2,4,4,4,4,4],'retries must continue with capped backoff');
const controller=new AbortController();
await assert.rejects(retryConnection(async()=>{throw new Error('offline');},{signal:controller.signal,
  onRetry:()=>controller.abort(),baseMs:1}),{name:'AbortError'});

const server=makeAuthServer({targetPopulation:0});
await new Promise(resolve=>server.http.listen(0,'127.0.0.1',resolve));
const address=`ws://127.0.0.1:${server.http.address().port}`;
const vite=await createServer({server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
await vite.listen();
const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.requestAnimationFrame=()=>0;
    window.cancelAnimationFrame=()=>{};
  });
  let sockets=0, maps=0;
  const routes=[];
  await page.routeWebSocket(address,ws=>{
    sockets++;
    if(sockets<=2)ws.close({code:1013,reason:'Temporary outage'});
    else { ws.connectToServer(); routes.push(ws); }
  });
  await page.route('**/*.evmap',route=>{if(++maps===1)return route.abort();return route.continue();});
  await page.goto(`${vite.resolvedUrls.local[0]}?authnet=${encodeURIComponent(address)}`,{waitUntil:'commit'});
  await page.waitForFunction(()=>document.getElementById('ml-players')?.textContent.includes('Retrying automatically'),null,{timeout:90000,polling:50});
  const during=await page.evaluate(()=>({
    visible:!document.getElementById('map-loading').classList.contains('hidden'),
    failed:/CONNECTION FAILED|SERVER UNAVAILABLE/.test(document.body.innerText),
    inFlight:!!window.__game._matchJoinPromise,
  }));
  assert(during.visible && during.inFlight && !during.failed,JSON.stringify(during));
  await page.waitForFunction(()=>window.__game?._authNet?.ready,null,{timeout:90000,polling:50});
  assert(sockets>=4 && maps>=2,'must recover from both socket and map-fetch failures');
  const count=sockets;
  await page.evaluate(async()=>{
    const game=window.__game;
    await Promise.all(Array.from({length:3},()=>game._prepareAuthoritativeMatch(game.player.name,'deathmatch')));
    game._spectating=true;
    await game._authNet.setSpectating(true);
    window.__oldBridge=game._authNet;
  });
  assert.equal(sockets,count,'repeated Play created duplicate connections');
  routes.at(-1).close({code:1012,reason:'Server restart'});
  await page.waitForFunction(()=>window.__game?._authNet?.ready && window.__game._authNet!==window.__oldBridge,null,{timeout:90000,polling:50});
  await page.waitForFunction(()=>!window.__game._reconnectPromise,null,{timeout:10000,polling:50});
  const recovered=await page.evaluate(()=>({
    hidden:document.getElementById('map-loading').classList.contains('hidden'),
    you:window.__game._authNet.client.you,
  }));
  assert(recovered.hidden && server.room.players.get(recovered.you)?.spectating,JSON.stringify(recovered));
  // A disposed game must not leave a retry loop or a live socket behind.
  await page.evaluate(()=>window.__game.dispose());
  const disposedCount=sockets;
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(sockets,disposedCount);
  assert.deepEqual(errors,[]);
  console.log('Connection retry passed: repeated outages, failed map fetch, visible loading, restart recovery, spectator preservation and cleanup.');
} finally {
  await browser.close(); await vite.close();
  await server.close();
}

import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { AuthRoom } from './authroom.mjs';
import { makeAuthServer } from './authserver.mjs';
import { accountClientAddress } from './auth-rate-limit.mjs';

const arena={id:'security-fixture',half:100,killY:-25,platforms:[],boxes:[],spawns:[[0,0,0]],pickups:[],gravLifts:[],teleporters:[]};
const room=new AuthRoom(arena,{targetPopulation:8});
const spectators=[];
for(let i=0;i<8;i++){const id=room.add(()=>{},`Spectator${i}`);assert.notEqual(id,null);room.setSpectating(id,true);spectators.push(id);}
const active=[];
for(let i=0;i<8;i++){const id=room.add(()=>{},`Active${i}`);assert.notEqual(id,null);active.push(id);}
assert.equal(room.players.size,16,'eight players plus eight spectators stay supported');
assert.equal(room.add(()=>{},'Overflow'),null,'spectators cannot increase capacity forever');
room.setSpectating(active[0],true);
assert(!room.players.get(active[0]).spectating,'spectator reserve is bounded separately');
room.remove(spectators[0]);room.setSpectating(active[0],true);
assert(room.players.get(active[0]).spectating,'released spectator capacity is reusable');
room.remove(active[1]);room.setSpectating(active[0],false);
assert(!room.players.get(active[0]).spectating,'healthy spectators can rejoin active slots');

const combat=new AuthRoom(arena);combat._rotateMatch=()=>false;combat._hitscan=()=>{};
const id=combat.add(()=>{},'Cooldown fixture'),p=combat.players.get(id);
p.wid='plasmarifle';p.ammo.plasmarifle={mag:6,reserve:24};
combat.onFire(id,{seq:1,wid:'plasmarifle',yaw:0,pitch:0});combat.update();
assert.equal(p.ammo.plasmarifle.mag,5);
for(let i=0;i<4;i++)combat.update();
const debt=p.fireCooldown;assert(debt>0);
combat.onFire(id,{seq:2,wid:'m4',yaw:0,pitch:0});
assert.equal(p.fireCooldown,debt,'unequipped faster weapon cannot erase the active cooldown');
combat.onFire(id,{seq:3,wid:'plasmarifle',yaw:0,pitch:0});combat.update();
assert.equal(p.ammo.plasmarifle.mag,5,'rapid second laser shot rejected');
for(let i=0;i<20;i++)combat.update();
combat.onFire(id,{seq:4,wid:'plasmarifle',yaw:0,pitch:0});combat.update();
assert.equal(p.ammo.plasmarifle.mag,4,'normal shot works after cooldown');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(test,label){for(let i=0;i<100;i++){if(test())return;await sleep(15);}throw new Error(label);}
async function transportLimits(limits,exercise){
  const app=makeAuthServer({accountService:null,targetPopulation:0,connectionLimits:limits});
  app.room._rotateMatch=()=>false;
  await new Promise(resolve=>app.http.listen(0,'127.0.0.1',resolve));
  const sockets=[];
  const connect=async(join=true,headers={})=>{
    const ws=new WebSocket(`ws://127.0.0.1:${app.http.address().port}`,{origin:'http://localhost',headers});
    const result={ws,closed:false,welcome:false,snapshots:0};sockets.push(ws);
    ws.on('error',()=>{});ws.on('close',()=>{result.closed=true;});
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.t==='welcome')result.welcome=true;if(m.t==='snapshot')result.snapshots++;});
    await new Promise(resolve=>ws.once('open',resolve));
    if(join)ws.send(JSON.stringify({t:'hello',name:'Capacity fixture'}));
    return result;
  };
  try{await exercise(app,connect);}finally{for(const ws of sockets)ws.terminate();await app.close();}
}
await transportLimits({total:8,perPeer:3,helloMs:250},async(app,connect)=>{
  const a=await connect(),b=await connect(),idle=await connect(false);
  await waitFor(()=>a.welcome&&b.welcome,'healthy joins were rejected');
  const overflow=await connect(false);await waitFor(()=>overflow.closed,'per-peer limit not enforced');
  const ping=setInterval(()=>{if(idle.ws.readyState===1)idle.ws.send('{"t":"pong","id":1}');},25);
  try{await waitFor(()=>idle.closed,'pongs bypassed hello deadline');}finally{clearInterval(ping);}
  const replacement=await connect();await waitFor(()=>replacement.welcome,'closed socket did not release capacity');
  assert(!a.closed&&!b.closed&&a.snapshots>0,'healthy joined clients survive idle socket cleanup');
});
await transportLimits({total:2,perPeer:8,helloMs:1000},async(app,connect)=>{
  const a=await connect(),b=await connect();await waitFor(()=>a.welcome&&b.welcome,'normal joins failed');
  const overflow=await connect(false);await waitFor(()=>overflow.closed,'global limit not enforced');
  assert(!a.closed&&!b.closed);
});
assert.equal(accountClientAddress({socket:{remoteAddress:'198.51.100.7'},headers:{'x-forwarded-for':'192.0.2.1'}},'loopback'),'198.51.100.7',
  'raw untrusted peers cannot choose their connection identity');
const previousTrustedProxies=process.env.ACCOUNT_TRUSTED_PROXIES;
try {
  process.env.ACCOUNT_TRUSTED_PROXIES='';
  await transportLimits({total:8,perPeer:1,helloMs:1000},async(app,connect)=>{
    const first=await connect(true,{'x-forwarded-for':'192.0.2.1'});await waitFor(()=>first.welcome,'direct peer join failed');
    const spoof=await connect(false,{'x-forwarded-for':'192.0.2.2'});await waitFor(()=>spoof.closed,'untrusted XFF bypassed peer cap');
    assert(!first.closed);
  });
  process.env.ACCOUNT_TRUSTED_PROXIES='loopback';
  await transportLimits({total:8,perPeer:1,helloMs:1000},async(app,connect)=>{
    // nginx appends the real peer to any untrusted prefix sent by a client.
    const first=await connect(true,{'x-forwarded-for':'192.0.2.1, 198.51.100.7'});await waitFor(()=>first.welcome,'proxied join failed');
    const spoof=await connect(false,{'x-forwarded-for':'192.0.2.2, 198.51.100.7'});await waitFor(()=>spoof.closed,'spoofed prefix bypassed cap');
    const other=await connect(true,{'x-forwarded-for':'192.0.2.3, 198.51.100.8'});await waitFor(()=>other.welcome,'distinct proxied client was grouped with first');
    assert(!first.closed&&!other.closed);
  });
} finally {
  if(previousTrustedProxies===undefined)delete process.env.ACCOUNT_TRUSTED_PROXIES;
  else process.env.ACCOUNT_TRUSTED_PROXIES=previousTrustedProxies;
}
console.log('Security capacity passed: player/spectator caps, socket limits, trusted proxy chains, join timeout, and positive weapon cooldown.');

import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { WebSocket } from 'ws';
import { makeAuthServer } from './authserver.mjs';

// Real transport coverage. An unhandled callback rejection/exception fails this
// process, just as it would terminate the production server.
const app = makeAuthServer({accountService:null,targetPopulation:0});
app.room._rotateMatch = () => false;
await new Promise(resolve => app.http.listen(0,'127.0.0.1',resolve));
const port=app.http.address().port;
const clients=new Set();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeout=(promise,label)=>Promise.race([promise,new Promise((_,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`Timeout: ${label}`)),2000);timer.unref();
})]);
async function client(join=true) {
  const ws=new WebSocket(`ws://127.0.0.1:${port}`,{origin:'http://localhost'});
  clients.add(ws);ws.on('error',()=>{});
  const result={ws,snapshots:[],welcome:null};
  ws.on('message',raw=>{const packet=JSON.parse(raw);if(packet.t==='snapshot')result.snapshots.push(packet);if(packet.t==='welcome')result.welcome=packet;});
  await timeout(new Promise(resolve=>ws.once('open',resolve)),'open');
  if(join){ws.send(JSON.stringify({t:'hello',name:'Security fixture',readiness:false}));await waitFor(()=>result.welcome,'welcome');}
  return result;
}
async function waitFor(test,label){for(let i=0;i<100;i++){if(test())return;await sleep(15);}throw new Error(`Timeout: ${label}`);}
async function rejected(payload,join=true,expected=1008){
  const {ws}=await client(join);
  const closed=timeout(new Promise(resolve=>ws.once('close',resolve)),'reject malformed packet');
  ws.send(typeof payload==='string'?payload:JSON.stringify(payload));
  assert.equal(await closed,expected);
}
try {
  const healthy=await client();
  await waitFor(()=>healthy.snapshots.length>0,'healthy snapshots');
  const malformed={toString:null,valueOf:null};
  await rejected({t:'hello',name:malformed},false);
  await rejected({t:'input',seq:1,mx:malformed,mz:0});
  await rejected({t:'input',seq:1,mx:0,mz:1,yaw:1e308});
  await rejected('{"t":"input","seq":1e999,"mx":0,"mz":1}');
  await rejected({t:'input',seq:1,sprint:{}});
  await rejected({t:'fire',seq:1,wid:malformed});
  await rejected({t:'reload',wid:malformed});
  await rejected({t:'ability',seq:1,kind:malformed});
  await rejected({t:'ability',seq:1,kind:[]});
  await rejected({t:'pickup',seq:1,padId:malformed});
  await rejected({t:'hello',name:'x'.repeat(3000)},false,1009);

  await timeout(new Promise((resolve,reject)=>{
    const socket=createConnection(port,'127.0.0.1',()=>socket.write(
      'GET http://[ HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'));
    socket.on('data',()=>socket.destroy());socket.on('close',resolve);socket.on('error',reject);
  }),'invalid upgrade target');

  // Exercise unexpected dispatch errors, rather than relying on validation alone.
  const originalInput=app.room.onInput;
  app.room.onInput=function(id,msg){if(msg.mx===0.123)throw new Error('intentional dispatch failure');return originalInput.call(this,id,msg);};
  await rejected({t:'input',seq:1,mx:0.123},true,1011);
  app.room.onInput=originalInput;

  const count=healthy.snapshots.length;
  healthy.ws.send(JSON.stringify({t:'ability',seq:1,kind:'constructor'}));
  healthy.ws.send(JSON.stringify({t:'ability',seq:2,kind:'unknown-future-ability'}));
  healthy.ws.send(JSON.stringify({t:'input',seq:1,mx:0,mz:1,yaw:0,pitch:0,sprint:1,crouch:0,jump:0,crouchDown:0,tele:0,wid:'m4',aiming:0}));
  await waitFor(()=>healthy.snapshots.length>count+1,'surviving room ticks');
  assert(healthy.snapshots.some(s=>s.ack===1),'valid numeric flags continue to work');
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200,'HTTP process still responds');
  assert(healthy.snapshots.every(s=>Number.isFinite(s.you.x)&&Number.isFinite(s.you.y)&&Number.isFinite(s.you.z)));
  console.log('Security boundary passed: malformed WS commands/upgrades isolated; oversized frames rejected; healthy players and HTTP stay alive.');
} finally {
  for(const ws of clients)ws.terminate();
  await app.close();
}

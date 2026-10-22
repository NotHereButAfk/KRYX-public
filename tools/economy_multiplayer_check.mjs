import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {WebSocket} from '../server/node_modules/ws/wrapper.mjs';
import {makeAuthServer} from '../server/authserver.mjs';
const db=await PGlite.create({parsers:{1700:v=>v}});
await db.exec('CREATE TABLE users(id BIGSERIAL PRIMARY KEY);CREATE TABLE user_skins(user_id BIGINT,skin_id TEXT,skin_kind TEXT,PRIMARY KEY(user_id,skin_id));INSERT INTO users DEFAULT VALUES;INSERT INTO users DEFAULT VALUES;');
const query=async(sql,values)=>{if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}],rowCount:1};if(sql.includes('pg_advisory_unlock'))return {rows:[]};const r=values?await db.query(sql,values):(await db.exec(sql)).at(-1);return {...r,rowCount:r.affectedRows??r.rows?.length??0};};
const pool={query,connect:async()=>({query,release(){}})};
const accounts=Object.assign(async()=>false,{pool,ready:Promise.resolve(),session:async req=>{const id=req.headers.cookie?.match(/^fixture=(1|2)$/)?.[1];return id?{id,sessionId:'integration-'+id,username:'Account'+id,ownedSkins:id==='1'?[{id:'remake_84',kind:'character'}]:[]}:null;}});
const app=makeAuthServer({accountService:accounts});await new Promise(resolve=>app.http.listen(0,'127.0.0.1',resolve));
const port=app.http.address().port;const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await delay(25);}throw new Error('Condition timed out');}
const sockets=[];
try{
 await until(()=>[...app.rooms.values()].every(x=>x.economy.runtime.ready));
 async function connect(id){const ws=new WebSocket(`ws://127.0.0.1:${port}`,{origin:'http://localhost',headers:{Cookie:`fixture=${id}`}});const messages=[];ws.on('message',raw=>{const m=JSON.parse(raw);messages.push(m);if(m.t==='ping')ws.send(JSON.stringify({t:'pong',id:m.id}));});await new Promise(r=>ws.once('open',r));ws.send(JSON.stringify({t:'hello',name:'forged-account-name',armorSkin:id===1?'remake_84':'remake_110'}));sockets.push(ws);await until(()=>messages.some(m=>m.t==='welcome'));const pid=messages.find(m=>m.t==='welcome').you;await until(()=>app.room.economy.participant(pid));return {ws,messages,pid};}
 const a=await connect(1),b=await connect(2),runtime=app.room.economy;
 assert.equal(app.room.players.get(a.pid).name,'Account1');
 assert.equal(app.room.players.get(a.pid).armorSkin,'remake_84');
 assert.equal(app.room.players.get(b.pid).armorSkin,undefined);
 await until(()=>b.messages.some(m=>m.players?.some(p=>p.id===a.pid&&p.armorSkin==='remake_84')));
 const c=runtime.match.config;c.minimumMatchSeconds=0;c.minimumActiveSeconds=0;c.minimumScore=0;
 for(const id of [a.pid,b.pid]){runtime.participant(id).joinedAt-=60000;runtime.activity(id,true,1000);app.room.players.get(id).invulnerableUntil=0;}
 a.ws.send(JSON.stringify({t:'kill',score:1000000,e:999999}));a.ws.send(JSON.stringify({t:'add-e',amount:999999}));await delay(100);assert.equal(runtime.participant(a.pid).score,0);
 app.room.players.get(b.pid).killStreak=5;
 app.room._damage(app.room.players.get(b.pid),app.room.players.get(a.pid),200,false);
 await until(()=>a.messages.some(m=>m.t==='earning'));const paid=a.messages.find(m=>m.t==='earning').amount;assert(Number(paid)>=4&&Number(paid)<=5);
 assert.equal(app.room.players.get(b.pid).killStreak,0);assert.equal(app.room.players.get(a.pid).killStreak,1);
 const matchId=runtime.match.id;accounts.onLogout('integration-1');assert.equal(runtime.connections.has(a.pid),false,'logout immediately detaches earning identity');await until(()=>!runtime.connections.has(a.pid));await runtime.queue;
 app.room.matchStart=Date.now()-app.room.matchDurationMs;app.room._rotateMatch();await runtime.queue;
 const balance=(await query('SELECT e_balance FROM users WHERE id=1')).rows[0].e_balance;assert.equal(balance,paid);
 await runtime.store.finalize({id:matchId},1);assert.equal((await query('SELECT e_balance FROM users WHERE id=1')).rows[0].e_balance,paid);
 const expired=[...app.wss.clients].find(ws=>ws._conn?.id===b.pid);
 expired._conn.sessionExpiresAt=Date.now()-1;
 await until(()=>!runtime.connections.has(b.pid));
 assert.equal(expired._conn.alive,false,'expired login stops active earning');
 const discovery=await(await fetch(`http://127.0.0.1:${port}/api/matchmake?mode=survival`)).json();assert.equal(discovery.mode,'survival');assert.equal(discovery.capacity,10);
 console.log('E multiplayer integration passed: authenticated socket identity, ignored fake kills/currency, real damage reward, leave preservation, round finalization and replay protection');
}finally{for(const ws of sockets)ws.terminate();await app.close();await db.close();}

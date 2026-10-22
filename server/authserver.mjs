import { createTournamentService } from './tournamentservice.mjs';
import { relayChat } from './chat.mjs';
import { getArmorSkin } from './characterskins.mjs';
import { TeamRoom } from './teamroom.mjs';
import { SurvivalRoom } from './survivalroom.mjs';
import { createAchievementService } from './achievementservice.mjs';
import { createEconomyService } from './economy/service.mjs';
import { createHash } from 'node:crypto';
// Authoritative game server host (Phase 4) — wraps AuthRoom with the
// connection-level protections the room itself doesn't handle:
//   • origin allow-list          (ALLOWED_ORIGINS env; loopback-only by default)
//   • message schema + size cap   (reject non-JSON / oversized / unknown types)
//   • per-connection rate limit    (token bucket on inbound messages)
//   • replay guard                 (monotonic input/fire seq — in AuthRoom)
//   • heartbeat / dead-socket reap (ping/pong with timeout)
//   • backpressure                 (drop snapshots to a saturated socket)
//   • duplicate-session handling   (a new hello on a live socket is rejected)
//
// Run standalone:  node server/authserver.mjs         (PORT=8788)
// Embedded test:   import { makeAuthServer } from './authserver.mjs'

import { createServer } from 'http';
import { createReadStream, statSync } from 'fs';
import { extname, join, normalize, resolve, sep } from 'path';
import { pipeline } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';
import { createGzip, constants as zlibConstants } from 'zlib';
import { WebSocketServer } from 'ws';
import { AuthRoom, TICK_MS } from './authroom.mjs';
import { createAccountService } from './accountservice.mjs';
import { createPaymentService } from './paymentservice.mjs';
import { createWithdrawalService } from './withdrawals.mjs';

const MAX_MSG_BYTES = 2 * 1024;             // a single command is tiny
const RATE_TOKENS = 60, RATE_REFILL_MS = 1000;   // ~60 msgs/sec sustained
const HEARTBEAT_MS = 5000, DEAD_MS = 12000;
const SEND_BUFFER_CAP = 256 * 1024;         // skip snapshot if socket is backed up
const MAX_NAME = 24;

const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.evmap': 'application/x-evmap',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.gltf', '.evmap']);

const CLEAN_HTML_ROUTES = new Map([
  ['/login', '/login.html'],
  ['/register', '/register.html'],
  ['/earnings', '/earnings.html'],
  ['/economy-admin', '/economy-admin.html'],
  ['/privacy', '/privacy.html'],
  ['/terms', '/terms.html'],
]);

function staticHandler(root) {
  const base = resolve(root);
  return (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }

    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end('Bad request'); return; }
    if (pathname.includes('\0')) { res.writeHead(400); res.end('Bad request'); return; }
    if (pathname === '/tournaments' || pathname === '/tournaments.html') {
      res.writeHead(302, { Location: '/?panel=tournaments', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    else pathname = CLEAN_HTML_ROUTES.get(pathname) || pathname;

    const relative = normalize(pathname.replace(/^[/\\]+/, ''));
    const file = resolve(join(base, relative));
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // Defense in depth if a development/config file is accidentally copied
    // into the public build. Gameplay assets and compiled JS remain public.
    const parts = relative.replaceAll('\\', '/').split('/');
    if (parts.some(part => part.startsWith('.') || ['server', 'src', 'node_modules'].includes(part.toLowerCase()))
        || /(?:\.map|\.mjs|\.cjs|\.env|\.sql|\.sqlite(?:3)?|\.db|\.pem|\.key|\.log|\.bak)$/i.test(relative)
        || /^(?:package(?:-lock)?\.json|vite\.config\.js)$/i.test(relative)) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('Not found'); return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let stat;
    try { stat = statSync(file); } catch { res.writeHead(404); res.end('Not found'); return; }
    if (!stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }

    const ext = extname(file).toLowerCase();
    const immutable = pathname.startsWith('/assets/');
    const cacheControl = ext === '.html'
      ? 'no-cache'
      : immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400, stale-while-revalidate=604800';
    const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const useGzip = stat.size >= 1024 && COMPRESSIBLE.has(ext)
      && /(?:^|,)\s*gzip\s*(?:,|$)/i.test(req.headers['accept-encoding'] || '');
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';
    if (useGzip) headers['Content-Encoding'] = 'gzip';
    else headers['Content-Length'] = stat.size;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers); res.end(); return;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const source = createReadStream(file);
    if (!useGzip) { source.on('error', () => res.destroy()).pipe(res); return; }
    pipeline(source, createGzip({
      level: zlibConstants.Z_BEST_SPEED,
      chunkSize: 64 * 1024,
    }), res, (error) => { if (error && !res.destroyed) res.destroy(error); });
  };
}

const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function originOk(origin) {
  if (ALLOWED.includes('*')) return true;
  if (!origin) return false;
  // An unset allow-list is safe for local development but cannot accidentally
  // expose a production server to arbitrary browser origins.
  if (!ALLOWED.length) return isLoopbackOrigin(origin);
  return ALLOWED.includes(origin);
}

export function randomGuestName(usedNames = new Set(), random = Math.random) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = `Guest${Math.floor(random() * 1_000_000).toString().padStart(6, '0')}`;
    if (!usedNames.has(name)) return name;
  }
  for (let number = 0; number < 1_000_000; number++) {
    const name = `Guest${number.toString().padStart(6, '0')}`;
    if (!usedNames.has(name)) return name;
  }
  return 'Guest000000';
}

function sanitizeName(n, usedNames = new Set()) {
  const c = String(n ?? '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, MAX_NAME);
  if (!c || c === '__guest__' || /^(guest|recruit)$/i.test(c)) {
    return randomGuestName(usedNames);
  }
  return c;
}

export function makeAuthServer({ server, port, staticRoot, targetPopulation = 0, mode = process.env.GAME_MODE || 'deathmatch', accountService = undefined } = {}) {
  if (mode === 'survival') mode = 'deathmatch'; // Temporary maintenance pause.
  if(!['deathmatch','survival'].includes(mode))throw new Error('No authoritative implementation for this mode');
  const Room=mode==='survival'?SurvivalRoom:AuthRoom;
  const room = new Room(undefined, { targetPopulation });
  room.mode=mode;
  const staticFallback = staticRoot
    ? staticHandler(staticRoot)
    : (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('kyx auth server'); };
  const accounts = accountService === undefined ? createAccountService() : accountService;
  const achievements = createAchievementService(accounts);
  const economy = createEconomyService(accounts, {serverId:process.env.E_SERVER_ID || 'public-1',mode,privateMatch:process.env.PRIVATE_MATCH==='1'});
  const payments = createPaymentService(accounts ? { pool: accounts.pool, session: accounts.session, ready: economy?.ready || accounts.ready } : null);
  const tournaments = createTournamentService(accounts ? { pool: accounts.pool, session: accounts.session, ready: economy?.ready || accounts.ready } : null);
  const withdrawals = createWithdrawalService(accounts ? { pool: accounts.pool, session: accounts.session, ready: economy?.ready || accounts.ready } : null);
  room.economy = economy?.runtime || null;
  const rooms=new Map([[mode,{room,economy}]]);
  if(mode==='deathmatch'){
    let previousReady=economy?.ready || Promise.resolve();
    for(const [kind,RoomType] of [['survival',SurvivalRoom]]){
      const other=new RoomType(undefined,{targetPopulation:0});
      const facade=accounts?{pool:accounts.pool,session:accounts.session,ready:previousReady}:null;
      const service=createEconomyService(facade,{serverId:`${process.env.E_SERVER_ID||'public-1'}:${kind}`,mode:kind,privateMatch:process.env.PRIVATE_MATCH==='1'});
      other.economy=service?.runtime||null;rooms.set(kind,{room:other,economy:service});previousReady=service?.ready||previousReady;
    }
  }
  for(const {room} of rooms.values()){room.achievements=achievements;room.tournaments=tournaments;}
  // Bounded invitation rooms stay together across rounds and expire when empty.
  const selectRoom = (url, create = false) => {
    const kind = url.searchParams.get('mode') || mode;
    if (kind === 'survival' || !rooms.has(kind)) return null;
    const code = url.searchParams.get('cgroom');
    if (!code) return rooms.get(kind);
    if (!/^cg-[a-f0-9-]{36}$/.test(code)) return null;
    const key = `${kind}:${code}`;
    if (rooms.has(key)) return rooms.get(key);
    if (!create || [...rooms.values()].filter(entry => entry.privateRoom).length >= 8) return null;
    const RoomType = kind === 'survival' ? SurvivalRoom : AuthRoom;
    const privateRoom = new RoomType(undefined, { targetPopulation: 8 });
    privateRoom.mode = kind;
    // Private invitation matches have no cash rewards or farmable achievements.
    const entry = { room: privateRoom, economy: null, privateRoom: true, lastOccupied: Date.now() };
    rooms.set(key, entry);
    return entry;
  };
  if(achievements)achievements.onEquip=(userId,equipped)=>{
    for(const {room} of rooms.values())for(const p of room.players.values())if(String(p.accountId)===String(userId))p.nameCosmetics=equipped;
  };
  const handler = async (req, res) => {
    let pathname = '';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
    if(pathname.startsWith('/api/achievements')){
      if(achievements)await achievements.handler(req,res,pathname);
      else {res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Sign in on the live server to earn rewards.'}));}
      return;
    }
    if(!economy && pathname.startsWith('/api/e/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'E database unavailable'}));return;}
    if(pathname==='/withdrawal' || pathname==='/withdrawal.html'){res.writeHead(302,{Location:'/earnings','Cache-Control':'no-store'});res.end();return;}
    if (economy && await economy.handler(req, res, pathname)) return;
    if (withdrawals && await withdrawals(req, res, pathname)) return;
    if (payments && await payments(req, res, pathname)) return;
    if (tournaments && await tournaments(req, res, pathname)) return;
    if (!tournaments && (pathname.startsWith('/api/tournaments') || pathname.startsWith('/api/community/'))) {
      res.writeHead(503, {'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'Tournament service is unavailable'}));return;
    }
    if (accounts && await accounts(req, res, pathname)) return;
    if (req.method === 'GET' && pathname === '/api/matchmake') {
      const requestUrl = new URL(req.url,'http://localhost');
      const requestedMode=requestUrl.searchParams.get('mode')||mode;
      const selected=selectRoom(requestUrl, !req.headers.origin || originOk(req.headers.origin));
      if(!selected){res.writeHead(404);res.end();return;}
      const room=selected.room;
      const humans = Array.from(room.players.values()).filter((player) => !player.isBot).length;
      const capacity = requestedMode==='survival'?room.botConfig.desiredParticipants:room.targetPopulation || 8;
      const remainingMs = Math.max(0, room.matchDurationMs - (Date.now() - room.matchStart));
      const body = JSON.stringify({
        available: humans < capacity, mode:requestedMode,
        humans, players: requestedMode==='survival'?room.participants().length:room.players.size, capacity,
        mapId: room.arena.id, mapName: room.arena.name,
        matchStart: room.matchStart, matchDurationMs: room.matchDurationMs,
        remainingMs,
      });
      const origin = req.headers.origin;
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      };
      if (origin && originOk(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers.Vary = 'Origin';
      }
      res.writeHead(200, headers); res.end(body); return;
    }
    staticFallback(req, res);
  };
  const http = server || createServer(handler);
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG_BYTES });

  wss.on('connection', (ws, req) => {
    if (!originOk(req.headers.origin)) { ws.close(1008, 'origin'); return; }
    const selected=selectRoom(new URL(req.url,'http://localhost'), true);
    if(!selected){ws.close(1008,'room unavailable');return;}
    const {room,economy}=selected;

    const conn = {
      id: null, alive: true, lastSeen: Date.now(),
      tokens: RATE_TOKENS, lastRefill: Date.now(),
    };

    const send = (obj) => {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > SEND_BUFFER_CAP) return;   // backpressure: shed load
      ws.send(JSON.stringify(obj));
    };

    const readIdentity = () => accounts ? Promise.resolve(accounts.ready).then(() => accounts.session(req)).catch(() => null) : Promise.resolve(null);
    ws.on('message', async (raw) => {
      if (!conn.alive) return;
      conn.lastSeen = Date.now();
      if (raw.length > MAX_MSG_BYTES) { ws.close(1009, 'too big'); return; }

      // rate limit (token bucket)
      const now = Date.now();
      const refill = ((now - conn.lastRefill) / RATE_REFILL_MS) * RATE_TOKENS;
      conn.tokens = Math.min(RATE_TOKENS, conn.tokens + refill);
      conn.lastRefill = now;
      if (conn.tokens < 1) return;                       // silently drop over-rate
      conn.tokens -= 1;

      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      switch (msg.t) {
        case 'hello':
          if (conn.id != null || conn.joining) return;
          conn.joining = true;
          const identity = await readIdentity();
          if (!conn.alive || ws.readyState !== ws.OPEN) return;
          if (identity && [...wss.clients].some(other => other !== ws && other._conn?.userId === identity.id)) { ws.close(1008, 'account already playing'); return; }
          conn.userId = identity?.id || null; conn.sessionId=identity?.sessionId || null; conn.sessionExpiresAt=identity?.sessionExpiresAt || Infinity;
          conn.id = room.add(send, sanitizeName(
            identity?.username || msg.name,
            new Set(Array.from(room.players.values()).map((player) => player.name)),
          ), msg.readiness === true);
          const requestedSkin=getArmorSkin(msg.armorSkin);
          if(conn.id!=null && identity){
            const player=room.players.get(conn.id);player.accountId=identity.id;
            try{player.nameCosmetics=(await achievements?.profile(identity.id))?.equipped||null;}catch(e){console.error('[name cosmetics]',e.message);}
          }
          if(!conn.alive || (conn.id!=null && !room.players.has(conn.id)))return;
          if(conn.id != null && requestedSkin && identity?.ownedSkins?.some(item => item.kind === 'character' && item.id === requestedSkin.id))room.players.get(conn.id).armorSkin=requestedSkin.id;
          if (conn.id == null) ws.close(1013, 'match full');
          else if (economy) {
            try {
              await economy.ready;
              const peer=String(req.socket.remoteAddress||'');
              const ip=process.env.E_TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||peer).split(',')[0].trim():peer;
              const network=(!ip||(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)&&process.env.E_TRUST_PROXY!=='1'))?null:createHash('sha256').update(`${process.env.E_NETWORK_SALT||economy.runtime.serverId}:${ip}`).digest('hex');
              if (conn.alive) {
                await economy.runtime.join(conn.id, identity ? {...identity,sessionId:identity.sessionId,network} : null, send);
                const p=room.players.get(conn.id), earning=economy.runtime.participant(conn.id);
                if(p && earning){p.score=earning.score;p.kills=earning.kills;p.deaths=earning.deaths;p.assists=earning.assists;}
                if(!conn.alive)economy.runtime.leave(conn.id);
              }
            } catch(e) { console.error('[economy join]',e.message); }
          }
          break;
        case 'chat':
          relayChat(room, conn, msg);
          break;
        case 'spectate':
          if (conn.id != null) {
            room.setSpectating(conn.id, msg.enabled === true);
            send({t:'spectator-state', enabled:!!room.players.get(conn.id)?.spectating});
          }
          break;
        case 'ready':
          if (conn.id != null) room.onReady(conn.id, msg);
          break;
        case 'input':
          if (conn.id != null) room.onInput(conn.id, msg);
          break;
        case 'fire':
          if (conn.id != null) room.onFire(conn.id, msg);
          break;
        case 'reload':
          if (conn.id != null) room.onReload(conn.id, msg);
          break;
        case 'pickup':
          if (conn.id != null) room.onPickup(conn.id, msg);
          break;
        case 'ability':
          if (conn.id != null) room.onAbility(conn.id, msg);
          break;
        case 'pong':
          break;                                         // liveness handled by lastSeen
        default:
          return;                                        // unknown type ignored
      }
    });

    ws.on('close', () => { if (conn.id != null) { economy?.runtime.leave(conn.id); room.remove(conn.id); } conn.alive = false; });
    ws.on('error', () => { try { ws.close(); } catch {} });

    ws._conn = conn;
    ws._send = send;
  });

  if(accounts)accounts.onLogout=sessionId=>{
    for(const {economy} of rooms.values())for(const [id,c] of economy?.runtime.connections||[])
      if(c.identity?.sessionId===sessionId)economy.runtime.leave(id);
    for(const ws of wss.clients)if(ws._conn?.sessionId===sessionId){ws._conn.alive=false;ws.close(1008,'signed out');}
  };

  // fixed-20Hz authoritative loop
  const loop = setInterval(() => {
    for(const ws of wss.clients)if(ws._conn?.alive && ws._conn.sessionExpiresAt <= Date.now())accounts?.onLogout(ws._conn.sessionId);
    for(const [kind,entry]of rooms){
      const {room,economy}=entry;
      const occupied=[...room.players.values()].some(p=>!p.isBot);
      if(occupied)entry.lastOccupied=Date.now();
      if(entry.privateRoom && !occupied && Date.now()-entry.lastOccupied>120000){rooms.delete(kind);continue;}
      if(kind===mode||occupied)room.update();
      economy?.runtime.tick();
    } }, TICK_MS);

  // heartbeat / dead-socket reaping
  const hb = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      const c = ws._conn;
      if (!c) continue;
      if (now - c.lastSeen > DEAD_MS) { try { ws.terminate(); } catch {} continue; }
      ws._send?.({ t: 'ping', id: now });
    }
  }, HEARTBEAT_MS);

  const close = () => new Promise((resolveClose) => {
    clearInterval(loop); clearInterval(hb);
    for (const ws of wss.clients) { try { ws.terminate(); } catch {} }
    wss.close(() => http.close(async () => { try { await achievements?.flush(); await withdrawals?.close?.(); await payments?.close?.(); await tournaments?.close?.(); for(const {economy}of rooms.values())await economy?.runtime.close(); } catch(e){console.error('[economy close]',e.message);} resolveClose(); }));
  });

  if (port) http.listen(port, () => console.log(`[auth] listening on :${port} (tick ${TICK_MS.toFixed(1)}ms)`));
  return { wss, room, rooms, http, close };
}

// standalone entry
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const staticRoot = process.env.STATIC_ROOT || resolve(here, '../dist');
  const targetPopulation = Number.parseInt(process.env.MATCH_PLAYERS || '8', 10);
  const app=makeAuthServer({ port: process.env.PORT || 8788, staticRoot, targetPopulation });
  let closing=false;
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(closing)return;closing=true;await app.close();process.exit(0);});
}

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { IMPORTED_MAPS } from '../src/world/MapRegistry.js';
import { MATCH_DURATION_MS, continuousMatchState } from './matchclock.mjs';

// ───────────────────────────────────────────────────────────────────────────
// kyx.io match-state relay.
//
// This is NOT a full authoritative game server — it doesn't simulate player
// positions, movement, or hit detection (that stays client-side, same as
// before). Its only job is to keep the deathmatch countdown timer and the
// roster of real connected players SHARED across everyone's browser, so
// joining mid-match shows the real elapsed time and the real other players
// instead of everyone getting their own private simulated match.
//
// Deploy this anywhere that can run a persistent Node process (a VPS,
// Fly.io, Railway, Render's paid Web Service tier, ...) — NOT Hostinger
// shared hosting, which only serves static files. Point the client at it by
// setting VITE_WS_URL at build time (see ../.env.example).
// ───────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8787;
const MAX_NAME_LEN = 24;
const KILL_RATE_LIMIT_MS = 150; // guards against a client spamming fake kills

const initialMatch = continuousMatchState(Date.now(), IMPORTED_MAPS.length);
let matchStart = initialMatch.matchStart;
let mapIndex = initialMatch.arenaIndex;
/** @type {Map<import('ws').WebSocket, {id:number, name:string, kills:number, score:number, lastKillAt:number}>} */
const players = new Map();
let nextId = 1;

function sanitizeName(name) {
  const clean = String(name ?? '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, MAX_NAME_LEN);
  return clean || 'Recruit';
}

function rosterPayload() {
  return Array.from(players.values()).map(({ id, name, kills, score }) => ({ id, name, kills, score }));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of players.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastState() {
  broadcast({
    type: 'state',
    matchStart,
    matchDurationMs: MATCH_DURATION_MS,
    mapId: IMPORTED_MAPS[mapIndex].id,
    players: rosterPayload(),
  });
}

// Cycle the match automatically so the arena never actually "ends" — this is
// what makes it a 24/7 server instead of one private match per visit.
setInterval(() => {
  const current = continuousMatchState(Date.now(), IMPORTED_MAPS.length);
  if (current.matchStart !== matchStart) {
    matchStart = current.matchStart;
    mapIndex = current.arenaIndex;
    for (const p of players.values()) { p.kills = 0; p.score = 0; }
    broadcastState();
  }
}, 1000);

// Heartbeat so long-idle clients stay resynced even with no join/leave/kill
// activity (corrects for client clock drift).
setInterval(broadcastState, 5000);

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('kyx.io match server\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const player = { id: nextId++, name: 'Recruit', kills: 0, score: 0, lastKillAt: 0 };
  players.set(ws, player);

  ws.send(JSON.stringify({
    type: 'welcome',
    id: player.id,
    matchStart,
    matchDurationMs: MATCH_DURATION_MS,
    mapId: IMPORTED_MAPS[mapIndex].id,
    players: rosterPayload(),
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'hello') {
      player.name = sanitizeName(msg.name);
      broadcast({ type: 'joined', name: player.name });
      broadcastState();
    } else if (msg.type === 'kill') {
      const now = Date.now();
      if (now - player.lastKillAt < KILL_RATE_LIMIT_MS) return; // drop spam
      player.lastKillAt = now;
      player.kills += 1;
      player.score += 100;
      broadcast({ type: 'kill_feed', name: player.name });
      broadcastState();
    }
  });

  ws.on('close', () => {
    players.delete(ws);
    broadcast({ type: 'left', name: player.name });
    broadcastState();
  });
});

httpServer.listen(PORT, () => {
  console.log(`[kyx-server] listening on :${PORT}`);
});

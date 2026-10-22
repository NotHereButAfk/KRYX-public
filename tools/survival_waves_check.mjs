import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { SurvivalRoom } from '../server/survivalroom.mjs';
import { TICK_HZ } from '../server/authroom.mjs';
import { AuthClient } from '../src/net/AuthClient.js';
import { SurvivalManager } from '../src/core/SurvivalManager.js';
import { SURVIVAL_WAVE_SECONDS, survivalWave, zombieForWave, zombieStats } from '../src/entities/ZombieRoster.js';

for (let wave = 1; wave < 2000; wave++) {
  assert(survivalWave(wave + 1).total > survivalWave(wave).total);
  for (const type of ['walker', 'runner', 'gunner'])
    for (const key of ['health', 'damage', 'speed'])
      assert(zombieStats(wave + 1, type)[key] > zombieStats(wave, type)[key], `${type} ${key} stopped at wave ${wave}`);
}
for (const wave of [1, 2, 3, 4, 10, 30, 100, 1000]) {
  const plan = survivalWave(wave), types = { walker: 0, runner: 0, gunner: 0 };
  for (let i = 0; i < plan.total; i++) types[zombieForWave(wave, i).type]++;
  assert.equal(types.gunner, plan.gunners);
  assert.equal(types.runner, plan.runners);
  if (wave < 4) assert.equal(types.gunner, 0);
  else assert(types.gunner > 0);
}
assert(survivalWave(100).gunners / survivalWave(100).total > survivalWave(10).gunners / survivalWave(10).total);

const arena = { id: 'waves', name: 'Waves', half: 80, killY: -20,
  boxes: [], platforms: [], gravLifts: [], teleporters: [], spawns: [[0, 0, 0], [20, 0, 0]],
  groundHeightAt: () => 0, raycast: (_x, _y, _z, _dx, _dy, _dz, far) => far };
const client = new AuthClient('test');
const room = new SurvivalRoom(arena, { botConfig: { desiredParticipants: 1, maximumBots: 0 } });
const human = room.players.get(room.add(m => client._recv(JSON.stringify(m)), 'Survivor'));
human.invulnerableUntil = Infinity;
room.wave = 29; room.nextWaveTick = 0; room.update();
const plan = survivalWave(30);
assert.equal(room.enemies().length, plan.maxActive);
assert.equal(room.pendingEnemies, plan.total - plan.maxActive);
assert.equal(client.survival.total, plan.total, 'HUD lost authoritative wave totals');
assert.equal(client.survival.pending, room.pendingEnemies, 'HUD lost incoming enemies');
const oldEnemies = room.enemies().map(p => ({ id: p.id, health: p.health }));
const survivedBefore = human.wavesSurvived;
const deadline = room.nextWaveTick;
assert.equal(deadline, SURVIVAL_WAVE_SECONDS * TICK_HZ);
room.tick = deadline - 1; room.update();
assert.equal(room.wave, 30, 'wave started early');
room.update();
assert.equal(room.wave, 31, 'uncleared enemies blocked the next 60-second wave');
for (const old of oldEnemies) {
  assert(room.players.has(old.id), 'next wave removed a living zombie');
  assert.equal(room.players.get(old.id).health, old.health, 'next wave reset an existing zombie');
}
const combined = plan.total + survivalWave(31).total;
assert.equal(room.pendingEnemies + room.enemies().length, combined, 'old queue was replaced');
assert.equal(human.wavesSurvived, survivedBefore + 1);
assert(client.survival.nextWaveIn > 59 && client.survival.nextWaveIn <= 60);
assert(Number.isFinite(client.survival.received));
// Both overlapping waves must drain completely without being relabelled/upgraded.
let defeated = 0;
for (let tick = 0; tick < 1100 && defeated < combined; tick++) {
  for (const p of room.enemies()) {
    if (p.alive) {
      assert([30,31].includes(p.spawnWave));
      assert.equal(p.maxHealth, zombieStats(p.spawnWave, p.enemyType).health);
      room._kill(p, human); defeated++;
    }
  }
  room.update();
  assert(room.enemies().length <= plan.maxActive, 'unbounded active horde');
}
assert.equal(defeated, combined);
assert.equal(room.waveState, 'ACTIVE');
assert.equal(room.pendingEnemies, 0);
assert.equal(room.wave, 31, 'kills changed the timed schedule');
room.tick = room.nextWaveTick - 1; room.update();
assert.equal(room.wave, 31, 'empty wave advanced early');
room.update();
assert.equal(room.wave, 32);
assert.equal(room.waveState, 'ACTIVE');
assert(room.waveTotal > plan.total);
room._kill(human);
room.update();
assert.equal(room.waveState, 'GAME_OVER');
assert.equal(room.pendingEnemies, 0, 'defeat kept spawning reinforcements');
room.remove(human.id);
assert.equal(room.players.size, 0);
assert.equal(room.waveTotal, 0);

const local = new SurvivalManager();
let clears = 0, starts = 0;
local.onWaveClear = () => clears++;
local.onWaveStart = (wave, count) => { starts++; assert.equal(count, survivalWave(wave).total); };
local.update(61, false);
assert.equal(local.waveTimer, 59, 'lost time at the grace-period boundary');
local.update(58, false);
assert.equal(local.wave, 1);
local.update(1, false);
assert.equal(local.wave, 2, 'local wave did not start with enemies still alive');
assert.equal(clears, 0);
local.update(.1, true);
local.update(59.8, true);
assert.equal(local.wave, 2);
local.update(.2, true);
assert.equal(local.wave, 3);
assert.equal(starts, 3);
assert.equal(clears, 1);

// Awareness is global and follows moving humans, but never grants wall damage.
const hunt = new SurvivalRoom({ ...arena, half: 200, raycast: () => 0 },
  { botConfig: { desiredParticipants: 2, maximumBots: 1 } });
const target = hunt.players.get(hunt.add(() => {}, 'Player'));
hunt.nextWaveTick = 0; hunt.update();
const zombie = hunt.enemies()[0], ally = hunt.participants().find(p => p.isBot);
Object.assign(zombie.state, { px: 0, py: 0, pz: 0 });
Object.assign(target.state, { px: 80, py: 0, pz: 80 });
Object.assign(ally.state, { px: 1, py: 0, pz: 1 });
let goal;
hunt.navigation.steer = (_p, point) => { goal = point; return [point[0], point[2]]; };
hunt._driveBot(zombie);
assert.equal(zombie.attackingId, target.id, 'nearby ally distracted zombie from a real player');
assert.deepEqual(goal, [80,0,80], 'distant hidden player was not pursued');
target.state.px = -70;
hunt._driveBot(zombie);
assert.deepEqual(goal, [-70,0,80], 'zombie pursued an outdated last-seen position');
Object.assign(target.state, { px: .5, py: 0, pz: 0 });
const health = target.health; target.invulnerableUntil = 0;
hunt._driveBot(zombie);
assert.equal(target.health, health, 'zombie attacked through cover');
target.spectating = true;
hunt._driveBot(zombie);
assert.equal(zombie.attackingId, ally.id, 'spectator became a zombie target');
target.spectating = false; target.mapReady = false;
hunt._driveBot(zombie);
assert.equal(zombie.attackingId, ally.id, 'loading player became a zombie target');

// Exercise actual Blender zombie instances through multiple reinforcement batches.
let server, browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/wave-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto(server.resolvedUrls.local[0] + 'wave-probe');
  const result = await page.evaluate(async () => {
    const { Game } = await import('/src/core/Game.js');
    for (const deathmatch of [false,true]) {
      let shown=0,hidden=0;
      const probe={_isDM:deathmatch,deaths:0,matchStats:{},
        _beginDeathAnimation(){},_dropLifePickups(){},
        hud:{showRespawn(){shown++},hideRespawn(){hidden++},addKillFeed(){}},
        weaponSystem:{resetMotionState(){}}};
      Game.prototype._onAuthoritativeDeath.call(probe,{});
      if(shown!==Number(deathmatch)||hidden!==Number(!deathmatch)) throw Error('wrong mode respawn overlay');
    }
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { preloadZombieModel } = await import('/src/entities/Zombie.js');
    const { ZombieManager } = await import('/src/entities/ZombieManager.js');
    const { survivalWave } = await import('/src/entities/ZombieRoster.js');
    const { preloadWeaponModels, onWeaponModelsReady } = await import('/src/weapons/WeaponModels.js');
    await preloadZombieModel();
    await new Promise(resolve => { onWeaponModelsReady(resolve); preloadWeaponModels(); });
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const world = { spawnPoints: [new THREE.Vector3()], arenaHalf: 80, resolveCollisions() {} };
    const player = { position: new THREE.Vector3(50, 0, 50), isDead: false };
    const manager = new ZombieManager(world, scene), plan = survivalWave(30);
    manager.spawnWave(plan.total, 1, 1, 30);
    const original = [...manager.zombies];
    manager.spawnWave(survivalWave(31).total, 1, 1, 31);
    const overlapPreserved = original.every(z => manager.zombies.includes(z) && z.spawnWave === 30);
    const walker = manager.zombies.find(z => !z.armedType);
    const gunner = manager.zombies.find(z => z.armedType);
    const beforeWalker = walker.position.distanceTo(player.position);
    const beforeGunner = gunner.position.distanceTo(player.position);
    walker.update(.1, player, camera, () => {});
    gunner.update(.1, player, camera, () => {});
    const globalPursuit = walker.position.distanceTo(player.position) < beforeWalker &&
      gunner.position.distanceTo(player.position) < beforeGunner;
    player.position.copy(gunner.position).z -= 5;
    world.raycastCollisionDistance = () => 0;
    let blockedShots = 0;
    const fire = gunner._fireAt;
    gunner._fireAt = () => blockedShots++;
    gunner.shootCooldown = 0;
    gunner.update(.1, player, camera, () => {});
    gunner._fireAt = fire;
    let killed = 0, maxAlive = 0, sharedDisposed = 0, ownedDisposed = 0;
    const watched = new Set();
    for (let i = 0; i < 1000 && !manager.allDead(); i++) {
      maxAlive = Math.max(maxAlive, manager.zombies.filter(z => z.alive).length);
      for (const z of manager.zombies) {
        z.mesh.traverse(o => {
          if (!o.isMesh || watched.has(o.geometry)) return;
          watched.add(o.geometry);
          o.geometry.addEventListener('dispose', () => {
            if (o.geometry.userData.shared) sharedDisposed++; else ownedDisposed++;
          });
        });
        if (z.alive) { z.die(); killed++; }
      }
      if (killed < plan.total + survivalWave(31).total && manager.allDead()) throw Error('incoming zombies were skipped');
      manager.update(1, player, camera, () => {});
    }
    manager.update(1, player, camera, () => {});
    const empty = scene.children.length === 0 && manager.zombies.length === 0;
    manager.spawnWave(survivalWave(1000).total, 1, 1, 1000);
    const lateActive = manager.zombies.length, latePending = manager.pending;
    manager.clear();
    return { killed, maxAlive, sharedDisposed, ownedDisposed, empty, lateActive, latePending,
      overlapPreserved, globalPursuit, blockedShots,
      cleared: manager.pending === 0 && scene.children.length === 0 };
  });
  assert.equal(result.killed, combined);
  assert(result.overlapPreserved, 'local wave removed older zombies');
  assert(result.globalPursuit, 'local zombies stopped chasing beyond detection range');
  assert.equal(result.blockedShots, 0, 'local gunner shot through cover');
  assert.equal(result.maxAlive, plan.maxActive);
  assert.equal(result.sharedDisposed, 0, 'cleanup destroyed another zombie’s geometry');
  assert(result.ownedDisposed > 0, 'instance-owned resources were never released');
  assert(result.empty && result.cleared, 'old wave left live objects behind');
  assert.equal(result.lateActive, survivalWave(1000).maxActive);
  assert.equal(result.latePending + result.lateActive, survivalWave(1000).total);
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await server?.close(); }
console.log('Endless Survival passed: 60-second overlapping waves, old enemies/queues preserved, global pursuit, no wall attacks, 30 active limit, countdown/HUD, defeat/reset and Blender instance cleanup.');

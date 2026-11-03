import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { SPAWN_PROTECTION_SECONDS } from "../src/sim/DeathTiming.js";
import { Player } from "../src/player/Player.js";
import { AuthRoom, TICK_HZ } from "../server/authroom.mjs";
import { SurvivalRoom } from "../server/survivalroom.mjs";

const arena = {
  id: "spawn-test",
  name: "Spawn Test",
  half: 100,
  killY: -18,
  platforms: [],
  boxes: [],
  spawns: [[0, 0, 0], [15, 0, 0]],
  pickups: [],
  gravLifts: [],
  teleporters: []
};

test("player protection expires after two seconds without movement updates", (t) => {
  let clock = 1000;
  t.mock.method(performance, "now", () => clock);
  assert.equal(SPAWN_PROTECTION_SECONDS, 2);
  const player = new Player(1);
  assert.equal(player.spawnProtected, false);
  player.respawn(new Vector3());
  assert.equal(player.spawnProtected, true);
  clock += 1999;
  assert.equal(player.spawnProtected, true);
  clock += 1;
  assert.equal(player.spawnProtected, false);
  player.respawn(new Vector3(1, 0, 0));
  assert.equal(player.spawnProtected, true);
  clock += 2000;
  assert.equal(player.spawnProtected, false);
});

for (const Room of [AuthRoom, SurvivalRoom]) {
  test(`${Room.name}: enemy damage starts at two seconds; ready ACKs cannot extend it`, () => {
    const room = new Room(arena, { targetPopulation: 0 });
    const target = room.players.get(room.add(() => {}, "Target"));
    const shooter = room.players.get(room.add(() => {}, "Shooter"));
    if (Room === SurvivalRoom) shooter.survivalEnemy = true;
    target.shield = 0;
    const deadline = target.invulnerableUntil;
    assert.equal(deadline - room.tick, 2 * TICK_HZ);
    room.tick = deadline - 1;
    room.onReady(target.id, { mapId: room.arena.id, matchStart: room.matchStart });
    assert.equal(target.invulnerableUntil, deadline);
    room._damage(target, shooter, 25, false);
    assert.equal(target.health, 100);
    room.tick = deadline;
    room._damage(target, shooter, 25, false);
    assert.equal(target.health, 75);
    room.onReady(target.id, { mapId: room.arena.id, matchStart: room.matchStart });
    assert.equal(target.invulnerableUntil, deadline);
  });
}

test("server respawn grants a fresh two seconds", () => {
  const room = new AuthRoom(arena, { targetPopulation: 0 });
  const target = room.players.get(room.add(() => {}, "Respawn"));
  room.tick = target.invulnerableUntil + 10;
  target.alive = false; target.health = 0; target.deadUntil = room.tick + 1;
  room.update();
  assert.equal(target.alive, true);
  assert.equal(target.invulnerableUntil - room.tick, 2 * TICK_HZ);
});

test("self-damage is not blocked by spawn protection", () => {
  const room = new AuthRoom(arena);
  const id = room.add(() => {}, "name");
  const target = room.players.get(id);
  room._damage(target, target, 5, false);
  assert.equal(target.health, 95);
});


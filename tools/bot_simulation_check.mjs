import assert from 'node:assert/strict';
import fs from 'node:fs';
export function checkBotSimulation(results) {
 assert.equal(results.length,4,'simulate every rotating map');
 for(const r of results){assert(r.seconds>=180);assert.equal(r.bots.length,8);for(const b of r.bots){
  assert(b.moving>=75,`${r.map} bot ${b.id}: insufficient movement`);
  assert(b.maxIdleSeconds<2.5,`${r.map} bot ${b.id}: sustained stall`);
  assert(b.uniqueGoals>=4,`${r.map} bot ${b.id}: not completing distinct routes`);
  assert(b.zones>=16,`${r.map} bot ${b.id}: inadequate map coverage`);
 }}
}
if(process.argv[1]?.endsWith('bot_simulation_check.mjs')){
 checkBotSimulation(JSON.parse(fs.readFileSync(process.argv[2]||'artifacts/bot-navigation-final.json')));
 console.log('Simulation passed: 32 bots, four maps, three minutes each; movement, stall, destination and coverage gates');
}

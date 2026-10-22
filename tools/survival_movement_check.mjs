import assert from 'node:assert/strict';
import {createState, makeInput, step, DT} from '../src/sim/MoveSim.js';
import {WALK_SPEED, SPRINT_MULT} from '../src/sim/MovementConfig.js';
import {zombieStats} from '../src/entities/ZombieRoster.js';
import {SurvivalRoom} from '../server/survivalroom.mjs';
import {SurvivalNavigation} from '../server/survival-navigation.mjs';

const arena={id:'movement',name:'Movement',half:100,killY:-20,boxes:[],platforms:[],gravLifts:[],teleporters:[],spawns:[[0,0,0],[0,0,-60]],groundHeightAt:()=>0,raycast:(_x,_y,_z,_dx,_dy,_dz,far)=>far};
const sprint=WALK_SPEED*SPRINT_MULT;
assert.equal(zombieStats(1).speed,sprint);
for(const wave of [1,10,100]) {
  const room=new SurvivalRoom(arena,{botConfig:{maximumBots:0}});
  const human=room.players.get(room.add(()=>{},'survivor'));
  human.invulnerableUntil=Infinity;human.state=createState(0,0,-60);
  room.nextWaveTick=0;room.update();
  const enemy=room.enemies()[0];
  for(const other of room.enemies()) if(other!==enemy)room.players.delete(other.id);
  enemy.state=createState();enemy._lastYaw=0;enemy.enemySpeed=zombieStats(wave).speed;
  let moving=0;
  for(let i=0;i<40;i++){room.update();if(Math.hypot(enemy._animVX,enemy._animVZ)>sprint*.9)moving++;}
  assert(moving>=36,`wave ${wave} repeatedly stops during pursuit`);
  assert(Math.abs(Math.hypot(enemy.state.vx,enemy.state.vz)-enemy.enemySpeed)<.05,`wave ${wave} speed capped`);
  // A higher target requests the standard player's jump, including gravity.
  enemy.state=createState();enemy._lastYaw=0;
  human.state=createState(0,1,-5);room.navigation.lane=()=>[0,1,-5];enemy._enemyLaneAt=0;
  const input=room._driveBot(enemy).inp;
  assert.equal(input.jumpJust,1,'higher target should cause a jump');
  const player=step(createState(),input,arena);
  const zombie=step(createState(),input,arena,{speedScale:enemy.enemySpeed/sprint,snapDown:.3});
  assert.equal(zombie.vy,player.vy);assert(Math.abs(zombie.py-player.py)<.00001);
  enemy.state={...zombie,py:4,onGround:0};
  room.navigation.lane=()=>null;room.navigation.steer=()=>[0,0];enemy._enemyLaneAt=0;
  const airborneInput=room._driveBot(enemy).inp;
  assert.equal(airborneInput.mz,1,'airborne routing stopped jump travel');
  assert.equal(airborneInput.jumpJust,0,'jump repeated while airborne');
}
// Descending a ramp must keep feet supported instead of alternating fall/land.
const ramp={...arena,noBaseFloor:true,platforms:[{minX:-40,maxX:40,minZ:-2,maxZ:2,y0:20,y1:0,axis:'x'}]};
let state=createState(-30,17.5,0), airborne=0;
for(let i=0;i<60;i++) {
  state=step(state,makeInput({mz:1,sprint:true,yaw:-Math.PI/2}),ramp,{speedScale:1.5,snapDown:.3});
  if(!state.onGround)airborne++;
  assert(Math.abs(state.py-(10-state.px*.25))<.001,'feet left ramp surface');
}
assert.equal(airborne,0);
const navigation=new SurvivalNavigation({tick:0},{});
const fast={state:createState(),enemySpeed:24,survivalAI:{nextPath:10,path:[[0,0,-1],[0,0,-8]],goal:[0,0,-8],pathAt:0}};
assert.deepEqual(navigation.steer(fast,[0,0,-8]),[0,-8],'fast enemy circled a waypoint inside its next step');
console.log('Survival movement passed: sprint pace, later-wave speed, continuous pursuit, player jump impulse and downhill support.');

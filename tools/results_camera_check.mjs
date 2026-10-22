import { RESULTS_SECONDS, SCOREBOARD_SECONDS, postMatchPhase } from '../src/sim/MatchFlow.js';
globalThis.document={getElementById:()=>null};
globalThis.SCOREBOARD_SECONDS=SCOREBOARD_SECONDS;
globalThis.postMatchPhase=postMatchPhase;
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera } from 'three';
assert.equal(RESULTS_SECONDS,10,'only the ten-second scoreboard remains');
const source=readFileSync(new URL('../src/core/Game.js',import.meta.url),'utf8');
function body(name,next) { return source.split(name)[1].split(next)[0].trim().replace(/}\s*$/,''); }
const show=new Function('finalRows','buildLeaderboardRows','RESULTS_SECONDS','UserAccount',body('  _showLeaderboard(finalRows = null) {','  _updateLeaderboard('));
const update=new Function('dt','cameraDt','RESULTS_SECONDS',body('  _updateLeaderboard(dt, cameraDt = dt) {','  _saveStats('));
const camera=new PerspectiveCamera(73,1.6,.1,800);camera.position.set(8,3,-7);camera.rotation.set(.2,.7,.1);
const game={state:'playing',player:{camera,name:'tester'},menuCamera:new PerspectiveCamera(),_saveStats(){},_buildScoreboardRows(){return[]},weaponSystem:{weaponMount:{visible:true}},input:{exitPointerLock(){}},hud:new Proxy({},{get:()=>()=>{}}),matchStats:{shotsFired:0},_updateMenuScene(){throw Error('Results moved scene');},_restart(){throw Error('Premature restart');}};
show.call(game,[],x=>x,15,{isGuest:()=>true});
assert.deepEqual(game.menuCamera.position.toArray(),camera.position.toArray());
assert.deepEqual(game.menuCamera.quaternion.toArray(),camera.quaternion.toArray());
assert.equal(game.menuCamera.fov,camera.fov);
const pose=[...game.menuCamera.position.toArray(),...game.menuCamera.quaternion.toArray(),game.menuCamera.fov];
for(let i=0;i<120;i++)update.call(game,1/60,1/60,15);
assert.deepEqual([...game.menuCamera.position.toArray(),...game.menuCamera.quaternion.toArray(),game.menuCamera.fov],pose);
assert.ok(game._lbTimer<15 && game._lbTimer>12,'countdown still progresses');
const menu=body('  _updateMenuScene(dt, cameraDt = dt) {','  _tick(');
// The early guard is exercised without any scene dependencies: touching them throws.
const guard=new Function('dt','cameraDt',menu.slice(0,menu.indexOf('    if (this._spectating')));
guard.call({_authNet:{client:{postMatch:{}}}},1/60,1/60);
console.log('Results camera passed: final pose/FOV retained, camera frozen while countdown advances, spectator post-match guard.');

assert.deepEqual(postMatchPhase(10),{ads:false,seconds:10});
assert.deepEqual(postMatchPhase(5.01),{ads:false,seconds:6});
assert.deepEqual(postMatchPhase(5),{ads:false,seconds:5});
assert.deepEqual(postMatchPhase(0),{ads:false,seconds:0});

let hidden=true, adSeconds='', standingsHidden=false;
globalThis.document={getElementById:id=>id==='post-match-ads'?{classList:{toggle:(key,value)=>hidden=value}}:id==='post-match-ad-countdown'?{set textContent(value){adSeconds=value;}}:null};
game.hud={hideLeaderboard(){standingsHidden=true;},updateLeaderboardCountdown(){}};
game._lbTimer=6;
update.call(game,.5,.5,15);
assert.equal(hidden,true);
update.call(game,.5,.5,15);
assert.equal(hidden,true);
assert.equal(adSeconds,'');
assert.equal(standingsHidden,false);
let restarted=false;game._restart=()=>{restarted=true;};
update.call(game,5,5,15);
assert.equal(restarted,true);
console.log('Post-match sequence passed: standings remain visible; no advertising phase before restart.');

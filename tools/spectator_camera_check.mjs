#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SpectatorCameraRig } from '../src/core/SpectatorCameraRig.js';
import { buildSpectatorTour, spectatorTourCurves, safeSpectatorRoutes, makeSpectatorClearance } from '../src/core/SpectatorTour.js';

const source = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
assert.match(source, /new THREE\.CatmullRomCurve3\([\s\S]*?closed, 'centripetal'/,
  'spectator camera must use a smooth spline');
assert.match(source, /this\._camPath\.getPointAt\(u, this\._camPos\)/,
  'spectator position must advance continuously along the route');
assert.match(source, /this\._camLookPath\.getPointAt\(u, this\._camLook\)/,
  'spectator look direction must roam with the route');
assert.match(source, /map\.spectatorRoutes[\s\S]*?this\._camRouteIndex = \(this\._camRouteIndex \+ 1\) % this\._camRoutes\.length/,
  'spectator must float through every authored arena viewpoint');
assert.match(source, /Math\.max\(24, pathLength \/ 5\)/,
  'fallback orbit must float at a smooth map-touring speed');
assert.match(source, /const fadeWindow = this\._camDolly \? 0\.65 : 0\.9[\s\S]*?this\.canvas\.style\.opacity = opacityText/,
  'spectator must hide safe-lane changes instead of exposing camera cuts');
assert.match(source, /_updateMenuScene\(dt, cameraDt = dt\)[\s\S]*?this\._camTravelTime \+= cameraStep/,
  'spectator travel must use its own presentation delta');
assert.match(source, /const cameraStep = THREE\.MathUtils\.clamp\(cameraDt, 0, 1 \/ 30\)/,
  'spectator must cap long-frame travel so a hitch cannot become a camera leap');
assert.match(source, /this\._spectatorRig\.update\(this\._camPos, this\._camLook, cameraStep\)/,
  'the visible camera must use the smooth dolly head');
assert.match(source, /this\.world\.currentMap[\s\S]*?this\.botManager\.addBot\(false, 1, false\)[\s\S]*?this\._menuBotSpawnCooldown = 0\.12/,
  'spectator bots must be staggered behind real map readiness');
assert.match(source, /this\._menuBotSpawnTarget = 1/,
  'spectator must not simulate a duplicate full lobby behind the menu');
assert.match(source, /this\.botManager\.update\([\s\S]*?this\._menuDummyPlayer[\s\S]*?this\.world, true,/,
  'spectator bots must use normal bot-versus-bot combat');
assert.doesNotMatch(source, /_camStallTime/, 'the camera must never skip forward during overview travel');
assert.match(source, /if \(routeChanged\) cameraOpacity = 0/,
  'a spectator route cut must remain fully hidden for its first frame');
assert.match(source, /bot\.healthBarGroup\.visible = false/,
  'menu bots must not spend draw calls on combat-only health bars');
assert.doesNotMatch(source, /Math\.max\(54, this\._camPath\.getLength\(\) \/ 6\.5\)/,
  'spectator must not retain the old nearly-static 54 second minimum');
assert.match(source, /if \(this\._spectatorLoading \|\| !this\.world\.currentMap\) return/,
  'spectator route must not advance unseen behind the loading screen');
assert.match(source, /this\._resetSpectatorCamera\(\)[\s\S]*?this\._spectatorLoading = false[\s\S]*?el\.classList\.add\('ml-fade'\)/,
  'map reveal must reset the visible fly-through before fading the loader');

const safeNodes = [
  { p: new THREE.Vector3(0, 2, 0), t: new THREE.Vector3(5, 1, 5) },
  { p: new THREE.Vector3(8, 2, 0), t: new THREE.Vector3(5, 1, 5) },
  { p: new THREE.Vector3(8, 2, 8), t: new THREE.Vector3(5, 1, 5) },
  { p: new THREE.Vector3(0, 2, 8), t: new THREE.Vector3(5, 1, 5) },
];
const tour = buildSpectatorTour([safeNodes], () => true);
assert.ok(tour?.length >= safeNodes.length + 1, 'spectator graph did not tour every connected viewpoint');
assert.ok(tour[0].p.distanceTo(tour.at(-1).p) < 1e-6, 'collision-safe spectator tour did not close');
const continuous = spectatorTourCurves(tour, () => true);
let maximumStep = 0;
for (let i = 1; i <= 1000; i++) {
  const a = continuous.path.getPointAt((i - 1) / 1000, new THREE.Vector3());
  const b = continuous.path.getPointAt(i / 1000, new THREE.Vector3());
  maximumStep = Math.max(maximumStep, a.distanceTo(b));
}
assert.ok(maximumStep < 0.2, `spectator tour contains a visible camera cut (${maximumStep}m)`);

const points = [
  new THREE.Vector3(-20, 12, 30), new THREE.Vector3(30, 15, 20),
  new THREE.Vector3(20, 13, -30), new THREE.Vector3(-30, 16, -20),
];
const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);
const start = curve.getPointAt(0);
const quarter = curve.getPointAt(0.25);
const end = curve.getPointAt(1);
assert.ok(start.distanceTo(quarter) > 20, 'route must materially move around the map');
assert.ok(start.distanceTo(end) < 1e-6, 'route must loop without a camera cut');
const duration = Math.max(60, curve.getLength() / 2.2);
const sampleA = curve.getPointAt(0.25);
const sampleB = curve.getPointAt(0.25 + 1 / duration);
assert.ok(sampleA.distanceTo(sampleB) > 1 && sampleA.distanceTo(sampleB) < 3,
  'spectator must float visibly without racing around the arena');

const { elevatedSpectatorRoutes } = await import('../src/core/SpectatorTour.js');
const raised = elevatedSpectatorRoutes([safeNodes], () => true)[0];
assert.ok(raised.every((n,i)=>n.p.y-safeNodes[i].p.y===14), 'open areas must use the high overview');
assert.equal(safeNodes[0].p.y,2,'do not mutate map waypoints');
const ceiling = elevatedSpectatorRoutes([safeNodes], (a,b)=>b.y<=3)[0];
assert.equal(ceiling.length,0, 'cramped lanes must fall back to an aerial view, not eye-level flight');
const mixed = elevatedSpectatorRoutes([safeNodes], (a,b)=>a.x!==0 || a.z!==0 || b.y<=3)[0];
assert.equal(mixed.length,3,'discard only the cramped viewpoint');
assert(mixed.every(n=>n.p.y===16),'one doorway dragged the whole flight down');

assert(raised.every(n=>n.p.y===raised[0].p.y),'a flat lane must not have artificial vertical bob');
const ends=[];
for(const hz of [30,60,144]) {
  const camera=new THREE.PerspectiveCamera(),rig=new SpectatorCameraRig(camera);
  const position=new THREE.Vector3(20,6,0),focus=new THREE.Vector3(0,2,0);
  rig.reset(position,focus);
  let maxTurn=0,maxAcceleration=0,previousSpeed=0;
  for(let i=1;i<=hz*60;i++) {
    const t=i/hz,angle=t*.09;
    position.set(Math.cos(angle)*20,6,Math.sin(angle)*20);
    // A focal point crossing the camera used to cause an instant 180-degree whip.
    const target=i>hz*30 && i<hz*32 ? position.clone().add(new THREE.Vector3(.01,0,0)) : focus;
    rig.update(position,target,1/hz);
    maxTurn=Math.max(maxTurn,Math.abs(rig.yawSpeed));
    maxAcceleration=Math.max(maxAcceleration,Math.abs(rig.yawSpeed-previousSpeed)*hz);
    previousSpeed=rig.yawSpeed;
    assert(Math.abs(camera.rotation.z)<1e-8,'the cinematic horizon must remain level');
  }
  assert(maxTurn<=THREE.MathUtils.degToRad(16.01),'camera turn exceeded cinematic speed limit');
  assert(maxAcceleration<=THREE.MathUtils.degToRad(24.01),'camera angular acceleration snapped');
  ends.push({position:camera.position.clone(),rotation:camera.quaternion.clone()});
  const before=camera.position.clone();position.x+=2;
  rig.update(position,focus,.5);
  assert(camera.position.distanceTo(before)<.8,'a frame hitch became a camera leap');
}
assert(ends[0].position.distanceTo(ends[2].position)<.025,'camera travel depends on refresh rate');
assert(ends[0].rotation.angleTo(ends[2].rotation)<.015,'camera turn depends on refresh rate');
const openLine=safeNodes.slice(0,2);
assert.equal(buildSpectatorTour([openLine],()=>true),null,'a dead-end lane must not be a reversing circuit');
assert.equal(safeSpectatorRoutes([safeNodes],()=>true).length,1,'a clear dolly lane was discarded');
assert.equal(safeSpectatorRoutes([safeNodes],(a,b)=>a.x<4 && b.x<4).length,0,'an obstructed dolly lane was retained');
for(let i=1;i<tour.length-1;i++)assert.notEqual(tour[i-1],tour[i+1],'tour doubles back like a walking player');
console.log('spectator camera passed: level elevated loops, overview travel, limited turn speed/acceleration, 30/60/144Hz and hitch recovery');

// Translation eases into motion and settles without bouncing past the target.
for (const hz of [30, 60, 144]) {
  const camera = new THREE.PerspectiveCamera(), rig = new SpectatorCameraRig(camera);
  const start = new THREE.Vector3(0, 6, 0), end = new THREE.Vector3(2, 6, 0);
  const focus = new THREE.Vector3(0, 6, -10);
  rig.reset(start, focus);
  let previous = 0;
  for (let i = 0; i < hz * 3; i++) {
    rig.update(end, focus, 1 / hz);
    assert(camera.position.x >= previous - 1e-8 && camera.position.x <= 2, 'flight bounced or overshot');
    if (i === 0) assert(camera.position.x < .03, 'flight started with a position snap');
    previous = camera.position.x;
  }
  assert(Math.abs(camera.position.x - 2) < .001, 'flight failed to settle');
  rig.clearSegment = () => false;
  rig.update(start, focus, 1 / hz);
  assert(camera.position.distanceTo(start) < 1e-8, 'smoothing entered an obstructed corner');
}

// Execute the real menu update with a moving network actor: menu flight must
// remain independent, while explicit Spectate continues to follow actors.
const menuTail=source.slice(source.indexOf('  _updateMenuScene('));
const menuBody=menuTail.slice(0,menuTail.search(/\n  (?:async )?[\w$]+\(/));
const updateMenu=new Function('THREE', 'return function'+menuBody.slice(menuBody.indexOf('(')).trim())(THREE);
for(const network of [false,true])for(const menu of [false,true]){
  let followed=0,flown=0,worldTicks=0,networkTicks=0;
  const game={_spectating:true,_spectateMenu:menu,state:'menu',
    _authNet:network?{client:{},updateSpectator(){networkTicks++;}}:null,
    world:{currentMap:{},update(){worldTicks++;}},weaponSystem:{updateEffects(){}},
    previewCharacter:{visible:false},_menuBotsActive:false,_spawnMenuBots(){},
    _updatePlayerSpectator(){followed++;},_spectatorLoading:false,
    _camTravelTime:0,_camCycleDuration:60,_camRoutes:[[]],_camFadeIn:0,
    canvas:{style:{}},_camPos:new THREE.Vector3(),_camLook:new THREE.Vector3(),
    _camPath:{getPointAt(u,p){p.set(u*20,10,0);}},
    _camLookPath:{getPointAt(u,p){p.set(u*20,0,-20);}},
    _spectatorRig:{update(){flown++;}}};
  for(let i=0;i<60;i++)updateMenu.call(game,1/60,1/60);
  assert.equal(followed,menu?0:60,'menu must never inherit actor follow');
  assert.equal(flown,menu?60:0,'Click to Play must use independent flight');
  assert.equal(worldTicks,60,'world must tick only once per frame');
  assert.equal(networkTicks,network?60:0,'live actors must keep updating');
  if(menu)assert(Math.abs(game._camTravelTime-1)<1e-9);
}
console.log('Menu camera separation passed: independent flight with and without network; explicit Spectate retains follow.');

// Execute the real presentation gate through menu, death, pause, loading,
// and spectator transitions. showMain alone is not evidence of an attract view.
const homeTail=source.slice(source.indexOf('  _updateHomePresentation('));
const homeBody=homeTail.slice(0,homeTail.search(/\n  (?:async )?[\w$]+\(/));
const updateHome=new Function('getMode','MAX_PLAYERS','return function'+homeBody.slice(homeBody.indexOf('(')).trim())(id=>({name:id.toUpperCase()}),8);
const sceneUpdates=[];
const homeGame={state:'menu',_spectating:false,_spectateMenu:false,_spectatorLoading:false,
  menu:{_activePanel:null,selectedModeId:'deathmatch',centerPlay:{classList:{contains:()=>false}},
    setHomeScene(active,details){sceneUpdates.push({active,details});}},
  world:{currentMap:{definition:{name:'Rook'}}}};
updateHome.call(homeGame,1/60);
assert.deepEqual(sceneUpdates.at(-1),{active:true,details:{mapName:'Rook',modeName:'DEATHMATCH',capacity:8}});
for(const override of [{state:'playing'},{state:'leaderboard'},{_spectatorLoading:true},{_spectating:true,_spectateMenu:false}]){
  sceneUpdates.length=0;
  updateHome.call({...homeGame,...override},1/60);
  assert.deepEqual(sceneUpdates,[{active:false,details:undefined}],'home styling leaked into gameplay/loading/spectating');
}
sceneUpdates.length=0;
updateHome.call({...homeGame,menu:{...homeGame.menu,_activePanel:'profile'}},1/60);
assert.equal(sceneUpdates.at(-1).active,false,'profile must retain its own backdrop');
updateHome.call({...homeGame,_spectating:true,_spectateMenu:true,_homeInfoTimer:0},1/60);
assert.equal(sceneUpdates.at(-1).active,true,'spectator menu must return to the independent map tour');
console.log('Home presentation passed: map metadata, gameplay/death/pause isolation, loading, panels and spectator transitions.');

for (const hz of [30,60,144]) {
  const camera=new THREE.PerspectiveCamera(),rig=new SpectatorCameraRig(camera);
  const p=new THREE.Vector3(0,14,0),focus=new THREE.Vector3(0,12,-30);
  rig.reset(p,focus);
  let wall=2;
  rig.raycast=()=>wall;
  for(let i=0;i<hz*3;i++){
    const previous=camera.fov;
    rig.update(p,focus,1/hz);
    assert(camera.fov>=previous && camera.fov<=78,'lens overshot near a wall');
    assert(camera.fov-previous<1.2,'lens snapped near a wall');
  }
  assert.equal(camera.fov,60,'menu lens must remain fixed near walls');
  wall=Infinity;
  for(let i=0;i<hz*4;i++)rig.update(p,focus,1/hz);
  assert(camera.fov<60.03,'lens did not return to its open-space FOV');
  assert.equal(camera.position.y,14,'lens adjustment changed flight height');
}
console.log('Fixed menu lens passed: wall proximity leaves framing unchanged at 30/60/144Hz.');

const { menuDollyShots } = await import('../src/core/SpectatorTour.js');
const shots = menuDollyShots([safeNodes],()=>true);
assert(shots.length > 0);
for (const shot of shots) {
  const heading=shot[0].t.clone().sub(shot[0].p).normalize();
  for(const node of shot) {
    assert.equal(node.p.y,shot[0].p.y,'dolly must not bob');
    assert(node.t.clone().sub(node.p).normalize().angleTo(heading)<0.17,'dolly bend must be gentle');
    assert(node.t.y<node.p.y,'elevated dolly must frame the arena below it');
  }
  assert(shot[0].p.distanceTo(shot.at(-1).p)>=10,'shot must visibly travel');
}
assert.equal(menuDollyShots([safeNodes],()=>false).length,0,'blocked flight must be rejected');
const lane = [[{p:new THREE.Vector3(0,2,0),t:new THREE.Vector3(0,2,-30)}]];
const openShot=menuDollyShots(lane,()=>true)[0];
assert.equal(openShot[0].p.y,10,'open establishing shot must rise well above players');
assert(Math.abs(openShot.at(-1).p.x)>1,'open establishing shot should gently bend');
const lowShot=menuDollyShots(lane,(a,b)=>Math.max(a.y,b.y)<7)[0];
assert.equal(lowShot[0].p.y,6,'respect the ceiling instead of forcing the high route');
const corridor=menuDollyShots(lane,(a,b)=>Math.abs(a.x)<.2 && Math.abs(b.x)<.2)[0];
assert(corridor.every(n=>Math.abs(n.p.x)<1e-8),'narrow corridor must use a straight safe lane');
const wallShot=menuDollyShots(lane,(a,b)=>Math.min(a.z,b.z)>-23)[0];
assert(wallShot.at(-1).p.z>=-17,'shot must end with clearance before a wall');
assert.equal(menuDollyShots(lane,(a,b)=>Math.min(a.z,b.z)>-12).length,0,
  'a short flight ending nose-to-wall must be rejected');
const crampedThenOpen = [...lane, [{p:new THREE.Vector3(100,2,0),t:new THREE.Vector3(100,2,-30)}]];
const rankedShots = menuDollyShots(crampedThenOpen,(a,b)=>a.x>50 || Math.max(a.y,b.y)<5);
assert.equal(rankedShots.length,2,'safe lower room must remain available as a later shot');
assert(rankedShots[0][0].p.x>50,'opening shot must favor the clear panorama over the first cramped spawn');

// Geometric side clearance must be identical in both horizontal directions.
// Previously a parallel wall 0.5m beside an X-directed path was missed entirely.
for(const travel of ['x','z']) {
  const side=travel==='x'?'z':'x';
  const box=new THREE.Box3(new THREE.Vector3(-2,-2,-2),new THREE.Vector3(12,2,12));
  box.min[side]=.45;box.max[side]=.8;
  box.min[travel]=4;box.max[travel]=6;
  const hit=new THREE.Vector3();
  const clear=makeSpectatorClearance({raycastCollisionDistance(ray,distance){
    return ray.intersectBox(box,hit)?Math.min(distance,ray.origin.distanceTo(hit)):Infinity;
  }});
  const a=new THREE.Vector3(),b=new THREE.Vector3();b[travel]=10;
  assert.equal(clear(a,b),false,`${travel}-directed route did not protect the side of the camera`);
}
console.log('Menu shots passed: elevated bends, ceiling and corridor fallback, endpoint breathing room, orientation-independent wall clearance.');

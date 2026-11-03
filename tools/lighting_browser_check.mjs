import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const phase=process.env.KYX_LIGHTING_PHASE||'before';
const output=resolve(process.env.KYX_LIGHTING_OUTPUT||'artifacts/lighting');
const posesFile=resolve(process.env.KYX_LIGHTING_POSES||'artifacts/lighting/poses.json');
mkdirSync(output,{recursive:true});
mkdirSync(resolve(posesFile,'..'),{recursive:true});
const poses=phase==='before'?{}:JSON.parse(readFileSync(posesFile,'utf8'));
const errors=[];
const qualityChecks=[];
const shadowChecks=[];
const rotationChecks=[];
const browser=await chromium.launch({executablePath:process.env.CHROME,
 args:['--use-gl=swiftshader','--enable-webgl','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(?:googleapis|gstatic)\.com/,r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.addInitScript(()=>localStorage.setItem('sio_settings',JSON.stringify({quality:'medium',volume:0})));
 await page.goto(process.env.KYX_URL||'http://127.0.0.1:5997/?qa=1',{waitUntil:'commit'});
 await page.waitForFunction(()=>{const g=window.__game||window.game;return g?.world?.currentMap&&!g._startupInFlight;},null,{timeout:120000});
 await page.evaluate(()=>{
  const g=window.__game||window.game;cancelAnimationFrame(g._rafId);
  g._authNet?.disconnect?.();g._authNet=null;g.net?.disconnect?.();g.serverSim?.stop();
  g.botManager.clear();g.pickupSystem?.dispose();g.previewCharacter.visible=false;
  g.weaponSystem.weaponMount.visible=false;g.player.camera.visible=false;
  for(const el of document.body.children) if(el.tagName!=='SCRIPT'&&!el.querySelector('canvas')&&el.tagName!=='CANVAS')el.style.display='none';
  const canvas=g.renderer.domElement;canvas.style.opacity='1';
  for(const id of ['top-nav','nav-side','center-play','mobile-home','hud','connect-screen','map-loading','qa-follow-bot'])document.getElementById(id)?.style.setProperty('display','none','important');
 });
 for(const id of phase==='before'?['evasion','fractal','gypsum']:['evasion','fractal','gypsum','ancient']){
  const captured=await page.evaluate(async({id,saved})=>{
   const g=window.__game||window.game;
   const reused=g.world.currentMapId===id;
   const map=await g.world.loadMap(id);g._configureMapCamera(map);g._ensureEnvironment();
   const camera=g.menuCamera;camera.fov=78;camera.aspect=1280/720;camera.far=600;
   let pose=saved;
   if(!pose){
    const spawn=g.world.spawnPoints.find(p=>p.y<=3.1)||g.world.spawnPoints[0];
    const origin=spawn.clone();origin.y+=1.7;
    const ray=g.world._groundRay.clone();ray.origin.copy(origin);
    let best=-Infinity,yaw=Number.isFinite(spawn.spawnYaw)?spawn.spawnYaw:0;
    for(let i=0;i<24;i++){
     const angle=i*Math.PI/12;
     ray.direction.set(-Math.sin(angle),0,-Math.cos(angle));
     const d=Math.min(70,g.world.raycastCollisionDistance(ray,70));
     const score=d-Math.abs(Math.atan2(Math.sin(angle-yaw),Math.cos(angle-yaw)))*.01;
     if(score>best){best=score;pose={position:origin.toArray(),yaw:angle,pitch:-.04,fov:78};}
    }
   }
   camera.position.fromArray(pose.position);camera.rotation.order='YXZ';camera.rotation.set(pose.pitch,pose.yaw,0);camera.fov=pose.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
   // The initial map may already have a populated startup cache. Re-enable
   // its quality tier to observe one real cache build; later maps test load invalidation.
   if(reused)g._setRuntimeQuality('low');
   g._setRuntimeQuality('medium');
   let first=0,second=0,excluded=0,pass=1;
   const hooks=[];let template=null;
   g.world._mapRoot.traverse(o=>{if(o.isMesh&&o.castShadow){
    template||=o;const prior=o.onBeforeShadow;hooks.push([o,prior]);
    o.onBeforeShadow=(...args)=>{if(pass===1)first++;else second++;prior?.apply(o,args);};
   }});
   const dummy=template?.clone(false);
   if(dummy){dummy.name='qa-excluded-shadow-caster';dummy.onBeforeShadow=()=>excluded++;g.world.scene.add(dummy);}
   g.world.lighting?.prepareFrame();
   try{g.renderer.render(g.world.scene,camera);}finally{g.world.lighting?.restoreFrame();}
   pass=2;
   g.world.lighting?.prepareFrame();
   try{g.renderer.render(g.world.scene,camera);}finally{g.world.lighting?.restoreFrame();}
   for(const [o,prior]of hooks)o.onBeforeShadow=prior;
   if(dummy)g.world.scene.remove(dummy);
   g.world.lighting?.prepareFrame();
   try{g.renderer.render(g.world.scene,camera);}finally{g.world.lighting?.restoreFrame();}
   return {pose,shadows:{id,first,second,excluded,autoUpdate:g.world._sun.shadow.autoUpdate}};
  },{id,saved:poses[id]||null});
  const {pose,shadows}=captured;
  await page.screenshot({path:resolve(output,`${phase}-${id}.png`)});
  console.log(`${phase} ${id}`,JSON.stringify({pose,shadows}));
  if(phase==='after'){
   assert(shadows.first>0,`${id}: architecture shadow cache never populated`);
   assert.equal(shadows.second,0,`${id}: cached shadow redrew next frame`);
   assert.equal(shadows.excluded,0,`${id}: non-map actor leaked into cached shadow`);
   assert.equal(shadows.autoUpdate,false);
   shadowChecks.push(shadows);
  }
  poses[id]=pose;
 }
 if(phase==='before')writeFileSync(posesFile,JSON.stringify(poses,null,2));
 if(phase==='after'){
  for(const quality of ['high','medium','low']){
   const stats=await page.evaluate(async({quality,pose})=>{
    const g=window.__game||window.game;
    if(g.world.currentMapId!=='fractal'){
     const map=await g.world.loadMap('fractal');g._configureMapCamera(map);g._ensureEnvironment();
    }
    const camera=g.menuCamera;
    camera.position.fromArray(pose.position);camera.rotation.set(pose.pitch,pose.yaw,0,'YXZ');
    camera.fov=pose.fov;camera.aspect=1280/720;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    g._setRuntimeQuality(quality);
    g.world.lighting.prepareFrame();
    try{
     if(g._bloomEnabled){g.renderPass.camera=camera;g.composer.render();}
     else g.renderer.render(g.world.scene,camera);
    }finally{g.world.lighting.restoreFrame();}
    return {quality:g._runtimeQuality,bloom:g._bloomEnabled,shadows:g.renderer.shadowMap.enabled,
      sunCastsShadow:g.world._sun.castShadow,shadowSize:g.world._sun.shadow.mapSize.toArray(),
      exposure:g.renderer.toneMappingExposure,shadowTarget:!!g.world._sun.shadow.map};
   },{quality,pose:poses.fractal});
   assert.equal(stats.quality,quality);assert.equal(stats.bloom,quality==='high');
   assert.equal(stats.shadows,quality!=='low');assert.equal(stats.sunCastsShadow,quality!=='low');
   assert.equal(stats.shadowSize[0],quality==='high'?2048:1024);
   assert.equal(stats.shadowTarget,quality!=='low');
   qualityChecks.push(stats);
   await page.screenshot({path:resolve(output,`after-fractal-${quality}.png`)});
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
   const g=window.__game||window.game;
   g._setRuntimeQuality('low');g.renderer.setSize(390,844);
   g.menuCamera.aspect=390/844;g.menuCamera.updateProjectionMatrix();
   g.world.lighting.prepareFrame();
   try{g.renderer.render(g.world.scene,g.menuCamera);}finally{g.world.lighting.restoreFrame();}
  });
  await page.screenshot({path:resolve(output,'after-fractal-mobile-low.png')});
  const rotation=await page.evaluate(async()=>{
   const g=window.__game||window.game;
   const {IMPORTED_MAPS}=await import('/src/world/MapRegistry.js');
   const samples=[];
   for(let lap=0;lap<2;lap++)for(const definition of IMPORTED_MAPS){
    await g.world.loadMap(definition.id);
    g.world.lighting.prepareFrame();
    try{g.renderer.render(g.world.scene,g.menuCamera);}finally{g.world.lighting.restoreFrame();}
    samples.push({lap,map:definition.id,geometries:g.renderer.info.memory.geometries,
     textures:g.renderer.info.memory.textures,lights:g.world.scene.children.filter(o=>o.isLight).length,
     mapRoots:g.world.scene.children.filter(o=>o===g.world._mapRoot).length});
   }
   return samples;
  });
  rotationChecks.push(...rotation);
  writeFileSync(resolve(output,`${phase}-report.json`),JSON.stringify({phase,poses,shadowChecks,qualityChecks,rotationChecks,pageErrors:errors},null,2));
  for(const sample of rotation){
   assert.equal(sample.mapRoots,1);
   if(sample.lap){const first=rotation.find(x=>x.lap===0&&x.map===sample.map);
    assert.equal(sample.lights,first.lights,`${sample.map}: lights grew across rotation`);
    assert(sample.textures<=first.textures+1,`${sample.map}: textures grew across rotation`);
    assert(sample.geometries<=first.geometries+1,`${sample.map}: geometry grew across rotation`);
   }
  }
 }
 assert.equal(errors.length,0,errors.join('\n'));
 writeFileSync(resolve(output,`${phase}-report.json`),JSON.stringify({phase,poses,shadowChecks,qualityChecks,rotationChecks,pageErrors:errors},null,2));
}finally{await browser.close();}

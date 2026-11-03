import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.KYX_URL || 'http://127.0.0.1:5997/?qa=1';
const output = resolve(process.env.KYX_SKILL_OUTPUT || 'artifacts/bot-skill');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] });
const errors = [];
const report = {};
async function prepare(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.fulfill({status:200,contentType:'text/css',body:''}));
  await page.addInitScript(() => {
    let locked = null;
    Object.defineProperty(document, 'pointerLockElement', {configurable:true,get:()=>locked});
    Element.prototype.requestPointerLock = function() {
      locked = this;
      queueMicrotask(()=>document.dispatchEvent(new Event('pointerlockchange')));
      return Promise.resolve();
    };
    document.exitPointerLock = () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); };
  });
}
async function ready(page) {
  await page.goto(url, {waitUntil:'commit',timeout:30000});
  await page.waitForFunction(() => {
    const g = window.__game || window.game;
    return g?.world?.currentMap && !g._startupInFlight
      && document.getElementById('connect-screen')?.classList.contains('hidden');
  }, null, {timeout:120000});
  const mobile = await page.evaluate(()=>document.body.classList.contains('mobile-ui'));
  await page.locator(mobile ? '#mobile-play' : '#play-btn').waitFor({state:'visible',timeout:30000});
}
try {
  if (!process.env.KYX_MOBILE_ONLY) {
  const page = await browser.newPage({viewport:{width:1280,height:720}});
  await prepare(page);
  await ready(page);
  await page.locator('.nav-item[data-panel="settings"]').click();
  await page.locator('#set-vol').fill('35');
  await page.locator('#set-vol').dispatchEvent('input');
  await page.locator('#quality-btns [data-q="low"]').click();
  await page.locator('#settings-save-btn').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sio_settings')).volume), .35);
  await ready(page);
  await page.locator('.nav-item[data-panel="settings"]').click();
  assert.equal(await page.locator('#set-vol').inputValue(),'35');
  await page.locator('#panel-settings [data-close-panel]').click();
  report.settingsPersisted = true;
  console.log('Settings save/reload passed.');
  await page.locator('#play-btn').click({force:true});
  await page.waitForFunction(()=>(window.__game||window.game)?.state==='playing',null,{timeout:60000});
  await page.evaluate(()=>{
    const g=window.__game||window.game;
    g._menuOpen=false;
    g._authNet?.disconnect?.();g._authNet=null;g._netDriven=false;
    g.serverSim?.stop();
    for(const id of ['top-nav','nav-side','share-game','social-icons','center-play']) document.getElementById(id)?.classList.add('hidden');
  });
  await page.screenshot({path:resolve(output,'desktop-match.png')});
  report.botFixture = await page.evaluate(async()=>{
    const g=window.__game||window.game;
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {Bot}=await import('/src/entities/Bot.js');
    const {disposeModel}=await import('/src/core/ModelResources.js');
    const world={arenaHalf:80,killY:-20,groundHeightAt:()=>0,resolveCollisions(){},raycastCollisionDistance:(_r,far)=>far};
    const bot=new Bot(world,new THREE.Vector3());
    const target={position:new THREE.Vector3(0,0,-12),isDead:false};
    let shots=0,damage=0,travel=0,moving=0;
    const fire=bot.mesh.userData.triggerFire;
    bot.mesh.userData.triggerFire=(...args)=>{shots++;fire?.(...args);};
    for(let frame=0;frame<600;frame++){
      const before=bot.position.clone();
      bot.update(1/60,target,g.player.camera,amount=>damage+=amount,world);
      bot.mesh.updateMatrixWorld(true);
      const delta=before.distanceTo(bot.position);
      travel+=delta;if(delta>.01)moving++;
    }
    const result={shots,damage,travel,movingFrames:moving,totalFrames:600};
    disposeModel(bot.mesh);
    return result;
  });
  assert(report.botFixture.shots>5,'real rendered Bot did not fire');
  assert(report.botFixture.damage>0,'real Bot ray shots never hit exposed target');
  assert(report.botFixture.travel>15,'real Bot did not reposition');
  assert(report.botFixture.movingFrames>300,'real Bot remained stationary too long');
  console.log('Bot fixture:',JSON.stringify(report.botFixture));
  await page.evaluate(()=>{
    const g=window.__game||window.game;g.botManager.clear();
    const spawn=g.world.spawnPoints.find(p=>p.y<=3.1)||g.world.spawnPoints[0];
    g.player.respawn(spawn);g.player.yaw=Number.isFinite(spawn.spawnYaw)?spawn.spawnYaw:0;
    g.player.velocity.set(0,0,0);g.input.pointerLocked=true;
  });
  const before=await page.evaluate(()=>{const g=window.__game||window.game;return {x:g.player.position.x,z:g.player.position.z,yaw:g.player.yaw,ammo:g.weaponSystem.currentState.magAmmo};});
  await page.keyboard.down('w');
  await page.waitForTimeout(800);
  await page.keyboard.up('w');
  await page.mouse.move(640,360);
  await page.mouse.move(740,320,{steps:5});
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  report.input = await page.evaluate(()=>{const g=window.__game||window.game;return {x:g.player.position.x,z:g.player.position.z,yaw:g.player.yaw,ammo:g.weaponSystem.currentState.magAmmo};});
  assert(Math.hypot(report.input.x-before.x,report.input.z-before.z)>.1,'keyboard movement failed');
  assert.notEqual(report.input.yaw,before.yaw,'mouse look failed');
  assert(report.input.ammo<before.ammo,'mouse fire failed');
  console.log('Desktop keyboard/mouse passed:',JSON.stringify(report.input));
  writeFileSync(resolve(output,'browser-report.json'),JSON.stringify(report,null,2));
  await page.close();
  }
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  await prepare(mobile);await ready(mobile);
  await mobile.screenshot({path:resolve(output,'mobile-menu.png')});
  await mobile.locator('#mobile-play').tap({force:true});
  await mobile.waitForFunction(()=>(window.__game||window.game)?.state==='playing',null,{timeout:60000});
  report.mobile=await mobile.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,state:(window.__game||window.game).state}));
  assert.equal(report.mobile.state,'playing');
  await mobile.screenshot({path:resolve(output,'mobile-match.png')});
  assert.equal(errors.length,0,errors.join('\n'));
  report.pageErrors=errors;
  writeFileSync(resolve(output,process.env.KYX_MOBILE_ONLY ? 'mobile-report.json' : 'browser-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }

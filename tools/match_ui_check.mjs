import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
let browser;
try {
 await server.listen();browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1600,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname!=='/favicon.ico')errors.push(`${r.status()} ${r.url()}`);});
 await page.route(/fonts\.(?:googleapis|gstatic)\.com/,r=>r.fulfill({body:'',contentType:'text/css'}));
 await page.goto(server.resolvedUrls.local[0]);
 await page.waitForFunction(()=>window.__game?.previewCharacter?.userData.isEvCharacter,null,{timeout:60000});
 const earnings=await page.evaluate(async()=>{
  const {Shop}=await import('/src/core/Shop.js');const {BattlePass}=await import('/src/core/BattlePass.js');
  const game=window.__game,credited=[];
  const addCoins=Shop.addCoins,addXP=BattlePass.addXP;
  Shop.addCoins=n=>credited.push(n);BattlePass.addXP=()=>{};
  const mock={kills:0,score:0,matchStats:game._newMatchStats(),_pendingCoins:0,_isDM:true,
   hud:new Proxy({},{get:()=>()=>{}}),dmManager:{onKill:()=>({coins:12,streak:1})},
   survivalManager:{zombieKillReward:()=>.6,waveBonus:()=>1},player:{name:'Test'},
   _refreshNavCoins:()=>{},_creditMatchCoins:game._creditMatchCoins};
  try{
   game._onEnemyKilled.call(mock,null,null,2);const deathmatch=mock.matchStats.earnedCoins;
   mock._isDM=false;mock._isSurvival=true;
   game._onEnemyKilled.call(mock,null,null);game._onEnemyKilled.call(mock,null,null);
   const survival=mock.matchStats.earnedCoins;
   mock._isSurvival=false;game._onEnemyKilled.call(mock,null,null,1.5);
   return {deathmatch,survival,total:mock.matchStats.earnedCoins,credited:credited.reduce((a,b)=>a+b,0),reset:game._newMatchStats().earnedCoins};
  }finally{Shop.addCoins=addCoins;BattlePass.addXP=addXP;}
 });
 assert.deepEqual(earnings,{deathmatch:24,survival:25,total:40,credited:40,reset:0});
 for(const mapId of ['daytime-rook','winter-graveyard']) {
  await page.evaluate(id=>window.__game._showMapLoading('deathmatch',id,{autoHide:false}),mapId);
  const layout=await page.evaluate(async()=>{
   const panel=document.querySelector('.ml-panel').getBoundingClientRect();
   const screen=document.getElementById('map-loading');
   const image=new Image();image.src=screen.style.getPropertyValue('--ml-image').slice(5,-2);await image.decode();
   return {ratio:panel.width/innerWidth,image:image.naturalWidth,title:screen.querySelector('.ml-name').textContent};
  });
  assert(layout.ratio>=.18 && layout.ratio<=.24);assert(layout.image>=1280);assert(!layout.title.includes('LOADING'));
  if(process.env.MATCH_UI_SHOTS) {fs.mkdirSync(process.env.MATCH_UI_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.MATCH_UI_SHOTS}/loading-${mapId}.png`});}
 }
 await page.evaluate(()=>{window.__game._hideMapLoading();document.querySelector('#play-btn').click();});
 await page.waitForFunction(()=>window.__game.state==='playing');
 await page.evaluate(()=>{
  const g=window.__game;g._menuOpen=false;
  for(const id of ['top-nav','nav-side','share-game','social-icons','center-play'])document.getElementById(id)?.classList.add('hidden');
  const rows=g._buildScoreboardRows();rows[0]={...rows[0],isYou:true,isBot:false,name:'<img src=x onerror=alert(1)>',score:1200,kills:12,deaths:3,assists:2};
  g.hud.showLeaderboard(rows,'Reference',60,{shotsFired:20,hits:5,damageDealt:420,headshots:2,bestStreak:4,earnedCoins:60});
 });
 assert.equal(await page.locator('#sb-rows tr').count(),8);
 assert.deepEqual(await page.locator('#sb-rows tr').first().locator('td').allTextContents(),['1.','<img src=x onerror=alert(1)>YOU','1,200','2','12','3','4']);
 assert.equal(await page.locator('#sb-rows img').count(),8,'names must remain text');
 assert(await page.locator('.sb-portrait').first().evaluate(img=>img.complete&&img.naturalWidth>0));
 if(process.env.MATCH_UI_SHOTS) {
  await page.evaluate(()=>{
   document.querySelector('#sb-rows .sb-player-name').textContent='Guest2246';
   document.querySelector('#sb-winner .sb-winner-name').textContent='Guest2246';
   window.__game.hud.updateLeaderboardCountdown(10,10);
   document.querySelectorAll('#sb-rows tr').forEach((row,i)=>row.classList.toggle('sb-row-you',i===0));
  });
  await page.screenshot({path:`${process.env.MATCH_UI_SHOTS}/scoreboard-desktop.png`});
 }
 await page.keyboard.press('ArrowRight');assert(await page.locator('#sb-earn-view').isVisible());assert.equal(await page.locator('#sb-earned').textContent(),'60.00');
 await page.keyboard.press('ArrowRight');assert(await page.locator('#sb-performance-view').isVisible());assert((await page.locator('#sb-performance').textContent()).includes('25.0%'));
 await page.evaluate(()=>window.__game.hud.showScoreboard(window.__game._buildScoreboardRows()));
 assert(await page.locator('#sb-performance-view').isVisible(),'refresh preserves selected tab');
 await page.keyboard.press('ArrowRight');
 await page.evaluate(()=>document.exitPointerLock());
 await page.waitForFunction(()=>!document.pointerLockElement);
 await page.evaluate(()=>{
  window.__game._menuOpen=false;
  for(const id of ['top-nav','nav-side','share-game','social-icons','center-play'])document.getElementById(id)?.classList.add('hidden');
 });
 for(const tab of ['earn','performance','leaderboard']) {
  await page.locator(`[data-sb-tab="${tab}"]`).click();
  assert(await page.locator(`#sb-${tab}-view`).isVisible());
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>window.__game.hud.showLeaderboard(window.__game._buildScoreboardRows(),'Reference',60));
 const bounds=await page.locator('.sb-panel').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391);
 if(process.env.MATCH_UI_SHOTS)await page.screenshot({path:`${process.env.MATCH_UI_SHOTS}/scoreboard-mobile.png`});
 await page.evaluate(()=>window.__game.hud.hideScoreboard());assert(!await page.locator('#scoreboard-overlay').isVisible());
 await page.setViewportSize({width:1600,height:900});
 const columnWidths=await page.evaluate(()=>{
  const h=window.__game.hud,rows=window.__game._buildScoreboardRows();
  h.hideLeaderboard();h.showScoreboard(rows);
  const widths=()=>[...document.querySelectorAll('.sb-table th')].map(e=>e.getBoundingClientRect().width);
  const live=widths();h.showLeaderboard(rows,'Reference',3);const end=widths();
  h.hideLeaderboard();h.showScoreboard(rows);
  return {live,end};
 });
 assert.deepEqual(columnWidths.live,columnWidths.end,'columns must not jump between live and final standings');
 if(process.env.MATCH_UI_SHOTS)await page.screenshot({path:`${process.env.MATCH_UI_SHOTS}/scoreboard-live.png`});
 const unified=await page.evaluate(()=>{
  const h=window.__game.hud,rows=[{name:'Same player',score:120,kills:2,deaths:1,assists:1,isYou:true}];
  h.showScoreboard(rows);const before=document.getElementById('sb-rows').innerHTML;
  h.showLeaderboard(rows,'Same player',3);h.updateLeaderboardCountdown(9,10);
  const same=before===document.getElementById('sb-rows').innerHTML;
  h.updateTeleport(.5);h.updateGrenades(1,1,{frag:7.5,smoke:15});
  return {same,oldHidden:document.getElementById('leaderboard-overlay').classList.contains('hidden'),blink:document.getElementById('ability-q').style.getPropertyValue('--ready'),frag:document.getElementById('frag-count').closest('.grenade-slot').style.getPropertyValue('--ready'),smoke:document.getElementById('smoke-count').closest('.grenade-slot').style.getPropertyValue('--ready')};
 });
 assert.deepEqual(unified,{same:true,oldHidden:true,blink:'50%',frag:'50%',smoke:'0%'});
 const economyHud=await page.evaluate(async()=>{
  const {EarningsUI}=await import('/src/ui/EarningsUI.js');const ui=new EarningsUI();
  ui.update({guest:true});const guestHidden=ui.el.classList.contains('hidden');
  ui.update({guest:false,balance:'4695.0000',finalE:'3.0000',sessionE:'0',dailyE:'3',dailyCap:null,itemMultiplier:'1',modeMultiplier:'2',eventMultiplier:'1',survivalMultiplier:'1'});
  const result={guestHidden,visible:!ui.el.classList.contains('hidden'),rate:ui.el.querySelector('[data-e="rate"]').textContent,balance:ui.el.querySelector('[data-e="balance"]').textContent,keys:[...document.querySelectorAll('#grenade-wrap .grenade-label')].map(e=>e.textContent)};
  ui.dispose();return result;
 });
 assert.deepEqual(economyHud,{guestHidden:true,visible:true,rate:'2x',balance:'4,695.00',keys:['G','U','V','E']});
 const shieldLayout=await page.evaluate(()=>{
  const h=window.__game.hud;h.show();
  const p={health:80,maxHealth:100,shield:25,maxShield:50,stamina:100,maxStamina:100};
  h.update(p,{name:'Rifle',isMelee:false,magAmmo:50,reserveAmmo:100,slots:[]},0,0);
  const health=document.querySelector('#health-wrap .bar-bg').getBoundingClientRect(),shield=document.querySelector('#shield-wrap .bar-bg').getBoundingClientRect();
  return {aligned:Math.abs(health.x-shield.x)<1&&Math.abs(health.y-shield.y)<1&&Math.abs(health.width-shield.width)<1,width:document.getElementById('shield-bar').style.width,popup:!!document.getElementById('e-summary')};
 });
 assert.deepEqual(shieldLayout,{aligned:true,width:'50%',popup:false});
 assert.deepEqual(errors,[]);
 console.log('Match UI passed: both map images, responsive scoreboard, real stats, escaped names, portraits and working tabs');
}finally{await browser?.close();await server.close();}

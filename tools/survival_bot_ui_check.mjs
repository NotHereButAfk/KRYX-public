import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeAuthServer } from '../server/authserver.mjs';
const app=makeAuthServer({accountService:null});
await new Promise(resolve=>app.http.listen(0,'127.0.0.1',resolve));
const port=app.http.address().port;
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
let browser;
try{
 await vite.listen();browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(?:googleapis|gstatic)\.com/,r=>r.fulfill({body:'',contentType:'text/css'}));
 await page.goto(vite.resolvedUrls.local[0]+'?qa=1&authnet='+encodeURIComponent('ws://127.0.0.1:'+port));
 await page.waitForFunction(()=>window.__game?.previewCharacter?.userData.isEvCharacter,null,{timeout:120000});
 await page.evaluate(()=>window.__game.menu.onPlay('QA survivor',undefined,'survival'));
 await page.waitForFunction(()=>window.__game?.state==='playing'&&window.__game?._authNet?.ready&&window.__game._authNet.client.survival?.participants===10,null,{timeout:120000});
 const state=await page.evaluate(()=>{
  const g=window.__game,rows=g._buildScoreboardRows();g.hud.showScoreboard(rows,'Survival');
  return {rows,bots:g._authNet.client.roster.filter(p=>p.survivalAlly).length,enemies:g._authNet.client.survival.enemies,localBots:g.botManager.bots.length};
 });
 assert.equal(state.rows.length,10);assert.equal(state.bots,9);assert.equal(state.localBots,0);
 assert.equal(await page.locator('.np-bot').count(),0,'multiplayer overhead names must not have BOT badges');
 assert.equal(await page.locator('#sb-rows tr').count(),10);assert.equal(await page.locator('#sb-rows .sb-bot-badge').count(),0);
 assert.equal(await page.locator('#sb-rows tr').first().locator('td').count(),7);
 if(process.env.SURVIVAL_UI_SHOTS){fs.mkdirSync(process.env.SURVIVAL_UI_SHOTS,{recursive:true});await page.screenshot({path:process.env.SURVIVAL_UI_SHOTS+'/survival-scoreboard.png'});}
 const room=app.rooms.get('survival').room;
 room.nextWaveTick=room.tick;
 await page.waitForFunction(()=>window.__game._authNet.client.survival.enemies>0,null,{timeout:15000});
 await page.setViewportSize({width:844,height:390});
 await page.evaluate(()=>window.__game.hud.showScoreboard(window.__game._buildScoreboardRows(),'Survival'));
 assert.equal(await page.locator('#sb-rows tr').count(),10,'enemies never occupy scoreboard rows');
 const panel=await page.locator('.sb-panel').boundingBox();assert(panel.y>=0&&panel.y+panel.height<=390);
 await page.locator('#sb-rows tr').last().scrollIntoViewIfNeeded();
 const last=await page.locator('#sb-rows tr').last().boundingBox();assert(last.y>=0&&last.y+last.height<=390);
 await page.evaluate(()=>{document.querySelector('#sb-leaderboard-view').scrollTop=0;document.querySelector('#qa-follow-bot')?.remove();});
 if(process.env.SURVIVAL_UI_SHOTS)await page.screenshot({path:process.env.SURVIVAL_UI_SHOTS+'/survival-scoreboard-mobile.png'});
 assert.deepEqual(errors,[]);
 console.log('Survival browser passed: real WebSocket match, nine remote allies, no local duplicate bots, participant-only scoreboard and live wave state at desktop/mobile sizes.');
}finally{await browser?.close();await vite.close();await app.close();}

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const html=read('../index.html').replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,'').replaceAll('https://acceptable.a-ads.com/2458071/?size=Adaptive','about:blank').replace('</head>','<style>'+read('../src/style.css')+'</style></head>');
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 await page.setContent(html,{waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('#frame').evaluate(e=>e.parentElement.tagName),'BODY');
 assert.equal(await page.locator('#app').evaluate(e=>e.parentElement.tagName),'BODY');
 const clear=()=>page.locator('iframe[data-aa]').evaluate(f=>{const r=f.getBoundingClientRect();return r.width>=100&&r.height>=40&&r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&[r.left+1,r.left+r.width/2,r.right-1].every(x=>[r.top+1,r.top+r.height/2,r.bottom-1].every(y=>document.elementFromPoint(x,y)===f));});
 assert.equal(await clear(),true,'initial HTML banner is unobstructed');
 await page.addScriptTag({content:read('../src/ui/InlineAds.js').replace('export function','function')+'\ninstallInlineAds();'});
 const show=async id=>{await page.evaluate(id=>{document.querySelectorAll('.nav-panel,#connect-screen,#map-loading,#post-match-ads,#center-play,#top-nav,#scoreboard-overlay').forEach(e=>e.classList.toggle('hidden',e.id!==id));},id);await page.waitForTimeout(350);};
 const stable=await page.locator('iframe[data-aa]').elementHandle();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(350);
 assert.equal(await stable.evaluate(e=>e.isConnected),true,'backgrounding must not cancel the loading ad');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 for(const viewport of [{width:1918,height:1070},{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
  await page.setViewportSize(viewport);
  for(const id of ['connect-screen','map-loading','center-play','top-nav','panel-loadout','panel-shop','panel-settings','post-match-ads']) {
   await show(id);
   assert.equal(await page.locator('iframe[data-aa]').count(),1,id);
   assert.equal(await clear(),true,id+' '+JSON.stringify(viewport)+' '+await page.locator('iframe[data-aa]').evaluate(f=>{const r=f.getBoundingClientRect();return JSON.stringify({r:r.toJSON(),hits:[.01,.5,.99].flatMap(x=>[.01,.5,.99].map(y=>document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)?.outerHTML.slice(0,100)))});}));
   assert.equal(await stable.evaluate(e=>e.isConnected),true,'same iframe across screens');
   const top=await page.locator('#app').evaluate(e=>e.getBoundingClientRect().top);
   assert.equal(top,0,'banner never shifts the top of the application');
   const appBottom=await page.locator('#app').evaluate(e=>e.getBoundingClientRect().bottom);
   if(['connect-screen','map-loading'].includes(id)) assert.equal(appBottom,viewport.height,'loading map extends behind banner');
   else assert.ok(Math.abs(appBottom-(viewport.height-await page.locator('#frame').evaluate(e=>e.getBoundingClientRect().height)))<1,'gameplay and menus reserve exact banner height');
   const banner=await page.locator('#frame').boundingBox();
   assert.ok(Math.abs(banner.x+banner.width/2-viewport.width/2)<1,'banner centred');
   if(viewport.width===1918) assert.ok(Math.abs(banner.width-911.05)<1,'recorded desktop banner width');
   await page.locator('#'+id).evaluate(e=>e.scrollTop=250);
   assert.equal(await page.locator('#frame').evaluate(e=>e.getBoundingClientRect().bottom),viewport.height,'banner stays at bottom while scrolling');
  }
 }
 await show('scoreboard-overlay');
 assert.equal(await page.locator('iframe[data-aa]').count(),1,'banner remains through results');
 await show(null);
 assert.equal(await page.locator('#frame').isVisible(),true,'gameplay keeps banner');
 assert.equal(await stable.evaluate(e=>e.isConnected),true,'no reload when gameplay starts');
 assert.equal(await page.locator('#app').evaluate(e=>e.getBoundingClientRect().bottom),await page.locator('#frame').evaluate(e=>e.getBoundingClientRect().top),'HUD viewport ends above banner');
 assert.equal(await page.locator('#app').evaluate(e=>e.getBoundingClientRect().top),0,'gameplay fills viewport');
 await show('center-play');
 assert.equal(await clear(),true,'menu restores banner');
 console.log('Sticky ads passed: initial HTML, stable iframe, loading/menu/pages, scrolling, four viewports and persistent gameplay banner.');
} finally {await browser.close();}

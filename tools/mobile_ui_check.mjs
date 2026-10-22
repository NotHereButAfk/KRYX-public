import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
let browser;
try {
 await server.listen();
 browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:844,height:390},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(?:googleapis|gstatic)\.com/,r=>r.fulfill({body:'',contentType:'text/css'}));
 await page.goto(process.env.MOBILE_UI_URL || server.resolvedUrls.local[0]);
 await page.waitForFunction(()=>window.__game?.previewCharacter?.userData.isEvCharacter,null,{timeout:120000});
 if(await page.locator('#auth-guest-btn').isVisible()) await page.locator('#auth-guest-btn').tap();
 await page.locator('#mobile-play').waitFor({state:'visible',timeout:60000});
 assert.equal(await page.locator('#mobile-play').textContent(),'TAP TO PLAY');
 async function shot(name){if(process.env.MOBILE_UI_SHOTS){fs.mkdirSync(process.env.MOBILE_UI_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.MOBILE_UI_SHOTS}/${name}.png`});}}
 await shot('mobile-menu-landscape');
 const unreachable=await page.evaluate(()=>[...document.querySelectorAll('#top-nav [data-panel]')].map(el=>el.dataset.panel).filter(panel=>!document.querySelector(`#mobile-home [data-panel="${panel}"], #panel-more [data-panel="${panel}"]`)));
 assert.deepEqual(unreachable,[], 'every desktop panel remains reachable on mobile');
 for(const panel of ['abilities','settings','loadout']) {
  await page.locator(`#mobile-home [data-panel="${panel}"]`).tap();
  assert(await page.locator(`#panel-${panel}`).isVisible());
  await page.locator(panel === 'loadout' ? '#inv-close-btn' : `#panel-${panel} [data-close-panel]`).first().tap();
 }
 await page.setViewportSize({width:390,height:844});await shot('mobile-menu-portrait');
 await page.setViewportSize({width:844,height:390});
 await page.locator('#mobile-play').tap();
 await page.waitForFunction(()=>window.__game.state==='playing' && !document.querySelector('#mobile-controls').classList.contains('hidden'),null,{timeout:120000});
 await shot('mobile-controls-landscape');
 await page.locator('.mbtn-menu').tap();
 assert.equal(await page.locator('#mobile-play').textContent(),'TAP TO RESUME');
 await page.locator('#mobile-play').tap();
 assert(await page.locator('#mobile-controls').isVisible());
 await page.setViewportSize({width:390,height:844});await shot('mobile-controls-portrait');
 // Isolate real input handlers from the simulation consuming the keys each frame.
 await page.evaluate(async()=>{
  window.__game.mobileControls.dispose();
  const {MobileControls}=await import('/src/ui/MobileControls.js');
  const input={keys:new Set(),justPressed:new Set(),mouseDX:0,mouseDY:0,mouseDown:false,rightMouseDown:false,wheelDelta:0,setVirtualKey(k,v){v?this.keys.add(k):this.keys.delete(k);}};
  window.touchProbe={input,controls:new MobileControls(input)};touchProbe.controls.show();
 });
 const cdp=await page.context().newCDPSession(page),points=new Map();
 async function point(selector){return page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});}
 async function touch(type,id,p){if(type==='touchEnd'){const released=points.get(id);points.delete(id);await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[released]});}else{points.set(id,{id,...p});await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[...points.values()]});}}
 const joy=await point('#joy-outer'),fire=await point('.mbtn-fire'),slide=await point('.mbtn-slide'),aim=await point('.mbtn-aim');
 await touch('touchStart',1,{x:joy.x,y:joy.y-50});
 await touch('touchStart',2,fire);await touch('touchStart',3,slide);await touch('touchStart',4,aim);
 assert(await page.evaluate(()=>touchProbe.input.keys.has('KeyW')&&touchProbe.input.keys.has('KeyC')&&touchProbe.input.mouseDown&&touchProbe.input.rightMouseDown));
 await touch('touchMove',2,{x:fire.x-10,y:fire.y});
 assert(await page.evaluate(()=>touchProbe.input.mouseDX<0));
 await touch('touchEnd',1);
 await page.waitForFunction(()=>!touchProbe.input.keys.has('KeyW')&&touchProbe.input.keys.has('KeyC')&&touchProbe.input.mouseDown);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});points.clear();
 assert(await page.evaluate(()=>!touchProbe.input.keys.size&&!touchProbe.input.mouseDown&&!touchProbe.input.rightMouseDown));
 for(const [role,key]of [['smoke','KeyG'],['swap','WeaponNext'],['grenade','KeyU'],['timebomb','KeyV'],['impulse','KeyE'],['reload','KeyR'],['jump','Space'],['ability','KeyQ']]){
  await page.locator(`.mbtn-${role}`).tap();assert(await page.evaluate(k=>touchProbe.input.justPressed.has(k),key));
 }
 for(const viewport of [{width:390,height:844},{width:844,height:390},{width:667,height:375}]){
  await page.setViewportSize(viewport);
  const boxes=await page.locator('.mbtn').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{name:el.dataset.role,x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(const b of boxes)assert(b.x>=0&&b.y>=0&&b.x+b.w<=viewport.width+1&&b.y+b.h<=viewport.height+1,JSON.stringify(b));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
   const a=boxes[i],b=boxes[j];assert(!(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y),`overlap ${a.name}/${b.name}`);
  }
 }
 await touch('touchStart',8,await point('.mbtn-fire'));await page.evaluate(()=>touchProbe.controls.hide());
 assert(await page.evaluate(()=>!touchProbe.input.mouseDown&&!touchProbe.controls._touches.size));
 assert.deepEqual(errors,[]);console.log('PASS mobile menu, panels, play/resume, three viewport layouts, multitouch movement/aim/fire/crouch, cancel and hide cleanup');
}finally{await browser?.close();await server.close();}

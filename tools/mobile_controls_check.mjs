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
 await page.goto(server.resolvedUrls.local[0] + 'src/style.css');
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css">');
 await page.evaluate(()=>{ window.__game?.mobileControls?.dispose(); document.body.innerHTML=''; document.body.classList.add('mobile-ui'); });
 // Isolate real input handlers from the simulation consuming the keys each frame.
 await page.evaluate(async()=>{

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
 await page.locator('.mbtn-fire').tap();
 assert(await page.evaluate(()=>touchProbe.input.justPressed.has('MobileFire') && !touchProbe.input.mouseDown), 'quick taps queue one shot after release');
 assert(await page.evaluate(()=>touchProbe.input.wheelDelta === 0), 'weapon swap must not move camera');
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
 await page.evaluate(()=>touchProbe.controls.show());
 await page.screenshot({path:'artifacts/mobile-controls-tested.png'});
 assert.deepEqual(errors,[]);console.log('PASS touch ability mappings, quick fire taps, weapon swapping, three viewport layouts, multitouch and cleanup');
}finally{await browser?.close();await server.close();}

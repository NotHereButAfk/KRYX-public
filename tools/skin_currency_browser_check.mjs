import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {STORE_ITEMS} from '../server/storecatalog.mjs';
import {chromium} from 'playwright';
// qa.localhost keeps traffic local while exercising server account restoration,
// which the application deliberately bypasses on bare localhost/127.0.0.1.
const url=new URL(process.env.KYX_URL||'http://127.0.0.1:5997/?qa=1');
if(['127.0.0.1','localhost'].includes(url.hostname))url.hostname='qa.localhost';
url.searchParams.set('qa','1');
const output=resolve(process.env.KYX_SKIN_OUTPUT||'artifacts/skin-currency');mkdirSync(output,{recursive:true});
const offers=['common','rare','epic','legendary'].map(rarity=>STORE_ITEMS.find(s=>s.rarity===rarity&&s.kind==='weapon'));
const character=STORE_ITEMS.find(s=>s.kind==='character'&&s.rarity==='common'&&s.name!=='Default Reforged');offers.push(character);
let balance=2500,withdrawalEnabled=false;const owned=[],transactions=[];
const report={fixture:'Explicit mocked account/profile, K balance, weekly offers and purchase API. Real full-game MenuUI, confirmation, inventory and reload; no real account or payment action.',offers,pageErrors:[],dialogs:[],requests:[],checks:{},mythic:'No current mythic catalog item; this browser test does not exercise a 3,000 K mythic purchase.'};
const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,args:['--use-gl=swiftshader','--enable-webgl','--enable-unsafe-swiftshader','--host-resolver-rules=MAP qa.localhost 127.0.0.1']});
async function prepare(page){
 page.setDefaultTimeout(60000);
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('dialog',async d=>{report.dialogs.push({type:d.type(),message:d.message(),accepted:page.__accept!==false});if(page.__accept===false)await d.dismiss();else await d.accept();});
 await page.route(/fonts\.(?:googleapis|gstatic)\.com/,r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.routeWebSocket('**',ws=>ws.close());
 await page.addInitScript(()=>{localStorage.setItem('sio_settings',JSON.stringify({quality:'low',volume:0}));});
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;report.requests.push({path,method:req.method()});
  let status=200,data;
  if(path==='/api/account/me')data={ok:true,user:{id:'qa-skins-k',username:'KShopQA',email:'qa@example.invalid',kills:0,deaths:0,score:0,games:0,xp:0,ownedSkins:owned}};
  else if(path==='/api/e/me')data={ok:true,balance:balance.toFixed(4),earningEnabled:true,sessionE:'0',dailyE:'0',dailyCap:null,catalog:[],equipment:[],ownedSkins:owned};
  else if(path==='/api/e/history')data={transactions:[],summaries:[]};
  else if(path==='/api/withdrawals')data={enabled:withdrawalEnabled,kPerUSDC:1000,limits:withdrawalEnabled?{minimumK:'5000',perWithdrawalK:null,perUserDailyK:null,globalDailyK:null}:null,withdrawals:[]};
  else if(path==='/api/store/night-market')data={items:offers,serverTime:Date.now(),resetsAt:Date.now()+86400000};
  else if(path==='/api/e/purchase'){
   const body=req.postDataJSON(),item=offers.find(s=>s.id===body.itemId);
   assert.equal(typeof body.key,'string');assert(/^[0-9a-f-]{36}$/.test(body.key));
   assert.deepEqual(Object.keys(body).sort(),['itemId','key']);
   if(!item){status=400;data={ok:false,error:'Unknown item'};}
   else if(balance<Number(item.priceE)){status=400;data={ok:false,error:'Insufficient K'};}
   else if(owned.some(s=>s.id===item.id))data={ok:true,balance:balance.toFixed(4)};
   else{balance-=Number(item.priceE);owned.push({id:item.id,kind:item.kind});data={ok:true,balance:balance.toFixed(4)};}
   transactions.push({body,status,balance});
  }else data={ok:true,items:[],entries:[],rewards:[],claimed:[],xp:0};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
}
async function ready(page){
 await page.goto(url.href,{waitUntil:'commit'});
 await page.waitForFunction(()=>{const g=window.__game||window.game;return g?.world?.currentMap&&!g._startupInFlight&&g.menu._currentUser==='kshopqa'&&document.getElementById('connect-screen')?.classList.contains('hidden');},null,{timeout:120000});
 // Freeze only the background game loop. The real menu, inventory previews,
 // browser input, HTTP calls and account code remain active.
 await page.evaluate(()=>{const g=window.__game||window.game;cancelAnimationFrame(g._rafId);});
}
async function panel(page,owner,target){
 for(const selector of ['#nm-back','#inv-close-btn'])if(await page.locator(selector).isVisible())await page.locator(selector).click();
 const dropdown=page.locator(`.nav-dd-btn[data-dd="${owner}"]`);
 if(await page.locator('#mobile-home').isVisible()){
  if(target==='loadout')await page.locator('#mobile-home [data-panel="loadout"]').click();
  else{await page.locator('.side-link[data-panel="more"]').click();await page.locator(`#panel-more [data-panel="${target}"]`).click();}
 }else{
  if(!await dropdown.isVisible())await page.locator('#nav-mobile-toggle').click();
  await dropdown.click();await page.locator(`#dd-${owner} .profile-menu-item[data-panel="${target}"]`).click();
 }
 await page.locator('#panel-'+target).waitFor({state:'visible'});
 if(target==='shop')await page.locator('.shop-skin-card').first().waitFor({state:'visible'});
}
const card=(page,item)=>page.locator('.shop-skin-card').filter({has:page.locator('.shop-skin-name',{hasText:item.name})});
async function shopChecks(page,label){
 await page.waitForFunction(()=>document.querySelectorAll('.shop-skin-card').length===5);
 const text=await page.locator('#panel-shop').innerText();assert(!/\bSOL\b|\bUSD\b|\$/.test(text));
 const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,panel:document.getElementById('panel-shop').clientWidth,panelScroll:document.getElementById('panel-shop').scrollWidth}));
 assert(geometry.document<=geometry.viewport+1);assert(geometry.panelScroll<=geometry.panel+1);
 const buttons=[];
 for(const item of offers){
  const button=card(page,item).locator('.shop-btn').last();await button.scrollIntoViewIfNeeded();
  const box=await button.boundingBox();assert(box&&box.x>=-1&&box.x+box.width<=geometry.viewport+1&&box.height>=30);
  buttons.push({item:item.id,text:await button.innerText(),...box});
 }
 report.checks[label]={geometry,buttons};
 assert.equal(await page.locator('.payment-overlay:visible, #payment-modal:visible, #checkout-modal:visible').count(),0);
}
try{
 const page=await browser.newPage({viewport:{width:1360,height:900}});await prepare(page);await ready(page);await panel(page,'store','shop');
 console.log('Authenticated fixture and full Night Market UI ready.');
 for(const item of offers)assert((await card(page,item).locator('.shop-price-line').innerText()).startsWith(Number(item.priceE).toLocaleString()+' K'));
 await shopChecks(page,'desktopBefore');await page.screenshot({path:output+'/desktop-prices.png'});
 page.__accept=false;await card(page,offers[1]).locator('.shop-btn-buy').click();assert.equal(transactions.length,0);page.__accept=true;
 await card(page,offers[0]).locator('.shop-btn-buy').click();
 await card(page,offers[0]).getByRole('button',{name:'IN INVENTORY',exact:true}).waitFor();assert.equal(balance,1500);
 await page.waitForFunction(()=>document.getElementById('nav-coins').textContent.includes('1,500'));
 await card(page,character).locator('.shop-btn-buy').click();
 await card(page,character).getByRole('button',{name:'EQUIP',exact:true}).waitFor();assert.equal(balance,500);
 await card(page,offers[2]).locator('.shop-btn-buy').click();
 await card(page,offers[2]).getByRole('button',{name:'Insufficient K',exact:true}).waitFor();assert.equal(balance,500);assert.equal(owned.length,2);
 console.log('Cancellation, successful weapon/character purchases, debit and insufficient funds passed.');
 await page.screenshot({path:output+'/desktop-purchased-and-error.png'});
 await panel(page,'profile','loadout');await page.locator('#inv-grid').getByText(character.name,{exact:true}).waitFor();
 await page.screenshot({path:output+'/desktop-character-inventory.png'});
 const weapon=await page.evaluate(async id=>(await import('/src/weapons/WeaponSkins.js')).getWeaponIdForSkin(id),offers[0].id);
 const tabLabel={m4:'Auto Rifle',magnum:'Hand Cannon',battlerifle:'Burst Rifle',energyshotgun:'Sweeper',plasmarifle:'Laser Rifle',sword:'Sword'}[weapon];
 assert(tabLabel,'Purchased weapon skin must map to an inventory tab');await page.locator('.inv-tab').filter({hasText:tabLabel}).click();
 await page.locator('#inv-grid').getByText(offers[0].name,{exact:true}).waitFor();await page.screenshot({path:output+'/desktop-weapon-inventory.png'});
 const beforeRestore=report.requests.filter(r=>r.path==='/api/account/me').length;
 await ready(page);await panel(page,'store','shop');
 await card(page,offers[0]).getByRole('button',{name:'IN INVENTORY',exact:true}).waitFor();await card(page,character).getByRole('button',{name:'EQUIP',exact:true}).waitFor();
 assert(report.requests.filter(r=>r.path==='/api/account/me').length>beforeRestore);
 await page.waitForFunction(()=>document.getElementById('nav-coins').textContent.includes('500.00'));
 report.checks.serverProfileReload={balance,owned:[...owned],restoredFromMockProfile:true};
 console.log('Owned inventory and actual server-profile reload passed.');
 await page.close();
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});await prepare(mobile);await ready(mobile);await panel(mobile,'store','shop');
 await shopChecks(mobile,'mobile');await card(mobile,offers[0]).scrollIntoViewIfNeeded();await mobile.screenshot({path:output+'/mobile-shop.png'});
 await card(mobile,offers[2]).locator('.shop-btn-buy').click();await card(mobile,offers[2]).getByRole('button',{name:'Insufficient K',exact:true}).waitFor();
 await card(mobile,offers[2]).scrollIntoViewIfNeeded();await mobile.screenshot({path:output+'/mobile-insufficient.png'});
 assert.equal(balance,500);assert.equal(owned.length,2);assert.equal(mobile.context().pages().length,1);
 assert(report.dialogs.every(d=>d.type==='confirm'&&/\bK\?/.test(d.message)&&!/\bSOL\b|\bUSD\b|\$/.test(d.message)));
 assert(!report.requests.some(r=>/checkout|payment|stripe|solana/i.test(r.path)));
 await mobile.close();
 // Retain the retired checkout test's read-only payout-status coverage. This
 // changes only mocked responses and never submits a withdrawal.
 const earnings=await browser.newPage({viewport:{width:1280,height:900}});await prepare(earnings);
 await earnings.goto(new URL('/earnings.html',url).href,{waitUntil:'domcontentloaded'});
 await earnings.waitForFunction(()=>document.getElementById('withdrawal-status').textContent.includes('not live yet'));
 assert.equal(await earnings.locator('#withdrawal-form').isVisible(),false);
 assert(!/SOL or USDC|cannot be used to buy skins/i.test(await earnings.locator('#catalog').innerText()));
 await earnings.screenshot({path:output+'/withdrawals-disabled.png'});
 withdrawalEnabled=true;await earnings.reload();
 await earnings.waitForFunction(()=>document.getElementById('withdrawal-status').textContent.includes('No daily maximum'));
 assert.equal(await earnings.locator('#withdrawal-form').isVisible(),true);
 assert.equal(await earnings.locator('#withdrawal-amount').getAttribute('min'),'5000');
 assert(!(await earnings.locator('#withdrawal-status').innerText()).includes('null'));
 assert(!report.requests.some(r=>r.path==='/api/withdrawals'&&r.method==='POST'));
 report.checks.withdrawals={disabledHidden:true,minimumOnlyStatus:true,noWithdrawalSubmitted:true};
 await earnings.screenshot({path:output+'/withdrawals-minimum-only.png'});
 assert.deepEqual(report.pageErrors,[]);report.transactions=transactions;report.finalBalance=balance;
 report.limitations='API fixtures verify client behavior only; no real purchase, account or database mutation. Server transaction checks are separate. Mobile is Chromium touch emulation, not a physical device.';
 writeFileSync(output+'/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}

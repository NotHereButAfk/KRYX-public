import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let loggedIn=false,wallet='',entries=0,tokenRegistered=false;
const event={id:'11111111-1111-4111-8111-111111111111',title:'Friday Arena Cup',description:'Eight players. One arena. Check-in and match instructions in Discord.',startsAt:new Date(Date.now()+86400000).toISOString(),closesAt:new Date(Date.now()+82800000).toISOString(),capacity:8,registered:3,fee:'2.50',asset:'USDC',status:'open'};
try{
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/api/tournaments')return route.fulfill({json:{ok:true,configured:true,events:[event]}});
    if(path==='/api/community/me')return route.fulfill(loggedIn?{json:{ok:true,username:'Player',profile:{solana_address:wallet},discordConfigured:true,entries:tokenRegistered?[{tournament_id:event.id}]:[]}}:{status:401,json:{ok:false,error:'Log in'}});
    if(path==='/api/community/profile'){wallet=route.request().postDataJSON().solanaAddress;return route.fulfill({json:{ok:true}});}
    if(path.endsWith('/enter')){if(event.asset==='K'){tokenRegistered=true;return route.fulfill({json:{ok:true,order:{id:'33333333-3333-4333-8333-333333333333',amount:'25',asset:'K',status:'registered',paymentUrl:null}}});}entries++;assert.equal(route.request().postDataJSON().confirm,true);return route.fulfill({json:{ok:true,order:{id:'22222222-2222-4222-8222-222222222222',amount:'2.50',asset:'USDC',status:'pending',expiresAt:new Date(Date.now()+600000).toISOString(),paymentUrl:'solana:11111111111111111111111111111111?amount=2.5'}}});}
    return route.fulfill({json:{ok:false,error:'Unexpected API'}});
  });
  await page.route('http://127.0.0.1:6003/tournament-probe',route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,'')}));
  await page.goto('http://127.0.0.1:6003/tournament-probe');await page.addStyleTag({url:'/src/style.css'});
  await page.addStyleTag({content:'#connect-screen,.overlay,#loading-overlay,#boot-loading,#frame,#top-nav,#nav-side,#center-play,#game-container{display:none!important} #panel-tournaments,#panel-profile{position:relative;inset:auto;transform:none;width:min(100%,1000px);margin:20px auto;box-sizing:border-box} body{background:#080e16;overflow:auto}'});
  const open=()=>page.evaluate(async()=>{document.getElementById('panel-tournaments').classList.remove('hidden');await(await import('/src/ui/TournamentPanel.js')).openTournamentPanel();});
  await open();assert.equal(await page.getByRole('button',{name:'PAY ENTRY FEE'}).count(),0);
  assert.equal(await page.locator('#tournament-requirements').getByRole('link',{name:'LOG IN'}).count(),1);
  loggedIn=true;await open();assert.equal(await page.getByRole('button',{name:'PAY ENTRY FEE'}).count(),0);
  wallet='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';await open();
  assert.equal(await page.getByRole('button',{name:'PAY ENTRY FEE'}).isDisabled(),true);
  await page.locator('.tournament-consent input').check();await page.getByRole('button',{name:'PAY ENTRY FEE'}).click();
  await page.waitForSelector('.tournament-payment canvas');assert.equal(entries,1);
  mkdirSync(new URL('../artifacts/tournaments/',import.meta.url),{recursive:true});
  await page.screenshot({path:'artifacts/tournaments/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{document.getElementById('panel-tournaments').scrollTop=0;window.scrollTo(0,0);});
  assert(await page.evaluate(()=>document.getElementById('panel-tournaments').getBoundingClientRect().width<=innerWidth));
  assert(await page.evaluate(()=>{const p=document.getElementById('panel-tournaments');return p.scrollWidth<=p.clientWidth+1;}));
  await page.screenshot({path:'artifacts/tournaments/mobile.png',fullPage:true});
  event.asset='K';event.fee='25';await open();
  assert.match(await page.locator('.tournament-consent').innerText(),/deducted from my in-game balance/);
  await page.locator('.tournament-consent input').check();await page.getByRole('button',{name:'PAY ENTRY FEE'}).click();
  await page.waitForFunction(()=>document.getElementById('panel-tournaments').textContent.includes('REGISTERED'));
  assert.equal(await page.locator('.tournament-payment canvas').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Tournament UI passed: guest/login, wallet prerequisite, fee consent, payment request and mobile layout.');
}finally{await browser.close();}

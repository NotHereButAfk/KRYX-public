import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {PGlite} from '@electric-sql/pglite';
import {createAccountService} from '../server/accountservice.mjs';
const db=await PGlite.create(),mail=[];
const query=async(sql,params)=>params?db.query(sql,params):(await db.exec(sql)).at(-1);
const accounts=createAccountService(null,{pool:{query,connect:async()=>({query,release(){}})},reset:{secret:'browser-reset-secret-'.repeat(3),send:async(email,code)=>mail.push({email,code})}});
await accounts.ready;
const app=await createServer({server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
app.middlewares.use(async(req,res,next)=>{if(req.url.startsWith('/api/account/')){await accounts(req,res,req.url);return;}next();});
app.middlewares.stack.unshift(app.middlewares.stack.pop());await app.listen();
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1000,height:950}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Exercise the production HTTP account branch on localhost, not the local demo store.
 await page.route('**/src/core/UserAccount.js',async route=>{const response=await route.fetch();const text=await response.text();await route.fulfill({response,body:text.replace(/const _usesServer = \(\) =>[\s\S]*?;/,'const _usesServer = () => true;')});});
 const base=app.resolvedUrls.local[0];
 await page.goto(base+'register.html?next=/login.html');
 await page.locator('#reg-name').fill('BrowserPilot');await page.locator('#reg-email').fill('browser@example.com');
 await page.locator('#reg-pass').fill('original-password');await page.locator('#reg-pass2').fill('original-password');
 await page.locator('#reg-privacy').check();await page.locator('#reg-terms').check();
 await page.locator('#reg-btn').click();await page.waitForURL(url=>url.pathname==='/login.html'&&!url.search);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('sio_session')),'browserpilot');
 await page.evaluate(()=>fetch('/api/account/logout',{method:'POST'}));
 await page.goto(base+'login.html?reset=1');
 await page.locator('#reset-name').fill('browser@example.com');await page.locator('#reset-btn').click();await page.locator('#reset-code').waitFor({state:'visible'});
 assert.equal(mail.length,1);
 await page.locator('#reset-code').fill(mail[0].code);await page.locator('#reset-password').fill('changed-password');await page.locator('#reset-password-confirm').fill('changed-password');
 await page.screenshot({path:'artifacts/password-reset-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/password-reset-mobile.png'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#reset-confirm-btn').click();await page.getByText('Password updated.',{exact:false}).waitFor();
 await page.goto(base+'login.html?next=/login.html');await page.locator('#login-name').fill('browser@example.com');await page.locator('#login-pass').fill('changed-password');await page.locator('#login-btn').click();await page.waitForURL(url=>url.pathname==='/login.html'&&!url.search);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('sio_session')),'browserpilot');
 assert.equal(await page.evaluate(async()=>{const r=await fetch('/api/account/me');return r.status;}),200);
 assert.deepEqual(errors,[]);console.log('PASS browser register, reset request/code/password, new-password login and secure session; mobile layout');
}finally{await browser.close();await app.close();await db.close();}

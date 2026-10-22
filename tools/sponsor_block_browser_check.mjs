import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--no-sandbox']});
try {
 const page=await browser.newPage();const adRequests=[];
 await page.route(/a-ads\.com|googlesyndication\.com|doubleclick\.net|\/ads\/banner\//,route=>{adRequests.push(route.request().url());return route.abort('blockedbyclient');});
 await page.goto('http://127.0.0.1:6003/');
 assert.equal(await page.evaluate(async()=> (await import('/src/ui/SponsorAvailability.js')).canPlayWithAds()),true);
 assert.equal(await page.locator('#frame,#sponsor-block-warning,iframe[data-aa]').count(),0);
 assert.equal(await page.locator('body.has-top-ad').count(),0);
 for(const width of [1280,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>Math.abs(document.getElementById('app').getBoundingClientRect().height-innerHeight)<2),'no empty banner space');}
 await page.goto('http://127.0.0.1:6003/community.html');
 assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(adRequests,[]);
 console.log('Ads-off browser check passed: game and community request no ads; blockers do not prevent play.');
} finally {await browser.close();}

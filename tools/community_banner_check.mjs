import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const html=readFileSync(new URL('../public/community.html',import.meta.url),'utf8');
assert.match(html,/<iframe[^>]*data-aa="2458071"[^>]*src="https:\/\/acceptable\.a-ads\.com\/2458071\/\?size=Adaptive"/);
assert.doesNotMatch(html,/<script|loading="lazy"|display:\s*none/);
assert.match(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/href="\/community.html"/);
const browser=await chromium.launch();
try {
  const context=await browser.newContext({javaScriptEnabled:false});
  await context.route('https://acceptable.a-ads.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#1b3043;color:white">Advertisement fixture</body>'}));
  const page=await context.newPage();
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]) {
    await page.setViewportSize(viewport);await page.setContent(html);
    assert.equal(await page.locator('iframe').count(),1);
    const result=await page.locator('iframe').evaluate(frame=>{
      const r=frame.getBoundingClientRect();
      const points=[.01,.5,.99].flatMap(x=>[.01,.5,.99].map(y=>document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)===frame));
      return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,clear:points.every(Boolean)};
    });
    assert(result.top>=0&&result.left>=0&&result.bottom<=viewport.height&&result.right<=viewport.width,JSON.stringify(result));
    assert(result.clear&&result.height===250&&result.width>=288,JSON.stringify(result));
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'artifacts/community-banner.png',fullPage:true});
  console.log('Community banner passed: static source, no JavaScript, single unobstructed banner on desktop and mobile, linked from game.');
}finally{await browser.close();}

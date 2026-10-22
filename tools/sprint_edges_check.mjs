import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0] + 'tools/__sprint_probe', {waitUntil:'commit'});
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="host" style="width:960px;height:540px"></div>';
    const {SprintEdges} = await import('/src/ui/SprintEdges.js');
    const effect = new SprintEdges(document.getElementById('host'));
    const game = {state:'playing',player:{isSprinting:true,velocity:{x:0,z:10}}};
    const samples=[];
    for(const fps of [30,60,144]) {
      effect.amount=0;
      for(let i=0;i<fps;i++) effect.update(1/fps,game);
      samples.push(effect.amount);
    }
    const pixels=effect.ctx.getImageData(0,0,960,540).data;
    let centre=0,edge=0;
    for(let y=0;y<540;y++)for(let x=0;x<960;x++) {
      const alpha=pixels[(y*960+x)*4+3];
      if(Math.hypot((x-480)/480,(y-270)/270)<.55) centre+=alpha;
      else edge+=alpha;
    }
    game.player.velocity.z=0;
    for(let i=0;i<60;i++) effect.update(1/60,game);
    const stopped=effect.canvas.hidden;
    const gates=[];
    for(const key of ['_menuOpen','_chatOpen','_spectating','_roundGateVisible','_authoritativeMapTransitioning','_playerDowned']) {
      game.player.velocity.z=10;game[key]=true;effect.amount=1;effect.update(1/60,game);gates.push(effect.canvas.hidden);game[key]=false;
    }
    for(const key of ['isDead','reduceMotion']) {
      game.player[key]=true;effect.amount=1;effect.update(1/60,game);gates.push(effect.canvas.hidden);game.player[key]=false;
    }
    return {centre,edge,stopped,gates,samples};
  });
  assert.equal(result.centre,0,'speed streaks contaminate the central aiming area');
  assert.ok(result.edge>0,'sprinting produces no visible edge streaks');
  assert.ok(result.stopped && result.gates.every(Boolean),'effect persists when blocked/stationary');
  assert.ok(Math.max(...result.samples)-Math.min(...result.samples)<1e-10,'fade varies with refresh rate');
  console.log('Sprint edges passed: clear centre, visible perimeter, frame-independent fade and all exit states.');
} finally {await browser.close();await server.close();}

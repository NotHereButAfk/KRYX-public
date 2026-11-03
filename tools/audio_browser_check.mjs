import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const output = resolve(process.env.KYX_AUDIO_OUTPUT || 'artifacts/audio');
const phase = process.env.KYX_AUDIO_PHASE || 'after';
const baseURL = process.env.KYX_URL || 'http://127.0.0.1:5997/';
const timeline = [
  [.5,'playShot',['m4']], [1.2,'playShot',['m4']], [1.9,'playShot',['m4']],
  [3,'playShot',['levershotgun']], [4.6,'playShot',['sniper']],
  [6.1,'playShot',['battlerifle',3]], [7.6,'playShot',['uzi']],
  [8.4,'playShot',['plasmarifle']], [9.6,'playShot',['rpg']],
  [11.2,'playExplosion',['grenade']], [13,'playExplosion',['rocket']],
  [15,'playReload',[]], [15.5,'playReloadMag',[]], [16,'playReloadRack',[]],
  [17,'playFootstep',[false]], [17.4,'playFootstep',[false]],
  [17.8,'playFootstep',[true]], [18.2,'playFootstep',[true]],
  [18.8,'playJump',[]], [19.4,'playLand',[true]],
  [20.2,'playHit',[]], [20.5,'playHurt',[]], [21,'playKill',[]],
  [21.7,'playSwing',[]], [22.4,'playSwordImpact',['armor']],
  [23,'playDeath',[]], [23.5,'playBodyImpact',[1]],
];
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'] });
const report = { phase, seed: 0x51a7, sampleRate: 48000, duration: 26, timeline,
  capture: 'Real AudioManager with OfflineAudioContext; deterministic random and event start times', pageErrors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  // Use the local origin without starting the expensive full game for PCM capture.
  await page.route('**/__audio-qa', route => route.fulfill({ status: 200,
    contentType: 'text/html', body: '<title>Game sound capture</title><button id="unlock">Enable audio</button>' }));
  await page.goto(new URL('/__audio-qa', baseURL).href);
  const capture = await page.evaluate(async ({ timeline, seed, sampleRate, duration }) => {
    const { AudioManager } = await import('/src/core/AudioManager.js');
    const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const audio = new AudioManager();
    // Pre-fetch all recordings, then decode in filename order so cache selection
    // stays reproducible even when HTTP responses finish in a different order.
    const fetchOriginal = window.fetch, decodeOriginal = ctx.decodeAudioData.bind(ctx);
    const files = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      const url = '/audio/footsteps/footstep_concrete_00' + index + '.ogg';
      const response = await fetchOriginal(url); if (!response.ok) throw new Error('Footstep fetch failed');
      return [url, await response.arrayBuffer()];
    }));
    const cache = new Map(files); let decodeQueue = Promise.resolve();
    window.fetch = async (url, options) => cache.has(url) ? new Response(cache.get(url).slice(0)) : fetchOriginal(url, options);
    ctx.decodeAudioData = data => (decodeQueue = decodeQueue.then(() => decodeOriginal(data)));
    const OriginalContext = window.AudioContext;
    window.AudioContext = function () { return ctx; };
    try { audio.ensureContext(); } finally { window.AudioContext = OriginalContext; }
    audio.setVolume(.65);
    const loaded = await audio._footstepsReady;
    window.fetch = fetchOriginal;
    if (loaded.some(result => result.status !== 'fulfilled')) throw new Error('Footstep decode failed');
    let eventTime = 0, voices = 0;
    const createSource = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const source = createSource(), start = source.start.bind(source);
      source.start = (when = 0, ...args) => { voices++; start(eventTime + when, ...args); };
      return source;
    };
    const oldRandom = Math.random;
    Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    try { for (const [time, method, args] of timeline) { eventTime = time; audio[method](...args); } }
    finally { Math.random = oldRandom; }
    const rendered = await ctx.startRendering();
    const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
    const bytes = new Uint8Array(rendered.length * 4 + 44), data = new DataView(bytes.buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
    text(0,'RIFF'); data.setUint32(4,bytes.length-8,true); text(8,'WAVE'); text(12,'fmt ');
    data.setUint32(16,16,true); data.setUint16(20,1,true); data.setUint16(22,2,true);
    data.setUint32(24,sampleRate,true); data.setUint32(28,sampleRate*4,true);
    data.setUint16(32,4,true); data.setUint16(34,16,true); text(36,'data'); data.setUint32(40,bytes.length-44,true);
    let peak = 0, energy = 0, clipped = 0;
    for (let i = 0; i < rendered.length; i++) for (let c = 0; c < 2; c++) {
      const x = channels[c][i]; if (!Number.isFinite(x)) throw new Error('Nonfinite audio sample');
      peak = Math.max(peak,Math.abs(x)); energy += x*x; if(Math.abs(x)>=1)clipped++;
      data.setInt16(44+(i*2+c)*2,Math.round(Math.max(-1,Math.min(1,x))*32767),true);
    }
    let binary = ''; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    return { wav: btoa(binary), peak, rms: Math.sqrt(energy/(rendered.length*2)), clipped,
      scheduledVoices: voices, remainingVoices: audio._effectVoices?.size || 0, decodedFootsteps: loaded.length };
  }, report);
  const { wav, ...metrics } = capture;
  report.metrics = metrics;
  assert(metrics.peak > .05 && metrics.peak < 1, 'capture must remain audible with output headroom');
  assert.equal(metrics.clipped, 0); assert.equal(metrics.remainingVoices, 0);
  assert.equal(metrics.decodedFootsteps, 5); assert.equal(metrics.scheduledVoices, timeline.length);
  writeFileSync(resolve(output, phase + '.wav'), Buffer.from(wav, 'base64'));
  if (process.env.KYX_AUDIO_LIVE === '1') {
    report.routing = await page.evaluate(async () => {
      const { AudioManager } = await import('/src/core/AudioManager.js');
      const { MAX_EFFECT_VOICES } = await import('/src/core/SoundEffects.js');
      const render = async ({ volume = .5, muted = false, position = null, occluded = false, overload = false } = {}) => {
        const ctx = new OfflineAudioContext(2, 96000, 48000), audio = new AudioManager();
        audio.ctx = ctx; audio.master = ctx.createGain(); audio.out = audio.master;
        audio._connectMasterOutput(); audio.setVolume(volume); audio.setPlatformMuted(muted);
        audio.setListener({x:0,y:0,z:0},{x:0,y:0,z:-1},{x:0,y:1,z:0});
        if (occluded) audio.setWorld({ raycastCollisionDistance: (_ray, far) => far*.5 });
        const createSource = ctx.createBufferSource.bind(ctx);
        ctx.createBufferSource = () => { const source = createSource(), start = source.start.bind(source);
          source.start = (when = 0, ...args) => start(.1 + when, ...args); return source; };
        const oldRandom = Math.random; Math.random = () => .35;
        let localVoice;
        try {
          if (position) audio.playAt(position, () => audio.playShot('m4'));
          else audio.playShot('m4');
          localVoice = [...audio._effectVoices][0];
          if (overload) for (let i=0;i<100;i++) audio.playAt({x:2+i%8,y:0,z:-5}, () => audio.playShot('m4'));
        } finally { Math.random = oldRandom; }
        const active = audio._effectVoices.size, localRetained = audio._effectVoices.has(localVoice);
        const buffer = await ctx.startRendering();
        let peak=0, clipped=0; const energy = [0,0];
        for(let c=0;c<2;c++) for(const x of buffer.getChannelData(c)) {
          if(!Number.isFinite(x)) throw new Error('Invalid mixed PCM');
          peak=Math.max(peak,Math.abs(x)); energy[c]+=x*x; if(Math.abs(x)>=1)clipped++;
        }
        return { peak, clipped, rms:Math.sqrt((energy[0]+energy[1])/(buffer.length*2)),
          left:Math.sqrt(energy[0]/buffer.length), right:Math.sqrt(energy[1]/buffer.length),
          active, localRetained, remaining:audio._effectVoices.size };
      };
      const result = { maxVoices:MAX_EFFECT_VOICES };
      for (const [name, options] of Object.entries({ quiet:{volume:.2}, loud:{volume:.6}, muted:{volume:0},
        platformMuted:{muted:true}, left:{position:{x:-6,y:0,z:-6}}, right:{position:{x:6,y:0,z:-6}},
        near:{position:{x:0,y:0,z:-4}}, far:{position:{x:0,y:0,z:-40}},
        cover:{position:{x:0,y:0,z:-4},occluded:true}, crowded:{overload:true} })) result[name] = await render(options);
      return result;
    });
    const r = report.routing;
    assert(r.loud.rms > r.quiet.rms*1.2, 'volume must change audible output');
    assert.equal(r.muted.peak,0); assert.equal(r.platformMuted.peak,0);
    assert(r.left.left > r.left.right*1.1, 'left positional event must favor the left ear');
    assert(r.right.right > r.right.left*1.1, 'right positional event must favor the right ear');
    assert(r.near.rms > r.far.rms*2, 'distant sound must be quieter');
    assert(r.cover.rms < r.near.rms*.9, 'covered sound must be attenuated');
    assert(r.crowded.active <= r.maxVoices); assert(r.crowded.localRetained);
    assert.equal(r.crowded.clipped,0); assert.equal(r.crowded.remaining,0);
    const impact = await page.evaluate(async () => {
      const { AudioManager } = await import('/src/core/AudioManager.js');
      const ctx=new OfflineAudioContext(2,48000,48000),audio=new AudioManager();
      audio.ctx=ctx;audio.master=ctx.createGain();audio.out=audio.master;
      audio._connectMasterOutput();audio.setVolume(.65);
      audio.setListener({x:0,y:0,z:0},{x:0,y:0,z:-1},{x:0,y:1,z:0});
      const oldRandom=Math.random;Math.random=()=>.35;
      try { for(let i=0;i<10;i++)audio.playBulletImpactAt({x:0,y:0,z:-3}); }
      finally { Math.random=oldRandom; }
      const simultaneousVoices=audio._effectVoices.size,buffer=await ctx.startRendering();
      const left=buffer.getChannelData(0),right=buffer.getChannelData(1),pcm=[];
      let peak=0;
      for(let i=0;i<48000;i+=3){
        const x=(left[i]+right[i]+left[i+1]+right[i+1]+left[i+2]+right[i+2])/6;
        peak=Math.max(peak,Math.abs(x));pcm.push(Math.round(x*32767));
      }
      return { simultaneousVoices,remaining:audio._effectVoices.size,peak,pcm };
    });
    const { pcm, ...impactMetrics }=impact;report.bulletImpact=impactMetrics;
    assert.equal(impact.simultaneousVoices,1,'one pellet burst must yield one audible impact');
    assert.equal(impact.remaining,0);assert(impact.peak>.001&&impact.peak<1);
    const impactWav=Buffer.alloc(44+pcm.length*2);
    impactWav.write('RIFF',0);impactWav.writeUInt32LE(impactWav.length-8,4);impactWav.write('WAVEfmt ',8);
    impactWav.writeUInt32LE(16,16);impactWav.writeUInt16LE(1,20);impactWav.writeUInt16LE(1,22);
    impactWav.writeUInt32LE(16000,24);impactWav.writeUInt32LE(32000,28);impactWav.writeUInt16LE(2,32);impactWav.writeUInt16LE(16,34);
    impactWav.write('data',36);impactWav.writeUInt32LE(pcm.length*2,40);pcm.forEach((value,index)=>impactWav.writeInt16LE(value,44+index*2));
    writeFileSync(resolve(output,'bullet-impact.wav'),impactWav);
    // Playwright page.evaluate marks evaluation as a user gesture. Use a fresh
    // document and explicit CDP userGesture:false for genuine autoplay coverage.
    await page.reload();
    const cdp = await page.context().newCDPSession(page);
    const preGesture = await cdp.send('Runtime.evaluate', { expression: `(async () => {
      const { AudioManager } = await import('/src/core/AudioManager.js');
      window.__liveAudio = new AudioManager(); window.__liveAudio.ensureContext();
      document.getElementById('unlock').onclick = () => { window.__liveAudio.resume(); window.__liveAudio.playShot('m4'); };
      return window.__liveAudio.ctx.state;
    })()`, awaitPromise:true, returnByValue:true, userGesture:false });
    const beforeUnlock = preGesture.result.value;
    assert.equal(beforeUnlock,'suspended','pre-gesture audio context must be suspended for unlock coverage');
    await page.locator('#unlock').click();
    await page.waitForFunction(() => window.__liveAudio.ctx.state === 'running');
    report.context = await page.evaluate(before => {
      const audio=window.__liveAudio;
      audio.setVolume(.35); audio.setPlatformMuted(true); const muted=audio.master.gain.value;
      audio.setPlatformMuted(false); const restored=audio.master.gain.value;
      return { before, after:audio.ctx.state, muted, restored, active:audio._effectVoices.size };
    }, beforeUnlock);
    assert.equal(report.context.after,'running'); assert.equal(report.context.muted,0);
    assert(Math.abs(report.context.restored-.35)<.0001);
    await page.evaluate(() => window.__liveAudio.ctx.close());
    await cdp.detach();
    console.log('Offline routing, spatial, voice budget and real context unlock checks passed.');
    await page.close();

    const prepare = async target => {
      target.on('pageerror', error => report.pageErrors.push(error.message));
      await target.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.fulfill({status:200,contentType:'text/css',body:''}));
      await target.addInitScript(() => {
        if(!localStorage.getItem('sio_settings')) localStorage.setItem('sio_settings',JSON.stringify({quality:'low',volume:.35}));
        let locked=null;
        Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>locked});
        Element.prototype.requestPointerLock=function(){locked=this;queueMicrotask(()=>document.dispatchEvent(new Event('pointerlockchange')));return Promise.resolve();};
        document.exitPointerLock=()=>{locked=null;document.dispatchEvent(new Event('pointerlockchange'));};
      });
    };
    const ready = async target => {
      await target.goto(new URL('/?qa=1',baseURL).href,{waitUntil:'commit'});
      await target.waitForFunction(()=>{
        const game=window.__game||window.game;
        return game?.world?.currentMap&&!game._startupInFlight&&document.getElementById('connect-screen')?.classList.contains('hidden');
      },null,{timeout:120000});
    };
    const desktop=await browser.newPage({viewport:{width:1280,height:720}});
    await prepare(desktop); await ready(desktop);
    await desktop.locator('.nav-item[data-panel="settings"]').click();
    await desktop.locator('#set-vol').fill('25'); await desktop.locator('#set-vol').dispatchEvent('input');
    await desktop.locator('#settings-save-btn').click();
    await ready(desktop);
    await desktop.locator('.nav-item[data-panel="settings"]').click();
    assert.equal(await desktop.locator('#set-vol').inputValue(),'25');
    await desktop.locator('#panel-settings [data-close-panel]').click();
    await desktop.locator('#play-btn').click({force:true});
    await desktop.waitForFunction(()=>(window.__game||window.game)?.state==='playing',null,{timeout:60000});
    await desktop.evaluate(()=>{
      const g=window.__game||window.game;
      g._authNet?.disconnect?.(); g._authNet=null;g._netDriven=false;g.serverSim?.stop();g.botManager.clear();
      const spawn=g.world.spawnPoints.find(p=>p.y<=3.1)||g.world.spawnPoints[0];
      g.player.respawn(spawn);g.player.velocity.set(0,0,0);g.input.pointerLocked=true;
      window.__audioEvents={shot:0,reload:0,footstep:0,impact:0};
      for(const [method,key] of [['playShot','shot'],['playReload','reload'],['playReloadMag','reload'],['playReloadRack','reload'],['playFootstep','footstep'],['playBulletImpactAt','impact']]){
        const fn=g.audio[method].bind(g.audio);g.audio[method]=(...args)=>{window.__audioEvents[key]++;return fn(...args);};
      }
    });
    const beforeInput=await desktop.evaluate(()=>{const g=window.__game||window.game;return {x:g.player.position.x,z:g.player.position.z,ammo:g.weaponSystem.currentState.magAmmo};});
    await desktop.keyboard.down('w'); await desktop.waitForTimeout(900); await desktop.keyboard.up('w');
    await desktop.mouse.move(640,360); await desktop.mouse.down(); await desktop.waitForTimeout(700); await desktop.mouse.up();
    await desktop.keyboard.press('r'); await desktop.waitForTimeout(2500);
    report.desktop=await desktop.evaluate(before=>{
      const g=window.__game||window.game;
      return {state:g.state,context:g.audio.ctx.state,volume:g.audio._volume,saved:JSON.parse(localStorage.getItem('sio_settings')).volume,
        events:window.__audioEvents,travel:Math.hypot(g.player.position.x-before.x,g.player.position.z-before.z),activeVoices:g.audio._effectVoices?.size||0};
    },beforeInput);
    assert.equal(report.desktop.context,'running'); assert.equal(report.desktop.saved,.25);
    assert(report.desktop.events.shot>0,'actual mouse fire must reach audio');
    assert(report.desktop.events.reload>0,'actual reload key must reach audio');
    assert(report.desktop.events.footstep>0,'actual keyboard travel must reach footsteps');
    report.impactArrival=await desktop.evaluate(async()=>{
      const {Ray,Vector3}=await import('/node_modules/three/build/three.module.js');
      const g=window.__game||window.game,from=g.player.camera.getWorldPosition(new Vector3());
      const hit=g.world.raycastCollisionHit(new Ray(from,new Vector3(0,-1,0)),35);
      if(!hit?.point)throw new Error('No floor for real-world impact fixture');
      const target={},effects=g.weaponSystem._bulletImpacts,before=window.__audioEvents.impact;
      const queued=effects.queueEndpoint(target,g.world,from,hit.point,g.player.camera);
      const whileQueued=window.__audioEvents.impact;
      const shown=effects.showQueued(target,g.player.camera);
      return {queued,shown,before,whileQueued,after:window.__audioEvents.impact,fixture:'confirmed real-map floor endpoint; simulated tracer arrival'};
    });
    assert(report.impactArrival.queued&&report.impactArrival.shown);
    assert.equal(report.impactArrival.whileQueued,report.impactArrival.before);
    assert.equal(report.impactArrival.after,report.impactArrival.before+1);
    await desktop.screenshot({path:resolve(output,'desktop-audio.png')}); await desktop.close();
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    await prepare(mobile);await ready(mobile);await mobile.locator('#mobile-play').tap({force:true});
    await mobile.waitForFunction(()=>(window.__game||window.game)?.state==='playing',null,{timeout:60000});
    report.mobile=await mobile.evaluate(()=>{
      const g=window.__game||window.game;return {context:g.audio.ctx?.state,state:g.state,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
    });
    assert.equal(report.mobile.context,'running');assert.equal(report.mobile.state,'playing');
    assert(report.mobile.scrollWidth<=report.mobile.width);
    await mobile.screenshot({path:resolve(output,'mobile-audio.png')});await mobile.close();
    report.limitations='Chromium desktop and emulated touch viewport; synthetic pointer lock; occlusion routing uses a deterministic collision fixture. Actual device speakers, iOS Safari and human listening quality are not automated.';
  }
  assert.deepEqual(report.pageErrors, []);
  writeFileSync(resolve(output, phase + '-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }

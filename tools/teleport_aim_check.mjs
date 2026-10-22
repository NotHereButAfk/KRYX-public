import assert from 'node:assert/strict';
import {TeleportAim} from '../src/core/TeleportAim.js';
const marker={hidden:true}, aim=new TeleportAim(marker);
const input={mouseDown:false,rightMouseDown:false,keys:new Set(),isDown(k){return this.keys.has(k);},consumeJustPressed(k){return this.keys.delete(k);}};
const frame=(q=false,down=false,enabled=true,cd=0)=>{if(q)input.keys.add('KeyQ');input.mouseDown=down;return aim.update(input,enabled,cd);};
assert(!frame(true).teleportConfirmed);assert(!marker.hidden);
assert(frame(false,true).teleportConfirmed);assert(marker.hidden);assert(!aim.filtered.mouseDown);
assert(!frame(false,true).mouseDown,'held confirmation must not turn into gunfire');
frame();assert(frame(false,true).mouseDown,'next distinct click should fire normally');
frame();frame(true);frame(false,false,false);assert(marker.hidden);assert(!frame(false,true).teleportConfirmed);
frame();frame(true,false,true,4);assert(marker.hidden);assert(!aim.armed);
frame(true,true);assert(!aim.filtered.teleportConfirmed,'Q while shooting must require a new click');
frame(false,true);assert(!aim.filtered.mouseDown);frame();assert(frame(false,true).teleportConfirmed);
frame();frame(true);frame(true);assert(!aim.armed,'Q toggles targeting off');
console.log('Teleport aim passed: Q selection, click confirmation, no gunfire/repeat blink, cancel, cooldown and held-trigger isolation.');

frame(); input.keys.add('MobileFire'); assert(frame().mouseDown, 'short mobile fire tap survives until a frame');
frame(); frame(true); input.keys.add('MobileFire'); assert(frame().teleportConfirmed, 'short touch confirms teleport');
assert(!aim.filtered.mouseDown); frame(); assert(!aim.filtered.mouseDown);

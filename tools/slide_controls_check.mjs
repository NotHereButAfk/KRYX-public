import assert from 'node:assert/strict';
import { InputManager } from '../src/core/InputManager.js';
import { crouchRequested, consumeSlidePress } from '../src/core/GameplayInput.js';

globalThis.window = new EventTarget();
window.matchMedia = query => ({matches:query.includes('fine')});
globalThis.document = new EventTarget();
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Desktop test'}});
const input = new InputManager(new EventTarget());
let prevented = 0;
const down = (code, editing=false) => input._onKeyDown({code,repeat:false,
  target:{closest:()=>editing?{}:null},preventDefault(){prevented++;}});
const up = code => input._onKeyUp({code});
for(const code of ['ControlLeft','ControlRight']) {
  down(code);
  assert(crouchRequested(input),`${code} must request crouch`);
  assert(!consumeSlidePress(input),'Ctrl must never request a slide');
  down(code);
  assert(!consumeSlidePress(input),'held Ctrl must never request a slide');
  up(code);
  assert(!crouchRequested(input));
}
down('KeyC');
assert(!crouchRequested(input),'C is a dedicated slide action, never a crouch');
assert(consumeSlidePress(input));
down('KeyC');
assert(!consumeSlidePress(input),'held C must not repeat the slide request');
input._onBlur();
down('KeyC',true);down('KeyW',true);
assert.equal(input.keys.size,0,'typing in a form must not move the player');
assert(!consumeSlidePress(input));
input.pointerLocked=true;down('KeyC');
assert.equal(prevented,1,'gameplay crouch must prevent browser default handling');
input._onBlur();
input.setVirtualKey('KeyC',true);
assert(!crouchRequested(input) && consumeSlidePress(input),'touch slide must use the same dedicated action');
input.setVirtualKey('KeyC',true);
assert(!consumeSlidePress(input),'another held touch must not retrigger the action');
input.setVirtualKey('KeyC',false);
assert(!crouchRequested(input));
input.setVirtualKey('KeyC',true);input._onBlur();
assert(!crouchRequested(input) && !consumeSlidePress(input),'focus loss must release slide/crouch');
input.dispose();
console.log('Slide controls passed: dedicated C slide, separate Ctrl crouch, repeat suppression, form focus, touch and blur cleanup.');

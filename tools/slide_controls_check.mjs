import assert from 'node:assert/strict';
import { InputManager } from '../src/core/InputManager.js';
import { crouchRequested, consumeCrouchPress } from '../src/core/GameplayInput.js';

globalThis.window = new EventTarget();
window.matchMedia = query => ({matches:query.includes('fine')});
globalThis.document = new EventTarget();
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Desktop test'}});
const input = new InputManager(new EventTarget());
let prevented = 0;
const down = (code, editing=false) => input._onKeyDown({code,repeat:false,
  target:{closest:()=>editing?{}:null},preventDefault(){prevented++;}});
const up = code => input._onKeyUp({code});
for(const code of ['KeyC','ControlLeft','ControlRight']) {
  down(code);
  assert(crouchRequested(input),`${code} must request crouch/slide`);
  assert(consumeCrouchPress(input),`${code} must emit its press once`);
  down(code);
  assert(!consumeCrouchPress(input),'held/repeated keys cannot restart a slide');
  up(code);
  assert(!crouchRequested(input));
}
down('KeyC');down('ControlLeft');down('ControlRight');
assert(consumeCrouchPress(input));
assert(!consumeCrouchPress(input),'aliases must not leak a second edge into the next simulation tick');
input._onBlur();
down('KeyC',true);down('KeyW',true);
assert.equal(input.keys.size,0,'typing in a form must not move the player');
assert(!consumeCrouchPress(input));
input.pointerLocked=true;down('KeyC');
assert.equal(prevented,1,'gameplay crouch must prevent browser default handling');
input._onBlur();
input.setVirtualKey('KeyC',true);
assert(crouchRequested(input) && consumeCrouchPress(input),'touch slide must use the same action');
input.setVirtualKey('KeyC',true);
assert(!consumeCrouchPress(input),'another held touch must not retrigger the action');
input.setVirtualKey('KeyC',false);
assert(!crouchRequested(input));
input.setVirtualKey('KeyC',true);input._onBlur();
assert(!crouchRequested(input) && !consumeCrouchPress(input),'focus loss must release slide/crouch');
input.dispose();
console.log('Slide controls passed: C/both Ctrl keys, repeat suppression, simultaneous aliases, form focus, touch and blur cleanup.');

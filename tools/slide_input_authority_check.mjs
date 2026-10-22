import assert from 'node:assert/strict';
import { AuthRoom } from '../server/authroom.mjs';
import { AUTHORITY_TEST_ARENA } from './fixtures/authorityArena.mjs';

function setup() {
  const arena={...AUTHORITY_TEST_ARENA,id:'slide-input-fixture',platforms:[],boxes:[],half:100,spawns:[[0,0,0]]};
  const room=new AuthRoom(arena,{targetPopulation:0});room._rotateMatch=()=>false;
  const id=room.add(()=>{},'Slider');const p=room.players.get(id);let seq=0;
  const send=(extra={})=>room.onInput(id,{seq:++seq,mz:1,sprint:1,...extra});
  return {room,id,p,send};
}

// Real authority previously alternated 11.2/0m/s between sparse packets, so
// the crouch edge always arrived after a forced stop and could not slide.
for(const hz of [10,15]){
  const {room,p,send}=setup();let packet=-1,slid=false,jumped=false,pressed=false,jumpPressed=false;
  for(let tick=0;tick<24;tick++){
    const next=Math.floor(tick*hz/20);
    if(next!==packet){
      packet=next;
      const crouchDown=tick>=6&&!pressed;const jump=tick>=10&&!jumpPressed;
      send({crouch:tick>=6?1:0,crouchDown:!!crouchDown,jump:!!jump});
      if(crouchDown)pressed=true;if(jump)jumpPressed=true;
    }
    room.update();
    if(tick<6)assert(Math.hypot(p.state.vx,p.state.vz)>11,'input starvation stopped a held sprint');
    slid ||= !!p.state.slide;
    jumped ||= jumpPressed&&!p.state.slide&&p.state.vy>12;
    assert.equal(p.state.airJumpUsed,0,'held-input grace replayed the jump edge as a double jump');
  }
  assert(slid && jumped,`${hz}Hz packets must permit slide and jump exit`);
}

{
  const {room,id,p,send}=setup();
  send();room.update();const deadline=p._heldInputUntilTick;
  room.update();assert(p.state.vz<-11,'one missed packet must keep held intent');
  room.onInput(id,{seq:p.lastInputSeq,mz:1,sprint:1});
  assert.equal(p._heldInputUntilTick,deadline,'replayed sequence renewed input grace');
  for(let i=0;i<4;i++)room.update();
  assert.equal(p.state.vz,0,'missing input did not expire after 150ms');
  assert.equal(p._heldInput,null,'expired intent remained available for revival');
  send();room.update();send({mz:0,sprint:0});room.update();
  assert.equal(p.state.vz,0,'explicit neutral did not stop immediately');
  for(let i=0;i<4;i++)room.update();assert.equal(p.state.vz,0,'neutral input resurrected held movement');
}

{
  const {room,p,send}=setup();
  send({crouch:1,crouchDown:1});room.update();
  assert.equal(p.state.slide,0,'standing start must not bypass slide speed requirement');
  assert.equal(p._heldInput.inp.crouchJust,0);
  for(let i=0;i<3;i++){room.update();assert.equal(p.state.slide,0,'grace replayed the crouch edge');}
  send({jump:1});room.update();const vy=p.state.vy;
  assert.equal(p._heldInput.inp.jumpJust,0);
  room.update();assert(p.state.vy<vy&&!p.state.airJumpUsed,'grace replayed jump');
  send({tele:1});room.update();assert.equal(p._heldInput.inp.teleJust,0);
}

for(const transition of ['spectating','readiness','round','death']){
  const {room,id,p,send}=setup();send();room.update();assert(p._heldInput);
  if(transition==='spectating'){
    room.setSpectating(id,true);room.setSpectating(id,false);
  }else if(transition==='readiness'){
    p.readinessProtocol=true;room._beginRoundGate();
    room.onReady(id,{mapId:room.arena.id,matchStart:room.matchStart});room._advanceRoundGate();
  }else if(transition==='round'){
    room._beginRoundGate();room._advanceRoundGate();
  }else{
    room._kill(p);const previousSeq=p.lastInputSeq;send();
    assert.equal(p.lastInputSeq,previousSeq,'dead player queued movement for a new life');
    p.deadUntil=room.tick+1;room.update();
  }
  assert.equal(p._heldInput,null,`${transition} retained movement intent`);
  room.update();assert.equal(p.state.vz,0,`${transition} revived stale movement`);
}
console.log('Slide input authority passed: 10/15Hz packet movement, slide+jump, bounded grace, neutral stop, no repeated edges/replays, readiness/round/spectator/death resets.');

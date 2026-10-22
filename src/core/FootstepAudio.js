// Concrete sole recordings by Kenney (CC0); see public/audio/footsteps/LICENSE.txt.
import { playBufferVoice } from './SoundEffects.js';
const banks = new WeakMap();
export function preloadFootsteps(ctx) {
  if (banks.has(ctx)) return banks.get(ctx).ready;
  const bank = { buffers: [], last: -1 };
  banks.set(ctx, bank);
  bank.ready = Promise.allSettled(Array.from({length:5}, async (_, index) => {
    const response = await fetch('/audio/footsteps/footstep_concrete_00' + index + '.ogg');
    if (!response.ok) throw new Error('Footstep audio unavailable');
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    bank.buffers.push(buffer);
  }));
  return bank.ready;
}
export function playFootstepRecording(audio, sprint = false, landing = false) {
  const ctx = audio.ctx;
  if (!ctx) return;
  const bank = banks.get(ctx);
  if (!bank) { preloadFootsteps(ctx); return; }
  if (!bank.buffers.length) return; // Never queue late footsteps or play the old synthetic clank.
  let index = Math.floor(Math.random() * bank.buffers.length);
  if (index === bank.last && bank.buffers.length > 1) index = (index + 1) % bank.buffers.length;
  bank.last = index;
  playBufferVoice(audio, bank.buffers[index], {
    rate:(landing ? .88 : sprint ? 1.03 : .97) + Math.random() * .05,
    gain:landing ? .7 : sprint ? .55 : .4, lowpass:1900, priority:0,
  });
}

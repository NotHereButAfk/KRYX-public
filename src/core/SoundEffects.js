// Original synthesized Foley and weapon recordings. Render once per variation,
// then play one buffer per event instead of rebuilding a large live synth graph.
export const GUN_TIMBRES = Object.freeze({
  m4: [0.24, 175, 3400, .86], magnum: [.52, 98, 2700, .94],
  battlerifle: [.20, 220, 4100, .82], energyshotgun: [.25, 140, 2200, .85],
  plasmarifle: [.65, 72, 1300, .86], uzi: [.15, 295, 4700, .68],
  levershotgun: [.66, 82, 1900, .94], rpg: [.85, 60, 650, .86],
  concussion: [.42, 115, 1100, .85],
});
const ALIASES = {rifle:'m4',sidearm:'magnum',m16:'battlerifle',lmg:'energyshotgun',smg:'uzi',shotgun:'levershotgun',sniper:'magnum',boltsniper:'magnum',dmr:'battlerifle',needler:'plasmarifle',fuelrod:'rpg'};
export const EFFECT_NAMES = Object.freeze(['slice','blade-armor','blade-metal','rocket-blast','grenade-blast','reload','hit','kill','hurt','empty','step','run-step','jump','land','hard-land','teleport','switch','casing','magazine','rack','growl','zombie-death','zombie-attack','anime','waifu','laser','fire','fireball','prism','pyro','meow','uwu','bark','sparkle','water','garden','toxic','neko']);

export function renderSound(name, sampleRate = 48000, variant = 0, rounds = 3) {
  const id = ALIASES[name] || name;
  const gun = GUN_TIMBRES[id];
  const burst = id === 'battlerifle' ? Math.max(1,Math.min(3,Math.floor(rounds)||1)) : 1;
  const duration = gun ? gun[0] + (burst-1)*.045 : /blast/.test(id) ? 1.45 : /growl|zombie-death/.test(id) ? .85 : .72;
  const data = new Float32Array(Math.ceil(duration * sampleRate));
  let seed = (1234567 + variant*7919 + [...id].reduce((h,c)=>h*31+c.charCodeAt(0),0)) | 0;
  const random = () => { seed ^= seed<<13; seed ^= seed>>>17; seed ^= seed<<5; return (seed>>>0)/2147483648-1; };
  const pitch = 1 + (variant-1.5)*.013;
  function noise(delay, length, gain, low = 80, high = 6000, decay = 6, attack = .001) {
    let lp = 0, hp = 0;
    const a = 1-Math.exp(-2*Math.PI*Math.min(high,sampleRate*.43)/sampleRate);
    const b = 1-Math.exp(-2*Math.PI*low/sampleRate);
    const start = Math.round(delay*sampleRate), count = Math.ceil(length*sampleRate);
    for(let i=0;i<count && start+i<data.length;i++) {
      lp += a*(random()-lp); hp += b*(lp-hp);
      const t=i/sampleRate, envelope=Math.min(1,t/attack)*Math.exp(-decay*t/length)*Math.min(1,(count-i)/(sampleRate*.008));
      data[start+i] += (lp-hp)*gain*envelope;
    }
  }
  function tone(delay, length, gain, startHz, endHz, grit = 0, decay = 5) {
    let phase=0;const start=Math.round(delay*sampleRate),count=Math.ceil(length*sampleRate);
    for(let i=0;i<count && start+i<data.length;i++) {
      const t=i/sampleRate, p=t/length;
      phase += 2*Math.PI*(endHz+(startHz-endHz)*Math.exp(-p*7))*pitch/sampleRate;
      const wave=Math.sin(phase)+grit*Math.sin(phase*2.71+Math.sin(t*53)*.5);
      data[start+i] += wave*gain*Math.min(1,t/.0015)*Math.exp(-p*decay)*Math.min(1,(count-i)/(sampleRate*.01));
    }
  }
  const latch = (time=0, gain=.22) => {
    noise(time,.025,gain*2,850,7500,7,.0004);
    tone(time,.045,gain*.3,1670,1470,.35,7);
    noise(time+.019,.028,gain,250,1900,6);
  };
  if (gun) {
    const [tail,body,crack] = gun;
    for(let i=0;i<burst;i++) {
      const t=i*.045;
      noise(t,.023,1.45,crack*.4,11500,5,.00025);
      noise(t+.002,tail,2.7,65,crack,7);
      tone(t,Math.min(tail,.3),.72,body*1.7,body*.55,.09,7);
      noise(t+.035,tail*.72,.48,130,1800,5,.006);
      latch(t+.026, id==='energyshotgun'?.26:.12);
    }
    if(id==='magnum') {noise(.026,.38,1.1,120,3100,6);tone(.003,.32,.65,130,40,.08);}
    if(id==='levershotgun') {noise(.006,.34,2,45,2700,5);latch(.30,.36);noise(.36,.1,.65,400,2800,7);}
    if(id==='rpg') {noise(.014,.78,2.6,45,1400,3,.014);tone(0,.42,.6,100,32);}
    if(id==='concussion') {tone(0,.27,.9,240,72,.15);noise(.005,.18,.8,100,780,5);latch(.19,.28);}
    if(id==='plasmarifle') {tone(0,.49,.95,1450,64,.3);tone(.006,.55,.55,390,41,.15);noise(.012,.46,.8,500,4800,6);}
  } else switch(id) {
    case 'rocket-blast': case 'grenade-blast': {
      const rocket=id==='rocket-blast';
      noise(0,.055,2.4,350,8500,5,.0003);noise(.007,rocket?1.3:.85,4,25,1600,5,.004);
      tone(0,.65,1.1,rocket?105:150,30,.1);noise(.1,.9,1.1,120,2300,5,.025);
      for(let i=0;i<7;i++)noise(.17+i*.08,.06,.35/(1+i*.2),900,4500,7);
      break;
    }
    case 'slice': noise(0,.12,.4,600,4200,2,.025);noise(.055,.24,1.7,1600,9500,5,.015);tone(.08,.2,.1,2400,650,.1);break;
    case 'blade-metal': case 'blade-armor':
      noise(0,.07,1.6,180,7000,6);tone(0,.15,.55,185,55,.1);
      for(const [f,g] of [[790,.20],[1331,.13],[2170,.07]])tone(.005,id==='blade-metal'?.44:.14,g,f,f*.98,.1);break;
    case 'step': case 'run-step': {
      // Soft heel-to-toe boot contact: muted heel, sole compression, short scuff.
      // No pitched metal resonances, hard clicks, or equipment latch layer.
      const running = id === 'run-step';
      const weight = running ? 1.25 : 1;
      const toe = (running ? .036 : .052) + variant * .002;
      noise(0, .105, 1.15 * weight, 25, 260, 4, .012);
      noise(.012, .095, .55 * weight, 70, 620, 4, .010);
      noise(toe, .085, .42 * weight, 100, 850, 3.5, .014);
      noise(toe + .018, .12, .13, 280, 1350, 4, .022);
      break;
    }
    case 'land': case 'hard-land': {
      const weight = id === 'hard-land' ? 1.5 : 1;
      noise(0, .19, 1.7 * weight, 25, 380, 4, .010);
      noise(.026, .13, .6 * weight, 90, 800, 4, .014);
      noise(.055, .16, .20, 250, 1450, 4, .024);
      break;
    }
    case 'jump':
      // Sole pushes off, then fabric/armour shifts as the feet leave the floor.
      noise(0,.055,1.2,80,1500,5);tone(0,.075,.25,105,50);
      noise(.02,.13,.85,550,4200,3,.009);
      noise(.085,.19,.38,250,2400,5,.018);break;
    case 'hit': noise(0,.024,.65,1700,6800,8);tone(0,.075,.24,1350,950,.04,8);break;
    case 'kill': tone(0,.16,.36,660,660,.03);tone(.065,.23,.30,990,990,.03);noise(0,.04,.3,1200,5200,6);break;
    case 'hurt': noise(0,.16,1,80,1400,6);tone(0,.2,.48,150,48,.1);noise(.045,.18,.25,800,3200,5);break;
    case 'empty': latch(0,.32);break;
    case 'switch': noise(0,.12,.55,350,3300,4,.008);latch(.045,.21);break;
    case 'reload': latch();noise(.055,.12,.45,300,3000,4);latch(.16,.3);break;
    case 'magazine': latch(0,.22);noise(.025,.15,.5,170,1900,4);latch(.13,.35);break;
    case 'rack': noise(0,.09,.8,450,4700,3,.008);latch(.07,.4);break;
    case 'casing': for(let i=0;i<3;i++){const t=.13+i*.11;latch(t,.05/(i+1));tone(t,.07,.07/(i+1),3200,3000,.35);}break;
    case 'teleport': tone(0,.12,.36,260,2600,.15);noise(.07,.3,1,600,7000,5);tone(.1,.35,.4,760,135,.1);break;
    case 'growl': case 'zombie-death': case 'zombie-attack': {
      const death=id==='zombie-death';
      for(let i=0;i<9;i++)noise(i*.044,.19,.6,80,death?620:1100,4,.009);
      tone(0,.62,.35,death?150:100,death?32:61,.75,2);
      noise(0,.13,id==='zombie-attack'?1.5:.4,100,2100,5);break;
    }
    case 'water': tone(0,.24,.5,1150,230,.12);tone(.055,.21,.24,1760,500);noise(0,.16,.5,700,3800,5);break;
    case 'garden': for(let i=0;i<3;i++)tone(i*.025,.26,.3/(i+1),[990,1485,1980][i],[980,1460,1940][i],.12);noise(0,.08,.5,1200,5200,7);break;
    case 'toxic': noise(0,.36,1.3,300,5400,4);tone(0,.26,.35,330,110,.5);break;
    case 'neko': tone(0,.22,.4,650,1350,.35);tone(.035,.23,.2,1650,900,.15);noise(0,.04,.4,900,4300,6);break;
    default: { // Themed skin accents retain their own melodic/noise identities.
      const index=Math.max(0,EFFECT_NAMES.indexOf(id)-23), f=360+index*125;
      noise(0,.06,.9,400,4000,6);
      tone(0,.3,.55,f*2,f*.5,.24);tone(.045,.33,.20,f*3,f,.08);
      if(/fire|pyro/.test(id))noise(.015,.5,1.5,120,3300,5);
      if(/meow|uwu|anime|waifu/.test(id))tone(.02,.23,.2,850,1400,.4);
    }
  }
  const level = gun?.[3] ?? (/blast/.test(id)?.94 : /step/.test(id)?(id==='step'?.18:.25) : /land/.test(id)?(id==='land'?.30:.52) : id==='casing'?.09 : id==='hit'?.25 : id==='kill'?.32 : .45);
  let peak=0;
  for(let i=0;i<data.length;i++){data[i]=Math.tanh(data[i]*1.2);peak=Math.max(peak,Math.abs(data[i]));}
  if(peak)for(let i=0;i<data.length;i++)data[i]*=level/peak;
  return data;
}

export function playDesignedSound(audio, name, rounds = 3) {
  if(!audio.ctx)return;
  audio._designedBuffers ||= new Map();
  const variant=Math.floor(Math.random()*4), key=`${name}:${variant}:${rounds}`;
  let buffer=audio._designedBuffers.get(key);
  if(!buffer){
    const samples=renderSound(name,audio.ctx.sampleRate,variant,rounds);
    buffer=audio.ctx.createBuffer(1,samples.length,audio.ctx.sampleRate);buffer.copyToChannel(samples,0);
    if(audio._designedBuffers.size>=96)audio._designedBuffers.delete(audio._designedBuffers.keys().next().value);
    audio._designedBuffers.set(key,buffer);
  }
  const source=audio.ctx.createBufferSource();source.buffer=buffer;
  source.playbackRate.value=.985+Math.random()*.03;
  source.connect(audio.out || audio.master);
  source.onended=()=>source.disconnect();source.start();
}

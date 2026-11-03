const freezeTimbre = (duration, bodyHz, crackHz, peak) =>
  Object.freeze([duration, bodyHz, crackHz, peak]);

export const GUN_TIMBRES = Object.freeze({
  m4: freezeTimbre(.34, 165, 3600, .86),
  magnum: freezeTimbre(.66, 82, 3000, .94),
  battlerifle: freezeTimbre(.28, 200, 4300, .82),
  energyshotgun: freezeTimbre(.40, 135, 2500, .85),
  plasmarifle: freezeTimbre(.72, 72, 1300, .86),
  uzi: freezeTimbre(.22, 290, 4700, .68),
  levershotgun: freezeTimbre(.82, 78, 2100, .94),
  rpg: freezeTimbre(.95, 55, 900, .86),
  concussion: freezeTimbre(.58, 105, 1500, .85)
});

const burstCount = rounds => Number.isFinite(rounds)
  ? Math.min(3, Math.max(1, Math.floor(rounds))) : 1;

export function addWeaponLayers(id, dsp, rounds = 1) {
  const timbre = GUN_TIMBRES[id];
  if (!timbre) return false;
  const [duration, body, crack, peak] = timbre;
  const count = id === 'battlerifle' ? burstCount(rounds) : 1;
  const add = (offset, noise, tone) => {
    dsp.noise(offset, noise[0], noise[1], noise[2], noise[3], noise[4], noise[5]);
    dsp.tone(offset, tone[0], tone[1], tone[2], tone[3], tone[4], tone[5]);
  };

  for (let shot = 0; shot < count; shot += 1) {
    const t = shot * .045;
    if (id !== 'plasmarifle' && id !== 'rpg') {
      const tail = Math.min(.19, duration * .55);
      dsp.noise(t + .002, tail, .75, 55, crack, 5.2, .001);
      // Short filtered reflections add depth without filling an automatic
      // burst with a continuous white-noise wash.
      dsp.noise(t + .042, .065, .13, 250, 2400, 4, .003);
      dsp.noise(t + .079, .070, .065, 180, 1400, 5, .005);
      dsp.latch(t + (id === 'uzi' ? .043 : .055), .045);
    }
    switch (id) {
      case 'm4':
        add(t, [.018, peak * .72, 110, 6200, 5.5, .001], [.16, peak * .17, body, body * .92, .08, 5]);
        dsp.noise(t + .004, .008, peak * .32, 2600, 7600, 7, .001);
        dsp.tone(t + .045, .032, peak * .12, body, body * .7, 0, 8);
        break;
      case 'magnum':
        add(t, [.035, peak * .78, 70, 4800, 4.5, .001], [.30, peak * .22, body, body * .8, .03, 4]);
        dsp.noise(t + .012, .045, peak * .25, 900, 4200, 5, .001);
        dsp.tone(t + .075, .055, peak * .16, body * 1.15, body, 0, 7);
        break;
      case 'battlerifle':
        add(t, [.014, peak * .66, 100, 6900, 5, .001], [.13, peak * .14, body, body * .86, .04, 5]);
        dsp.noise(t + .006, .006, peak * .25, 3000, 8200, 7, .001);
        dsp.tone(t + .04, .026, peak * .1, body, body * .72, 0, 8);
        break;
      case 'energyshotgun':
        add(t, [.025, peak * .6, 90, 5200, 4, .001], [.22, peak * .20, body, body * .88, .02, 5]);
        dsp.noise(t + .018, .095, peak * .27, 180, 3100, 5, .004);
        dsp.tone(t + .07, .06, peak * .14, body * .8, body * .65, .01, 7);
        break;
      case 'plasmarifle':
        dsp.tone(t, .36, peak * .35, 430, body, .06, 4);
        dsp.noise(t + .01, .045, peak * .28, 500, 3000, 5, .002);
        dsp.tone(t + .09, .28, peak * .2, body, 620, .05, 5);
        break;
      case 'uzi':
        add(t, [.01, peak * .58, 140, 7000, 6, .001], [.09, peak * .22, body, body * .9, .06, 6]);
        dsp.noise(t + .035, .006, peak * .18, 3200, 8500, 8, .001);
        break;
      case 'levershotgun':
        add(t, [.055, peak * .82, 55, 4300, 3.5, .001], [.34, peak * .25, body, body * .86, .01, 4]);
        dsp.noise(t + .025, .14, peak * .25, 100, 2600, 4, .006);
        dsp.latch(.30, .18);
        dsp.latch(.38, .14);
        break;
      case 'rpg':
        dsp.noise(t, .055, peak * .48, 70, 2600, 4, .002);
        dsp.tone(t + .025, .18, peak * .36, body, body * .8, .02, 4);
        dsp.noise(t + .16, .55, peak * .25, 55, 1800, 2.5, .025);
        dsp.tone(t + .2, .5, peak * .18, body * .7, 180, .03, 3);
        break;
      case 'concussion':
        add(t, [.04, peak * .72, 70, 3200, 3.5, .001], [.25, peak * .25, body, body * .90, .01, 4]);
        dsp.tone(t + .045, .11, peak * .25, body * 1.2, body * .8, .01, 5);
        dsp.noise(t + .075, .12, peak * .12, 100, 1800, 3, .01);
        break;
    }
  }
  return true;
}

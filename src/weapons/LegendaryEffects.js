import { Color } from 'three';

// Per-material shader uniforms: no shared texture mutation or geometry changes.
export function configureLegendaryEffect(material, skin) {
  const previous = material.userData.legendaryEffect;
  if (previous) {
    material.onBeforeCompile = previous.compile;
    material.customProgramCacheKey = previous.key;
    delete material.userData.legendaryEffect;
    material.needsUpdate = true;
  }
  if (!['legendary', 'mythic'].includes(skin?.rarity) || !Number.isInteger(skin.legendaryStyle)) return;
  const effect = {
    compile: material.onBeforeCompile, key: material.customProgramCacheKey,
    time: { value: 0 }, shot: { value: 0 }, style: { value: skin.legendaryStyle },
    color: { value: new Color(skin.energyColor) }, shotAt: -Infinity,
    kill: { value: 0 }, killAt: -Infinity,
  };
  material.userData.legendaryEffect = effect;
  const cacheKey = effect.key.call(material);
  material.customProgramCacheKey = () => cacheKey + ':legendary-effects-v2';
  material.onBeforeCompile = function(shader, renderer) {
    effect.compile.call(this, shader, renderer);
    Object.assign(shader.uniforms, { legendaryTime: effect.time, legendaryShot: effect.shot,
      legendaryStyle: effect.style, legendaryColor: effect.color, legendaryKill: effect.kill });
    shader.vertexShader = 'varying vec3 vLegendaryPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLegendaryPosition = position;');
    shader.fragmentShader = `varying vec3 vLegendaryPosition;
      uniform float legendaryTime, legendaryShot, legendaryStyle, legendaryKill;
      uniform vec3 legendaryColor;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec3 lp = vLegendaryPosition;
      float lt = legendaryTime;
      float fx = 0.0;
      if (legendaryStyle < 0.5) {
        fx = pow(0.5 + 0.5*sin(lp.z*24.0 - lt*3.5), 16.0);
      } else if (legendaryStyle < 1.5) {
        fx = pow(max(0.0, sin(lp.y*37.0-lt*5.0)*sin(lp.z*29.0+lt*2.0)), 3.0);
      } else if (legendaryStyle < 2.5) {
        vec3 cell = floor(lp*48.0);
        float seed = fract(sin(dot(cell,vec3(12.9898,78.233,39.425)))*43758.5453);
        fx = step(0.86,seed)*pow(0.5+0.5*sin(lt*3.0+seed*36.0),4.0);
      } else if (legendaryStyle < 3.5) {
        fx = pow(0.5+0.5*sin(lp.z*32.0+atan(lp.y+0.001,lp.x+0.001)*3.0-lt*4.0),10.0);
      } else {
        fx = pow(0.5+0.5*sin(length(lp.xy)*44.0+lp.z*8.0-lt*3.0),18.0);
      }
      // A kill intensifies the same themed motion instead of a generic flash.
      float victory = fx * (0.6 + 0.4*sin(lt*12.0)*sin(lt*12.0));
      totalEmissiveRadiance += legendaryColor * (fx*0.65 + legendaryShot*0.45 + legendaryKill*(0.35 + victory*1.5));
    `);
  };
  material.needsUpdate = true;
}

export function updateLegendaryEffect(material, time) {
  const effect = material.userData.legendaryEffect;
  if (!effect) return;
  effect.time.value = time;
  effect.kill.value = Math.max(0, 1 - (time - effect.killAt) / 1.5);
  effect.shot.value = Math.exp(-Math.max(0,time-effect.shotAt)*18);
}

export function triggerLegendaryShot(group, time) {
  group?.traverse(obj => {
    const effect = obj.material?.userData?.legendaryEffect;
    if (effect) { effect.shotAt = time; effect.shot.value = 1; }
  });
}

export function triggerLegendaryKill(group, time) {
  group?.traverse(obj => {
    const effect = obj.material?.userData?.legendaryEffect;
    if (effect) { effect.killAt = time; effect.kill.value = 1; }
  });
}

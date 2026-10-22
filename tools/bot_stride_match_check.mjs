import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { installEvCharacter } from '../src/player/EvCharacter.js';
import { Avatar } from '../src/player/Avatar.js';
import { WALK_SPEED, SPRINT_MULT } from '../src/sim/MovementConfig.js';

globalThis.ProgressEvent ??= class {};
const bytes = fs.readFileSync('public/ev-default.glb');
installEvCharacter(await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));

// Measure world-space ankle movement during the low, planted part of stance.
// This catches a moving root with frozen legs as well as a slowed gait clock.
for (const speed of [WALK_SPEED, WALK_SPEED * SPRINT_MULT]) {
  for (const sideways of [false, true]) {
    const avatar = new Avatar(new THREE.Scene());
    const position = new THREE.Vector3(), samples = [];
    let previous;
    for (let frame = 0; frame < 360; frame++) {
      position[sideways ? 'x' : 'z'] += (sideways ? 1 : -1) * speed / 60;
      avatar.update(1 / 60, {
        position, yaw: 0, sprint: speed > WALK_SPEED,
        grounded: true, isBot: true, firing: true,
      });
      avatar.group.updateMatrixWorld(true);
      const foot = avatar.group.userData.bones.Bip001_L_Foot.getWorldPosition(new THREE.Vector3());
      if (previous && frame > 120) samples.push({
        height: foot.y,
        slip: Math.hypot(foot.x - previous.x, foot.z - previous.z) * 60 / speed,
      });
      previous = foot;
    }
    const floor = Math.min(...samples.map(sample => sample.height));
    const planted = samples.filter(sample => sample.height < floor + .025)
      .map(sample => sample.slip).sort((a, b) => a - b);
    const medianSlip = planted[Math.floor(planted.length / 2)];
    assert(medianSlip < .1, 'planted ankle must remain fixed in world space');
    const data = avatar.group.userData;
    const index = data.animationActions.findIndex(action => action.getEffectiveWeight() > .99);
    assert(Math.abs(data.measuredSpeeds[index] * data.animationCadence - speed) < .05);
    console.log({ speed, sideways, medianSlip });
    avatar.dispose();
  }
}

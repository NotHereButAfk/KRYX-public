import { Avatar } from '../player/Avatar.js';
import { BOT_SKIN } from '../player/skins.js';

// Online Survival uses the same body and distance-matched gait as arena bots.
// The server still owns enemy roles, health, damage, waves and navigation.
export class ZombieAvatar extends Avatar {
  constructor(scene, variant = 0, type = 'walker') {
    super(scene, { skin: BOT_SKIN, armorTypeId: 'vanguard', allowHuman: true,
      weaponId: type === 'gunner' ? 'm4' : 'sword' });
    this.variant = variant;
    this.type = type;
    this.group.userData.isZombie = true;
  }
  update(dt, state) {
    const unarmed = this.type !== 'gunner';
    super.update(dt, { ...state, sprint: true, zombieReach: unarmed,
      firing: !unarmed && state.firing, aiming: !unarmed && state.aiming,
      swing: unarmed ? 1 : state.swing });
    this.group.userData.isZombie = true;
    if (unarmed && this.weapon) this.weapon.visible = false;
    if (unarmed && state.alive && this.rig) {
      this.rig.armL.rotation.x = this.rig.armR.rotation.x = -1.3;
      this.rig.elbowL.rotation.x = this.rig.elbowR.rotation.x = -.15;
    }
  }
}

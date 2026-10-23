import { tumbleGrenade } from './GrenadeTumble.js';
import { stepGrenade } from '../sim/GrenadePhysics.js';
import * as THREE from 'three';
import { createEnergyBlast } from '../effects/EnergyBlast.js';
import { createLauncherGrenade } from './LauncherGrenadeModel.js';
import { prepareExplosionLights, disposeExplosion, spawnExplosion, updateExplosion } from '../effects/ExplosionEffect.js';
import { createAbilityGrenade, updateGrenadeIndicator, createGrenadeTrail, updateGrenadeTrail,
  createImpulseWave, updateImpulseWave, createSmokeCloud, updateSmokeCloud, disposeAbilityObject } from '../effects/AbilityGrenadeEffects.js';

const THROW_SPEED = 16;
const THROW_ARC   = 4.5;
const FRAG_FUSE   = 2.5;
const SMOKE_FUSE  = 1.2;
const FRAG_RADIUS = 9;
const FRAG_DMG    = 150;

export class GrenadeSystem {
  constructor(scene, audio = null) {
    this.scene       = scene;
    this.audio       = audio;
    this.cooldowns = {frag: 0, smoke: 0};
    this.frags       = 2;
    this.smokes      = 2;
    this.bombMeshes = new Map();
    this.projectileMeshes = new Map();
    this.impulseWaves = [];
    this.throwables  = [];
    this.smokeClouds = [];
    this.explosions  = [];
    prepareExplosionLights(scene);
    this._previous = new THREE.Vector3();
    this._travel = new THREE.Vector3();
    this._travelDir = new THREE.Vector3();
    this._surfaceNormal = new THREE.Vector3(0, 1, 0);
    this._travelRay = new THREE.Ray();
    this._effectTime = 0;
    this._lastBounceSound = -1;

    this.onExplode = null; // (point, radius, damage) => void
    this.onSelfDamage = null; // (damage, point) => void; Game owns death flow
  }

  throwFrag(camera) {
    if (this.frags <= 0 || this.cooldowns.frag > 0) return;
    this.cooldowns.frag = 15;
    this.frags--;
    this._spawn(camera, 'frag');
  }

  throwSmoke(camera) {
    if (this.smokes <= 0 || this.cooldowns.smoke > 0) return;
    this.cooldowns.smoke = 15;
    this.smokes--;
    this._spawn(camera, 'smoke');
  }

  _spawn(camera, type) {
    const pos = new THREE.Vector3();
    camera.getWorldPosition(pos);
    pos.y -= 0.15;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    const vel = dir.clone().multiplyScalar(THROW_SPEED);
    vel.y += THROW_ARC;

    const mesh = this._buildMesh(type);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    const life = type === 'frag' ? FRAG_FUSE : SMOKE_FUSE;
    const trail = createGrenadeTrail(this.scene, pos, type);
    this.throwables.push({ mesh, pos: pos.clone(), vel, type, life, duration:life, trail });
  }

  _buildMesh(type) {
    return createAbilityGrenade(type);
  }

  update(dt, player, world = null) {
    this._effectTime += dt;
    for(let i=this.impulseWaves.length-1;i>=0;i--){
      const wave=this.impulseWaves[i];
      if(updateImpulseWave(wave,dt)){disposeAbilityObject(this.scene,wave.mesh);this.impulseWaves.splice(i,1);}
    }
    for (const kind of ['frag','smoke']) {
      const before=this.cooldowns[kind];
      this.cooldowns[kind]=Math.max(0,before-dt);
      if(before>0 && this.cooldowns[kind]===0)this[kind==='frag'?'frags':'smokes']=2;
    }
    // in-flight throwables
    for (let i = this.throwables.length - 1; i >= 0; i--) {
      const t = this.throwables[i];
      const state = { physicsRemainder:t.physicsRemainder||0, x:t.pos.x, y:t.pos.y, z:t.pos.z, vx:t.vel.x, vy:t.vel.y, vz:t.vel.z };
      stepGrenade(state, dt, (p, dx, dy, dz, length) => {
        this._previous.set(p.x,p.y,p.z);
        this._travelDir.set(dx,dy,dz);
        this._travelRay.set(this._previous,this._travelDir);
        if (world?.raycastCollisionHit) {
          const hit=world.raycastCollisionHit(this._travelRay,length);
          if (!hit) return null;
          const n=hit.normal || THREE.Object3D.DEFAULT_UP;
          return {distance:hit.distance,nx:n.x,ny:n.y,nz:n.z};
        }
        const distance=dy<0 ? -p.y/dy : Infinity;
        return !world && distance>=0 && distance<=length ? {distance,nx:0,ny:1,nz:0} : null;
      });
      t.physicsRemainder=state.physicsRemainder;
      this._bounceFeedback(t.mesh,t.vel.x,t.vel.y,t.vel.z,state.vx,state.vy,state.vz);
      t.pos.set(state.x,state.y,state.z); t.vel.set(state.vx,state.vy,state.vz);
      t.life -= dt;
      t.mesh.position.copy(t.pos);
      tumbleGrenade(t.mesh,t.vel.x,t.vel.y,t.vel.z,dt);
      updateGrenadeIndicator(t.mesh,dt,t.life,t.duration);
      if(t.trail) updateGrenadeTrail(t.trail,t.pos,t.vel.length(),dt);

      if (t.life <= 0) {
        this._detonate(t, player);
        disposeAbilityObject(this.scene,t.mesh);
        disposeAbilityObject(this.scene,t.trail?.line);
        this.throwables.splice(i, 1);
      }
    }

    // smoke clouds
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const s = this.smokeClouds[i];
      if (updateSmokeCloud(s,dt)) {
        disposeAbilityObject(this.scene,s.mesh);
        this.smokeClouds.splice(i, 1);
      }
    }

    // frag explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      if (updateExplosion(e, dt)) {
        disposeExplosion(this.scene, e);
        this.explosions.splice(i, 1);
      }
    }
  }

  _detonate(t, player) {
    if (t.type === 'frag') this._fragExplode(t.pos.clone(), player);
    else                   this._smokeExplode(t.pos.clone());
  }

  _fragExplode(point, player) {
    this.explosions.push(spawnExplosion(this.scene, point, FRAG_RADIUS, 'frag'));
    if (this.audio?.playExplosion) {
      if (this.audio.playAt) this.audio.playAt(point, () => this.audio.playExplosion('grenade'));
      else this.audio.playExplosion('grenade');
    }

    if (this.onExplode) this.onExplode(point, FRAG_RADIUS, FRAG_DMG);

    // self-damage
    if (player) {
      const d = player.position.distanceTo(point);
      if (d <= FRAG_RADIUS) {
        const f = THREE.MathUtils.lerp(1, 0.1, THREE.MathUtils.clamp(d / FRAG_RADIUS, 0, 1));
        const damage = FRAG_DMG * f;
        if (this.onSelfDamage) this.onSelfDamage(damage, point);
        else player.takeDamage(damage);
      }
    }
  }

  _smokeExplode(point, radius = 5, life = 8) {
    const cloud=createSmokeCloud(point,radius,life);
    this.scene.add(cloud.mesh);this.smokeClouds.push(cloud);
  }

  _bounceFeedback(mesh,vx,vy,vz,nx,ny,nz) {
    const before=Math.hypot(vx,vy,vz),after=Math.hypot(nx,ny,nz);
    if(before<2 || after<.4 || (vx*nx+vy*ny+vz*nz)>before*after*.25) return;
    const count=mesh.userData.audibleBounces||0;
    if(count>=3 || this._effectTime-this._lastBounceSound<.14) return;
    mesh.userData.audibleBounces=count+1;this._lastBounceSound=this._effectTime;
    // Existing short metal contact recording, spatialized and limited so a
    // cluster of resting grenades cannot generate an audio storm.
    if(this.audio?.playAt) this.audio.playAt(mesh.position,()=>this.audio.playShellCasing?.());
    else this.audio?.playShellCasing?.();
  }

  // Server events use the same effects without applying a second copy of
  // client-side damage. These also make remote throws visible.
  showAuthoritativeExplosion(point, radius = FRAG_RADIUS) {
    this.explosions.push(spawnExplosion(this.scene, point, radius, 'frag'));
    if (this.audio?.playAt) this.audio.playAt(point, () => this.audio.playExplosion?.('grenade'));
    else this.audio?.playExplosion?.('grenade');
  }

  syncProjectiles(projectiles, dt = 0.05, resolveMuzzle = null) {
    const ids = new Set(projectiles.map(p => p.id));
    for (const [id, mesh] of this.projectileMeshes) if (!ids.has(id)) {
      disposeAbilityObject(this.scene,mesh.userData.flightTrail?.line);
      disposeAbilityObject(this.scene,mesh);
      this.projectileMeshes.delete(id);
    }
    for (const p of projectiles) {
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        mesh = p.wid === 'plasmarifle' ? createEnergyBlast() : p.kind === 'launcherGrenade' ? createLauncherGrenade() : ['frag', 'smoke'].includes(p.kind) ? this._buildMesh(p.kind) : new THREE.Mesh(
          new THREE.CapsuleGeometry(0.07, 0.32, 2, 6),
          new THREE.MeshStandardMaterial({ color: 0xffa33b, emissive: 0xff5511, emissiveIntensity: 1.2 }));
        this.projectileMeshes.set(p.id, mesh); this.scene.add(mesh);
        mesh.position.set(p.x, p.y, p.z);
        if(['frag','smoke'].includes(p.kind)) {
          mesh.userData.flightTrail=createGrenadeTrail(this.scene,mesh.position,p.kind);
          mesh.userData.flightVelocity={x:p.vx,y:p.vy,z:p.vz};
        }
        const muzzle = resolveMuzzle?.(p);
        if (muzzle) {
          mesh.position.copy(muzzle);
          this._travel.set(p.x,p.y,p.z).sub(muzzle).normalize();
          if (this._travel.lengthSq() > 0) mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP,this._travel);
          continue; // First visible frame leaves the rendered gun, then joins server travel.
        }

      }
      this._travel.set(p.x, p.y, p.z);
      mesh.position.lerp(this._travel, 1 - Math.exp(-45 * dt));
      const velocity=mesh.userData.flightVelocity;
      if(velocity) {
        this._bounceFeedback(mesh,velocity.x,velocity.y,velocity.z,p.vx,p.vy,p.vz);
        velocity.x=p.vx;velocity.y=p.vy;velocity.z=p.vz;
        updateGrenadeIndicator(mesh,dt,p.remaining);
        updateGrenadeTrail(mesh.userData.flightTrail,mesh.position,Math.hypot(p.vx,p.vy,p.vz),dt);
      }
      if (p.kind === 'rocket') {
        this._travel.set(p.vx, p.vy, p.vz).normalize();
        mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this._travel);
      } else {
        tumbleGrenade(mesh,p.vx,p.vy,p.vz,dt);
      }
    }
  }

  showAuthoritativeSmoke(point, radius = 5, life = 8) {
    this._smokeExplode(point,radius,life);
  }

  syncBombs(bombs) {
    const ids=new Set(bombs.map(b=>b.id));
    for(const [id,mesh] of this.bombMeshes)if(!ids.has(id)){disposeAbilityObject(this.scene,mesh);this.bombMeshes.delete(id);}
    for(const bomb of bombs){
      let mesh=this.bombMeshes.get(bomb.id);
      if(!mesh){mesh=createAbilityGrenade('timebomb');this.bombMeshes.set(bomb.id,mesh);this.scene.add(mesh);}
      mesh.position.set(bomb.x,bomb.y,bomb.z);
      // Snapshot remaining time is authoritative; repeated snapshots must not
      // independently advance the fuse or make the ring run down twice as fast.
      mesh.userData.abilityVisual.age=Math.max(0,3-bomb.remaining);
      updateGrenadeIndicator(mesh,0,bomb.remaining,3);
    }
  }
  showImpulse(point, radius = 6) {
    if(this.impulseWaves.length>=8) disposeAbilityObject(this.scene,this.impulseWaves.shift().mesh);
    const wave=createImpulseWave(point,radius);
    this.scene.add(wave.mesh);this.impulseWaves.push(wave);
  }
  getHudInfo() {
    return { frags: this.frags, smokes: this.smokes };
  }

  refillInventory() {
    this.cooldowns = {frag: 0, smoke: 0};
    this.frags = 2;
    this.smokes = 2;
  }

  reset() {
    this.syncBombs([]);
    this.syncProjectiles([]);
    for(const w of this.impulseWaves) disposeAbilityObject(this.scene,w.mesh);this.impulseWaves=[];
    for (const t of this.throwables) {
      disposeAbilityObject(this.scene,t.mesh);
      disposeAbilityObject(this.scene,t.trail?.line);
    }
    this.throwables.length = 0;
    for (const s of this.smokeClouds) {
      disposeAbilityObject(this.scene,s.mesh);
    }
    this.smokeClouds.length = 0;
    for (const e of this.explosions) {
      disposeExplosion(this.scene, e);
    }
    this.explosions.length = 0;
    this.refillInventory();
  }
}

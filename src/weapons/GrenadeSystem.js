import { tumbleGrenade } from './GrenadeTumble.js';
import { stepGrenade } from '../sim/GrenadePhysics.js';
import * as THREE from 'three';
import { createEnergyBlast } from '../effects/EnergyBlast.js';
import { createLauncherGrenade } from './LauncherGrenadeModel.js';
import { prepareExplosionLights, disposeExplosion, spawnExplosion, updateExplosion } from '../effects/ExplosionEffect.js';

const THROW_SPEED = 16;
const THROW_ARC   = 4.5;
const GRAVITY     = -18;
const BOUNCE_DAMP = 0.40;
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

    this.throwables.push({ mesh, pos: pos.clone(), vel, type, life: type === 'frag' ? FRAG_FUSE : SMOKE_FUSE });
  }

  _buildMesh(type) {
    const g = new THREE.Group();
    if (type === 'frag') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e3d1f, roughness: 0.7, metalness: 0.45 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), bodyMat);
      g.add(body);
      // segmented surface bands
      for (let i = -1; i <= 1; i++) {
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(0.065, 0.009, 6, 14),
          new THREE.MeshStandardMaterial({ color: 0x1a2410, roughness: 0.8, metalness: 0.3 })
        );
        band.rotation.x = Math.PI / 2;
        band.position.y = i * 0.03;
        g.add(band);
      }
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.022, 0.005, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xb0a890, roughness: 0.4, metalness: 0.75 })
      );
      ring.position.y = 0.075;
      g.add(ring);
    } else {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a5068, roughness: 0.55, metalness: 0.35 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.14, 10), bodyMat);
      g.add(body);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.046, 0.046, 0.028, 10),
        new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.5, metalness: 0.2 })
      );
      band.position.y = 0.028;
      g.add(band);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.030, 0.042, 0.018, 10),
        new THREE.MeshStandardMaterial({ color: 0x2a3d4f, roughness: 0.6, metalness: 0.4 })
      );
      cap.position.y = 0.079;
      g.add(cap);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  update(dt, player, world = null) {
    for(let i=this.impulseWaves.length-1;i>=0;i--){
      const wave=this.impulseWaves[i];wave.age+=dt;wave.mesh.scale.setScalar(.1+wave.age*12);
      wave.mesh.material.opacity=Math.max(0,1-wave.age/.5);
      if(wave.age>=.5){this.scene.remove(wave.mesh);wave.mesh.geometry.dispose();wave.mesh.material.dispose();this.impulseWaves.splice(i,1);}
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
      t.pos.set(state.x,state.y,state.z); t.vel.set(state.vx,state.vy,state.vz);
      t.life -= dt;
      t.mesh.position.copy(t.pos);
      tumbleGrenade(t.mesh,t.vel.x,t.vel.y,t.vel.z,dt);

      if (t.life <= 0) {
        this._detonate(t, player);
        this.scene.remove(t.mesh);
        t.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        this.throwables.splice(i, 1);
      }
    }

    // smoke clouds
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const s = this.smokeClouds[i];
      s.t += dt;
      const p = s.t / s.life;
      if (p >= 1) {
        for (const m of s.meshes) {
          this.scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
        }
        this.smokeClouds.splice(i, 1);
        continue;
      }
      const scale   = p < 0.25 ? THREE.MathUtils.lerp(0.05, 1, p / 0.25) : 1;
      const opacity = p > 0.72 ? THREE.MathUtils.lerp(0.7, 0, (p - 0.72) / 0.28) : 0.7;
      for (const m of s.meshes) {
        m.scale.setScalar(scale);
        m.material.opacity = opacity;
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

  _smokeExplode(point) {
    const RADIUS = 4.2;
    const meshes = [];
    for (let i = 0; i < 6; i++) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * RADIUS * 0.9,
        Math.random() * RADIUS * 0.55,
        (Math.random() - 0.5) * RADIUS * 0.9
      );
      const r = RADIUS * (0.55 + Math.random() * 0.45);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xd0d0d0, transparent: true, opacity: 0, depthWrite: false })
      );
      mesh.position.copy(point).add(offset);
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    this.smokeClouds.push({ meshes, t: 0, life: 9 });
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
      this.scene.remove(mesh);
      mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
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
      if (p.kind === 'rocket') {
        this._travel.set(p.vx, p.vy, p.vz).normalize();
        mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this._travel);
      } else {
        tumbleGrenade(mesh,p.vx,p.vy,p.vz,dt);
      }
    }
  }

  showAuthoritativeSmoke(point) {
    this._smokeExplode(point);
  }

  syncBombs(bombs) {
    const ids=new Set(bombs.map(b=>b.id));
    for(const [id,mesh] of this.bombMeshes)if(!ids.has(id)){this.scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();this.bombMeshes.delete(id);}
    for(const bomb of bombs){
      let mesh=this.bombMeshes.get(bomb.id);
      if(!mesh){mesh=new THREE.Mesh(new THREE.CylinderGeometry(.24,.28,.10,16),new THREE.MeshStandardMaterial({color:0x173847,emissive:0x00bbee,emissiveIntensity:1}));this.bombMeshes.set(bomb.id,mesh);this.scene.add(mesh);}
      mesh.position.set(bomb.x,bomb.y,bomb.z);mesh.material.emissiveIntensity=.6+(Math.sin(bomb.remaining*18)+1)*1.1;
    }
  }
  showImpulse(point) {
    const mesh=new THREE.Mesh(new THREE.RingGeometry(.85,1,48),new THREE.MeshBasicMaterial({color:0x00ddff,transparent:true,opacity:1,side:THREE.DoubleSide,depthWrite:false}));
    mesh.rotation.x=-Math.PI/2;mesh.position.copy(point);this.scene.add(mesh);this.impulseWaves.push({mesh,age:0});
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
    for(const w of this.impulseWaves){this.scene.remove(w.mesh);w.mesh.geometry.dispose();w.mesh.material.dispose();}this.impulseWaves=[];
    for (const t of this.throwables) {
      this.scene.remove(t.mesh);
      t.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.throwables.length = 0;
    for (const s of this.smokeClouds) {
      for (const m of s.meshes) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    }
    this.smokeClouds.length = 0;
    for (const e of this.explosions) {
      disposeExplosion(this.scene, e);
    }
    this.explosions.length = 0;
    this.refillInventory();
  }
}

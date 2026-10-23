import * as THREE from 'three';

// A small, fixed geometry/material cache. Individual effects only own the
// animated glow/trail materials; removing one grenade must not dispose another.
const GEOMETRY = {
  frag: new THREE.SphereGeometry(.064, 10, 8),
  band: new THREE.TorusGeometry(.061, .008, 5, 12),
  smoke: new THREE.CylinderGeometry(.042, .042, .132, 10),
  smokeBand: new THREE.CylinderGeometry(.045, .045, .025, 10),
  cap: new THREE.CylinderGeometry(.027, .035, .018, 8),
  lever: new THREE.BoxGeometry(.018, .075, .017),
  lamp: new THREE.SphereGeometry(.013, 6, 4),
  bomb: new THREE.CylinderGeometry(.23, .27, .09, 12),
  bombCap: new THREE.CylinderGeometry(.17, .19, .035, 12),
  bombRing: new THREE.RingGeometry(.28, .32, 32),
  wave: new THREE.RingGeometry(.95, 1, 48),
  shell: new THREE.SphereGeometry(1, 20, 12),
  smokeCloud: new THREE.IcosahedronGeometry(1, 2),
};
const MATERIAL = {
  frag: new THREE.MeshStandardMaterial({color:0x405139,roughness:.72,metalness:.35}),
  smoke: new THREE.MeshStandardMaterial({color:0x536b78,roughness:.6,metalness:.4}),
  dark: new THREE.MeshStandardMaterial({color:0x15232b,roughness:.65,metalness:.4}),
  metal: new THREE.MeshStandardMaterial({color:0xa1a7a8,roughness:.4,metalness:.65}),
};
for (const resource of [...Object.values(GEOMETRY), ...Object.values(MATERIAL)]) resource.userData.shared = true;
const COLORS = {frag:0xffb34d,smoke:0xbed5dc,timebomb:0xff6f42};
const fadeMaterial = (color, opacity = 1) => new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
function part(root, name, geometry, material, y = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.position.y = y; root.add(mesh); return mesh;
}

export function createAbilityGrenade(kind) {
  const root = new THREE.Group(); root.name = `${kind} ability grenade`;
  const glow = fadeMaterial(COLORS[kind] || COLORS.frag);
  if (kind === 'timebomb') {
    part(root,'Planted charge',GEOMETRY.bomb,MATERIAL.dark);
    part(root,'Charge cap',GEOMETRY.bombCap,MATERIAL.metal,.05);
    part(root,'Armed light',GEOMETRY.lamp,glow,.085).scale.setScalar(2);
    // The ring is the only variable geometry: drawRange shows remaining fuse.
    const fuseGeometry = GEOMETRY.bombRing.clone(); fuseGeometry.userData.shared = false;
    const ring = part(root,'Fuse countdown',fuseGeometry,glow,.056); ring.rotation.x = -Math.PI/2;
    root.userData.abilityVisual = {kind,glow,ring,age:0};
  } else {
    part(root,'Grenade body',GEOMETRY[kind],MATERIAL[kind]);
    if (kind === 'frag') {
      for (const y of [-.033,0,.033]) {
        const band = part(root,'Fragmentation band',GEOMETRY.band,MATERIAL.dark,y);
        band.rotation.x = Math.PI/2; if (y) band.scale.setScalar(.88);
      }
    } else part(root,'Smoke identification band',GEOMETRY.smokeBand,glow,.015);
    part(root,'Fuse cap',GEOMETRY.cap,MATERIAL.dark,.07);
    const lever = part(root,'Safety lever',GEOMETRY.lever,MATERIAL.metal,.04);
    lever.position.x = .045; lever.rotation.z = .35;
    part(root,'Armed light',GEOMETRY.lamp,glow,.084);
    root.userData.abilityVisual = {kind,glow,age:0};
  }
  return root;
}

export function updateGrenadeIndicator(root, dt, remaining = null, duration = null) {
  const visual = root.userData.abilityVisual; if (!visual) return;
  visual.age += Math.max(0, dt);
  const urgent = Number.isFinite(remaining) && remaining < .75;
  visual.glow.opacity = .65 + .35 * (.5 + .5 * Math.sin(visual.age * (urgent ? 26 : 8)));
  if (visual.ring && Number.isFinite(remaining)) {
    const fraction = THREE.MathUtils.clamp(remaining / (duration || 3), 0, 1);
    visual.ring.geometry.setDrawRange(0, Math.ceil(32 * fraction) * 6);
  }
}

export function createGrenadeTrail(scene, point, kind) {
  const positions = new Float32Array(10 * 3);
  for (let i=0;i<10;i++) positions.set([point.x,point.y,point.z],i*3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.Line(geometry,new THREE.LineBasicMaterial({color:COLORS[kind],transparent:true,opacity:.28,depthWrite:false}));
  line.name = 'Short grenade flight trace'; line.frustumCulled = false; scene.add(line);
  return {line,positions,elapsed:0};
}

export function updateGrenadeTrail(trail, point, speed, dt) {
  trail.elapsed += dt;
  if (trail.elapsed < .035) return;
  trail.elapsed %= .035;
  const p = trail.positions; p.copyWithin(0,3); p[27]=point.x;p[28]=point.y;p[29]=point.z;
  // Keep only the last 1.3 metres; it reads as a thrown object, never a laser.
  for (let i=0;i<27;i+=3) {
    const dx=p[i]-point.x,dy=p[i+1]-point.y,dz=p[i+2]-point.z;
    const length=Math.hypot(dx,dy,dz);
    if (length>1.3) { const k=1.3/length;p[i]=point.x+dx*k;p[i+1]=point.y+dy*k;p[i+2]=point.z+dz*k; }
  }
  trail.line.material.opacity = Math.min(.28,speed*.08);
  trail.line.geometry.attributes.position.needsUpdate = true;
}

export function createImpulseWave(point, radius = 6) {
  const mesh = new THREE.Group(); mesh.name='Impulse shockwave';mesh.position.copy(point);
  const ring = part(mesh,'Impulse ring',GEOMETRY.wave,fadeMaterial(0x64dcff,.65));ring.rotation.x=-Math.PI/2;
  const shell = part(mesh,'Impulse pressure shell',GEOMETRY.shell,fadeMaterial(0x9feaff,.1));
  mesh.scale.setScalar(.12);
  return {mesh,ring,shell,age:0,radius,life:.48};
}
export function updateImpulseWave(wave,dt) {
  wave.age+=dt; const t=Math.min(1,wave.age/wave.life);
  wave.mesh.scale.setScalar(.12+(wave.radius-.12)*(1-(1-t)**2));
  wave.ring.material.opacity=.65*(1-t)**2;wave.shell.material.opacity=.1*(1-t)**2;
  return t>=1;
}

export function createSmokeCloud(point, radius = 5, life = 8) {
  const mesh = new THREE.Group();mesh.name='Smoke screen';mesh.position.copy(point);
  // One dense central sphere and six soft lobes, all bounded by the actual
  // blocking volume. Deterministic shape is identical for every viewer.
  const material = fadeMaterial(0xb8c0c2,.72);
  part(mesh,'Smoke core',GEOMETRY.smokeCloud,material).scale.setScalar(radius*.8);
  for (let i=0;i<6;i++) {
    const angle=i*Math.PI/3;
    const lobe=part(mesh,'Smoke edge',GEOMETRY.smokeCloud,material);
    lobe.position.set(Math.cos(angle)*radius*.38,Math.sin(i*2.3)*radius*.10,Math.sin(angle)*radius*.38);
    lobe.scale.setScalar(radius*.56);lobe.rotation.set(i*.4,i*.8,0);
  }
  mesh.scale.setScalar(.3);
  return {mesh,material,t:0,life,radius};
}
export function updateSmokeCloud(smoke,dt) {
  smoke.t+=dt;
  // Fast deployment and a short readable dissolve keep the visible cover close
  // to the authoritative eight-second blocking window.
  const deploy=THREE.MathUtils.smoothstep(smoke.t,0,.45);
  const expiry=THREE.MathUtils.smoothstep(smoke.t,smoke.life-.65,smoke.life);
  smoke.mesh.scale.setScalar(.3+.7*deploy);
  smoke.material.opacity=(.3+.46*deploy)*(1-expiry);
  return smoke.t>=smoke.life;
}

export function disposeAbilityObject(scene,root) {
  if (!root) return; scene.remove(root);
  // Avoid duplicate material disposal for a model's several identification bands.
  const materials=new Set(),geometries=new Set();
  root.traverse(object=>{
    if (object.geometry && !object.geometry.userData.shared) geometries.add(object.geometry);
    if (object.material) for (const material of Array.isArray(object.material)?object.material:[object.material])
      if (!material.userData.shared) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

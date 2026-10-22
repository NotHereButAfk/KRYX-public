import assert from 'node:assert/strict';
import { readFileSync,mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const buffer=readFileSync(new URL('../public/zombie-roster.glb',import.meta.url));
const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString());
const models=gltf.nodes.filter(n=>Number.isInteger(n.extras?.variantId));
assert.equal(models.length,20);
assert.equal(new Set(models.map(n=>n.extras.variantId)).size,20);
for(const model of models){
  const all=[];const visit=n=>{all.push(n);for(const i of n.children||[])visit(gltf.nodes[i]);};visit(model);
  for(const name of ['spineGroup','headGroup','L_shoulder','R_shoulder','L_elbow','R_elbow','L_wrist','R_wrist','L_hip','R_hip','L_knee','R_knee','L_ankle','R_ankle']){
    assert(all.some(n=>n.extras?.rigName===name),`${model.name} missing ${name}`);
  }
  assert(all.filter(n=>n.mesh!=null).length<64,`${model.name} exceeds body draw budget`);
}
let server,browser;
try {
  server=await createServer({server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
  await server.listen();
  browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/zombie-review',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0;background:#101820"><script type="module">window.ready=true;</script></body></html>'}));
  await page.goto(server.resolvedUrls.local[0]+'zombie-review');
  const result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {preloadZombieModel}=await import('/src/entities/Zombie.js');
    const {ZombieAvatar}=await import('/src/entities/ZombieAvatar.js');
    const {ZOMBIE_ROSTER}=await import('/src/entities/ZombieRoster.js');
    const {preloadWeaponModels,onWeaponModelsReady}=await import('/src/weapons/WeaponModels.js');
    await preloadZombieModel();
    await new Promise(resolve=>{onWeaponModelsReady(resolve);preloadWeaponModels();});
    const scene=new THREE.Scene();scene.background=new THREE.Color('#111d26');
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1600,1000);document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(40,1.6,.1,100);camera.position.set(7,8,17);camera.lookAt(0,0,-4.2);
    scene.add(new THREE.HemisphereLight(0xc5e5ff,0x48402c,2));
    const light=new THREE.DirectionalLight(0xffedcb,2.1);light.position.set(3,7,8);scene.add(light);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x192e3b,roughness:.8}));floor.rotation.x=-Math.PI/2;floor.position.y=-.03;scene.add(floor);
    const bodies=ZOMBIE_ROSTER.map(z=>{
      const a=new ZombieAvatar(scene,z.id,z.type);a.setWeapon(z.type==='gunner'?'m4':'sword');
      const position=new THREE.Vector3((z.id%5-2)*1.8,0,-Math.floor(z.id/5)*2.7);
      for(let f=0;f<30;f++)a.update(1/60,{position:position.clone().add(new THREE.Vector3(0,0,(f-29)*.015)),yaw:Math.PI,grounded:true,alive:true,swing:1});
      return a;
    });
    renderer.render(scene,camera);
    const output=bodies.map(a=>({variant:a.variant,loaded:!!a.rig?.authored,meshes:0}));
    bodies.forEach((a,i)=>a.group.traverse(o=>{if(o.isMesh)output[i].meshes++;}));
    window.probe={scene,camera,renderer,bodies,THREE};
    return output;
  });
  assert(result.every(r=>r.loaded),'one or more variants fell back to an old/procedural body');
  mkdirSync('artifacts/zombies',{recursive:true});
  await page.screenshot({path:'artifacts/zombies/in-game-roster.png'});
  const animation=await page.evaluate(()=>{
    const {bodies,renderer,scene,camera,THREE}=window.probe;
    let changed=0,disposedGeometry=0;
    for(const a of bodies){
      a.group.traverse(o=>{if(o.isMesh)o.geometry.addEventListener('dispose',()=>disposedGeometry++);});
      const before=a.rig.legs.left.hip.rotation.x;
      for(let f=0;f<20;f++)a.update(1/60,{position:a.group.position.clone().add(new THREE.Vector3(0,0,.035)),yaw:Math.PI,grounded:true,alive:true,swing:.3});
      if(Math.abs(before-a.rig.legs.left.hip.rotation.x)>.01)changed++;
    }
    for(let f=0;f<60;f++)bodies[0].update(1/60,{position:bodies[0].group.position,yaw:Math.PI,alive:false});
    const died=!bodies[0].rig.root.visible;
    bodies[0].dispose();renderer.render(scene,camera);
    return {changed,died,disposedGeometry};
  });
  assert.equal(animation.changed,20,'some zombie rigs are frozen');
  assert(animation.died,'death animation did not finish');
  assert.equal(animation.disposedGeometry,0,'one zombie destroyed another zombie’s shared geometry');
  assert.deepEqual(errors,[]);
  console.log(`Zombie models passed: 20 Blender variants rendered, walking/attack/death animation, shared geometry retained. ${buffer.length} bytes total.`);
} finally {await browser?.close();await server?.close();}

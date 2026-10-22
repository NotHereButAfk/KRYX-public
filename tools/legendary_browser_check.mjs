import {createServer} from 'vite';import {chromium} from 'playwright';import fs from 'node:fs';
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage();const errors=[];page.on('console',m=>{if(m.type()==='error'&&/shader|VALIDATE|compile/i.test(m.text()))errors.push(m.text());});await page.goto(server.resolvedUrls.local[0]);
const result=await page.evaluate(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');const {WEAPON_SKINS}=await import('/src/weapons/WeaponSkins.js');const {applyWeaponSkin,animateWeaponSkin}=await import('/src/weapons/WeaponSkins.js');const {triggerLegendaryShot,triggerLegendaryKill}=await import('/src/weapons/LegendaryEffects.js');const {warmWeaponThumbs}=await import('/src/ui/WeaponThumbnails.js');await new Promise(r=>warmWeaponThumbs(r));const {buildWeaponModel}=await import('/src/weapons/WeaponModels.js');const {getWeapon}=await import('/src/weapons/weaponDefs.js');const {AudioManager}=await import('/src/core/AudioManager.js');
 const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(400,300);const scene=new THREE.Scene();scene.background=new THREE.Color('#101520');scene.add(new THREE.AmbientLight(0xffffff,2));const camera=new THREE.PerspectiveCamera(40,4/3,.01,100);camera.position.set(1,.4,.8);camera.lookAt(0,0,0);const results=[];
 for(const skin of WEAPON_SKINS.filter(s=>s.rarity==='legendary')) {
  const {group}=buildWeaponModel(getWeapon(skin.weaponId));const box=new THREE.Box3().setFromObject(group),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());const scale=.8/Math.max(size.x,size.y,size.z);group.scale.setScalar(scale);group.position.copy(center).multiplyScalar(-scale);scene.add(group);applyWeaponSkin(group,skin);
  const frames=[];for(const t of [0,.7]){animateWeaponSkin(group,skin,t);renderer.render(scene,camera);frames.push(renderer.domElement.toDataURL());}
  if(frames[0]===frames[1])throw Error('No animation '+skin.id);
  triggerLegendaryShot(group,.7);animateWeaponSkin(group,skin,.7);renderer.render(scene,camera);if(frames[1]===renderer.domElement.toDataURL())throw Error('No shot response '+skin.id);
  animateWeaponSkin(group,skin,2);renderer.render(scene,camera);const beforeKill=renderer.domElement.toDataURL();
  triggerLegendaryKill(group,2);animateWeaponSkin(group,skin,2);renderer.render(scene,camera);if(beforeKill===renderer.domElement.toDataURL())throw Error('No kill response '+skin.id);
  results.push({name:skin.name,image:renderer.domElement.toDataURL()});scene.remove(group);
 }
 const ctx=new OfflineAudioContext(1,24000,24000);const audio=Object.create(AudioManager.prototype);audio.ctx=ctx;audio.out=ctx.destination;audio.master=ctx.destination;
 if(!audio.playSkinShot(WEAPON_SKINS.find(s=>s.rarity==='legendary').shootSound))throw Error('Audio dispatch missing');const rendered=await ctx.startRendering();if(!rendered.getChannelData(0).some(x=>Math.abs(x)>.01))throw Error('Silent sound');
 return results;
});if(errors.length)throw Error(errors.join('\n'));fs.mkdirSync('../../outputs/legendary-effects',{recursive:true});fs.writeFileSync('../../outputs/legendary-effects/shot.png',Buffer.from(result[0].image.split(',')[1],'base64'));console.log('25 real gun shaders compile, visibly animate and react to shots; actual WebAudio dispatch renders sound.');
}finally{await browser.close();await server.close();}process.exit(0);


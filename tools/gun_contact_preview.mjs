import {createServer} from 'vite';import {chromium} from 'playwright';import fs from 'node:fs';
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1800,height:1800}});await page.goto(server.resolvedUrls.local[0]);
const result=await page.evaluate(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');const {warmWeaponThumbs}=await import('/src/ui/WeaponThumbnails.js');await new Promise(r=>warmWeaponThumbs(r));const {buildWeaponModel}=await import('/src/weapons/WeaponModels.js');const {WEAPONS}=await import('/src/weapons/weaponDefs.js');const {weaponHandPose}=await import('/src/weapons/WeaponHandPoses.js');
 const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(600,280);const scene=new THREE.Scene();scene.background=new THREE.Color('#18202b');scene.add(new THREE.AmbientLight(0xffffff,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,2,1);scene.add(light);const camera=new THREE.OrthographicCamera(-.7,.7,.3267,-.3267,.01,10);camera.position.set(3,0,0);camera.lookAt(0,0,0);
 const results=[];
 for(const def of WEAPONS.filter(w=>w.kind!=='melee')){
 const {group}=buildWeaponModel(def);scene.add(group);const overlay=new THREE.Group();scene.add(overlay);
 for(let z=-.6;z<=.61;z+=.1){const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(.3,-.3,z),new THREE.Vector3(.3,.3,z)]);overlay.add(new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x405060,transparent:true,opacity:.5})));}
 for(let y=-.3;y<=.31;y+=.1){overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(.3,y,-.65),new THREE.Vector3(.3,y,.65)]),new THREE.LineBasicMaterial({color:0x405060,transparent:true,opacity:.5})));}
 const pose=weaponHandPose(group);for(const [key,color]of [['trigger',0xff3366],['support',0x33ff99]]){const ball=new THREE.Mesh(new THREE.SphereGeometry(.012),new THREE.MeshBasicMaterial({color,depthTest:false}));ball.position.fromArray(pose[key]);overlay.add(ball);}
 renderer.render(scene,camera);results.push({id:def.id,image:renderer.domElement.toDataURL(),pose});scene.remove(group,overlay);
 }return results;
});fs.mkdirSync('../../outputs/gun-fit',{recursive:true});for(const r of result)fs.writeFileSync('../../outputs/gun-fit/'+r.id+'-side.png',Buffer.from(r.image.split(',')[1],'base64'));
await page.evaluate(results=>{document.body.innerHTML='';const root=document.createElement('div');root.style.cssText='position:fixed;inset:0;background:#18202b;z-index:999999;display:grid;grid-template-columns:repeat(3,1fr);font:16px sans-serif;color:white';document.body.append(root);for(const r of results){const d=document.createElement('div');d.innerHTML='<div>'+r.id+' | red trigger · green support | 0.1m grid</div><img style="width:100%" src="'+r.image+'">';root.append(d)}},result);await page.screenshot({path:'../../outputs/gun-fit/contacts.png'});console.log('17 weapon side views captured');
}finally{await browser.close();await server.close();}process.exit(0);

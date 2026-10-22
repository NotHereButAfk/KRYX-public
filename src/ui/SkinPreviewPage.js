import { applyPreviewDance } from './PreviewDance.js';
import { buildPreviewArena } from './PreviewArena.js';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Avatar } from '../player/Avatar.js';
import { preloadEvCharacter } from '../player/EvCharacter.js';
import { ARMOR_SKINS } from '../player/ArmorSkins.js';
import { getSkin } from '../player/skins.js';
import { preloadAuthoredSkin } from '../player/AuthoredSkins.js';
import { preloadWeaponModels, onWeaponModelsReady } from '../weapons/WeaponModels.js';
import { ALL_WEAPON_SKINS, applyWeaponSkin, animateWeaponSkin } from '../weapons/WeaponSkins.js';
import { preloadAuthoredWeaponSkin } from '../weapons/AuthoredWeaponSkins.js';
const $ = id => document.getElementById(id);
const renderer = new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const scene=new T.Scene();scene.background=new T.Color('#10151e');
const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;pmrem.dispose();
scene.add(new T.HemisphereLight(0xffffff,0x33202a,.6));const light=new T.DirectionalLight(0xffffff,1.4);light.position.set(3,8,4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-10;light.shadow.camera.right=10;light.shadow.camera.top=10;light.shadow.camera.bottom=-10;light.shadow.bias=-.001;scene.add(light);
buildPreviewArena(scene);
const camera=new T.PerspectiveCamera(38,1,.01,100),orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.minDistance=1;orbit.maxDistance=16;orbit.maxPolarAngle=Math.PI*.49;
orbit.target.set(0,.9,0);
function reset(){camera.position.copy(orbit.target).add(new T.Vector3(4.5,2.8,-6.5));orbit.update()}reset();$('reset').onclick=reset; $('toggle').onclick=()=>{const closed=document.querySelector('aside').classList.toggle('closed');$('toggle').textContent=closed?'Open Controls':'Close Controls'};
const defaults={m4:'Auto Rifle',magnum:'Hand Cannon',battlerifle:'Burst Rifle',energyshotgun:'Sweeper',plasmarifle:'Laser Rifle',rpg:'Rocket Launcher',concussion:'Grenade Launcher',uzi:'Mini SMG',levershotgun:'Shotgun',boltsniper:'Sniper',sword:'Sword'};
function option(select,id,name){select.add(new Option(name,id))}
option($('character'),'default','Default');for(const s of [...ARMOR_SKINS].sort((a,b)=>a.name.localeCompare(b.name)))option($('character'),s.id,s.name);
for(const [id,name]of Object.entries(defaults))option($('weapon'),id,name+' · Default');for(const s of [...ALL_WEAPON_SKINS].sort((a,b)=>a.name.localeCompare(b.name)))option($('weapon'),s.id,s.name);
$('character').value='remake_229';
let avatar,weaponSkin=null,revision=0,jump=0,attack=0,time=0,travel=0;
async function select(){const ticket=++revision;$('status').textContent='Loading selected models…';try{
 const finish=ARMOR_SKINS.find(s=>s.id===$('character').value);const skin=ALL_WEAPON_SKINS.find(s=>s.id===$('weapon').value);
 await Promise.all([preloadAuthoredSkin(finish),skin?.model?preloadAuthoredWeaponSkin(skin):Promise.resolve()]);if(ticket!==revision)return;
 avatar?.dispose();avatar=new Avatar(scene,{skin:getSkin('default'),weaponId:skin?.weaponId||$('weapon').value});avatar.group.userData.applyFinish(getSkin('default'),finish);await avatar.group.userData.skinReady;if(ticket!==revision)return;
 weaponSkin=skin;applyWeaponSkin(avatar.weapon,skin);$('status').textContent=(finish?.name||'Default')+' · '+(finish?.rarity||'starter')+' — '+(skin?.name||defaults[$('weapon').value]);
 }catch(error){$('status').textContent='Could not load model: '+error.message}}
$('character').onchange=select;$('weapon').onchange=select;$('jump').onclick=()=>{jump=.85;avatar?.hop()};$('fire').onclick=()=>{attack=.45;avatar?.fire()};
for (const mode of ['walk','run']) $(mode).onchange=()=>{
  if ($(mode).checked) {$(mode==='walk'?'run':'walk').checked=false;$('dance').checked=false;}
  $('motion').value=$('walk').checked?'walk':'idle';
};
$('motion').onchange=()=>{$('walk').checked=$('motion').value==='walk';$('run').checked=false;$('dance').checked=false};
$('dance').onchange=()=>{if($('dance').checked){$('walk').checked=false;$('run').checked=false;$('motion').value='idle'}};
const clock=new T.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),.05);time+=dt;jump=Math.max(0,jump-dt);attack=Math.max(0,attack-dt);
 if(avatar){const dancing=$('dance').checked;const motion=$('run').checked?'run':$('motion').value,speed=dancing?0:motion==='idle'?0:$('crouch').checked?1.6:motion==='run'?9:3;const p=jump>0?1-jump/.85:0;travel+=speed*dt;
 avatar.update(dt,{position:new T.Vector3(0,jump?Math.sin(p*Math.PI)*.8:0,-travel),yaw:0,pitch:$('look').checked?Math.sin(time)*.45:0,speed,sprint:motion==='run'&&!$('crouch').checked,crouch:!dancing&&$('crouch').checked,grounded:jump===0,vy:jump?Math.cos(p*Math.PI)*3:0,alive:true,firing:attack>0,swing:attack>0?1-attack/.45:1});

 avatar.group.position.z=0;
 if(dancing){applyPreviewDance(avatar.group,time);avatar.weapon.visible=false}else{avatar.weapon.visible=true;avatar.group.rotation.z=0}
 animateWeaponSkin(avatar.weapon,weaponSkin,time)}orbit.autoRotate=$('rotate').checked;orbit.update();renderer.render(scene,camera)});
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
try{await Promise.all([preloadEvCharacter(),new Promise(resolve=>{onWeaponModelsReady(resolve);preloadWeaponModels()})]);await select()}catch(e){$('status').textContent=e.message}

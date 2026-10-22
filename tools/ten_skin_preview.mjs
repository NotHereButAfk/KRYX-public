import fs from 'node:fs';
import {createServer} from 'vite';import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0},optimizeDeps:{noDiscovery:true,include:[]}});await server.listen();const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.__game?.previewCharacter?.userData.isEvCharacter,null,{timeout:120000});
const thumbnails=await page.evaluate(async()=>{
const thumbnails={};
const {ArmorPreviewRenderer}=await import('/src/ui/ArmorPreviewRenderer.js');const {ARMOR_SKINS}=await import('/src/player/ArmorSkins.js');const {Shop}=await import('/src/core/Shop.js');
const gallery=document.createElement('div');gallery.style.cssText='position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px;background:#080e17;color:white;font:16px sans-serif';document.body.append(gallery);
for(const skin of ARMOR_SKINS.filter(s=>s.collection==='Frontier Ten')){
if(Shop.isOwned(skin.id))throw Error('Unpurchased skin unlocked: '+skin.id);
const card=document.createElement('div'),canvas=document.createElement('canvas');canvas.width=260;canvas.height=365;canvas.style.cssText='width:100%;height:365px';card.append(canvas);const label=document.createElement('div');label.textContent=skin.name;label.style.cssText='text-align:center;padding:8px';card.append(label);gallery.append(card);
const preview=new ArmorPreviewRenderer(canvas);preview.loadArmor(null,'vanguard',skin);preview._group.rotation.y=preview._baseYaw+.3;preview._renderer.render(preview._scene,preview._camera);
thumbnails[skin.id]=canvas.toDataURL("image/png");
}
return thumbnails;
});fs.mkdirSync("public/assets/character-skins",{recursive:true});for(const [id,data] of Object.entries(thumbnails))fs.writeFileSync(`public/assets/character-skins/${id}.png`,Buffer.from(data.split(",")[1],"base64"));fs.mkdirSync('../../outputs/ten-player-skins',{recursive:true});await page.screenshot({path:'../../outputs/ten-player-skins/collection.png'});console.log('Ten skins previewed and verified available.');
}finally{await browser.close();await server.close();}

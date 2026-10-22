import {createServer} from 'vite';import {chromium} from 'playwright';import fs from 'node:fs';
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1500,height:1200}});await page.goto(server.resolvedUrls.local[0]);
await page.evaluate(async()=>{
 const {warmWeaponThumbs,renderWeaponSkinned}=await import('/src/ui/WeaponThumbnails.js');await new Promise(r=>warmWeaponThumbs(r));
 const {WEAPON_SKINS}=await import('/src/weapons/WeaponSkins.js');const {getWeapon}=await import('/src/weapons/weaponDefs.js');
 const root=document.createElement('div');root.style.cssText='position:fixed;inset:0;z-index:99999;background:#111824;color:white;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:12px;font:14px sans-serif';document.body.append(root);
 for(const s of WEAPON_SKINS.filter(s=>s.rarity==='legendary')){const card=document.createElement('div');const img=new Image();img.src=renderWeaponSkinned(getWeapon(s.weaponId),s);if(!img.src.startsWith('data:image'))throw Error('render failed');await img.decode();img.style.cssText='width:100%;height:165px;object-fit:contain';card.append(img);const name=document.createElement('div');name.textContent=getWeapon(s.weaponId).name+' / '+s.name;card.append(name);root.append(card);}
});fs.mkdirSync('../../outputs/legendary-gun-skins',{recursive:true});await page.screenshot({path:'../../outputs/legendary-gun-skins/collection.png'});console.log('25 Legendary weapon finishes rendered');
}finally{await browser.close();await server.close();}process.exit(0);

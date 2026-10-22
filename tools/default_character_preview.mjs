import fs from 'node:fs';
import {createServer} from 'vite';import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0},optimizeDeps:{noDiscovery:true,include:[]}});await server.listen();const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1400,height:900}});await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.__game?.previewCharacter?.userData.isEvCharacter,null,{timeout:120000});
const thumbnails=await page.evaluate(async()=>{
const thumbnails={};
const {ArmorPreviewRenderer}=await import('/src/ui/ArmorPreviewRenderer.js');

const canvas=document.createElement('canvas');canvas.width=260;canvas.height=365;document.body.append(canvas);
const preview=new ArmorPreviewRenderer(canvas);preview.loadArmor(null,'vanguard',null);preview._group.rotation.y += Math.PI;preview._renderer.render(preview._scene,preview._camera);thumbnails.default=canvas.toDataURL('image/png');
return thumbnails;
});fs.mkdirSync("public/assets/character-skins",{recursive:true});for(const [id,data] of Object.entries(thumbnails))fs.writeFileSync(`public/assets/character-skins/${id}.png`,Buffer.from(data.split(",")[1],"base64"));console.log('Default EV character thumbnail generated.');
}finally{await browser.close();await server.close();}

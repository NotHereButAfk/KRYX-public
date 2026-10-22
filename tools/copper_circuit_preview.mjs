import fs from 'node:fs';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--no-sandbox','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:810}});
  await page.goto(server.resolvedUrls.local[0]+'src/world/MapRegistry.js');
  await page.evaluate(async()=>{
    document.body.innerHTML='';document.body.style.margin='0';
    const T=await import('/node_modules/three/build/three.module.js');
    const {World}=await import('/src/world/World.js');const world=new World('copper-circuit');await world.ready;
    const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1440,810);renderer.setPixelRatio(1);
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    document.body.appendChild(renderer.domElement);
    const camera=new T.PerspectiveCamera(70,1440/810,.05,400);
    window.preview={world,renderer,camera};
  });
  fs.mkdirSync('../../outputs/copper-circuit',{recursive:true});
  for(const [name,eye,target]of [['plaza',[6,2,19],[-8,5,-12]],['bridge',[-10,5.7,25],[14,5,-18]],['overview',[56,55,59],[0,0,0]]]){
    await page.evaluate(({eye,target})=>{const{camera,renderer,world}=window.preview;camera.position.set(...eye);camera.lookAt(...target);renderer.render(world.scene,camera)}, {eye,target});
    await page.screenshot({path:`../../outputs/copper-circuit/${name}.png`});
    if(name==='plaza')await page.screenshot({path:'public/images/maps/copper-circuit.jpg',type:'jpeg',quality:90});
  }
  console.log('Copper Circuit ground, bridge and overview rendered');
}finally{await browser.close();await server.close();}
process.exit(0);

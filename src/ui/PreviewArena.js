import * as T from 'three';

// Original preview arena, authored for KRYX. No downloaded map geometry.
export function buildPreviewArena(scene) {
  const root = new T.Group(); root.name = 'KRYX Ember Court';
  const dark = new T.MeshLambertMaterial({color:0x251d23});
  const trim = new T.MeshLambertMaterial({color:0x45313b});
  const red = new T.MeshLambertMaterial({color:0x881727});
  const glow = new T.MeshLambertMaterial({color:0xff1635,emissive:0xff1028,emissiveIntensity:.7});
  function box(w,h,d,x,y,z,mat=dark,angle=0){const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.rotation.y=angle;m.receiveShadow=true;m.castShadow=true;root.add(m);return m}
  box(48,.3,48,0,-.17,0,dark);
  box(7,.025,38,0,-.006,0,red);
  for(const side of [-1,1]){
    box(.10,.03,38,side*3.65,.01,0,glow);
    box(18,.02,5,side*12,.006,0,red);
    for(let i=-2;i<=2;i++){
      const z=i*8;
      box(1.6,9,1.8,side*10,4.5,z,trim);
      box(2.3,.4,2.5,side*10,.2,z,trim);
      box(.06,4,.4,side*9.16,3,z,glow);
      box(.7,2,.65,side*8.9,6.2,z,dark,side*.3);
    }
    box(1,11,45,side*16,5.5,0,dark);
    box(30,11,1,0,5.5,side*22,dark);
    box(25,.5,1.4,0,7.2,side*20,trim);
    box(10,.16,1.5,0,.09,side*16,trim);
    for(let i=0;i<4;i++)box(9-i,.22,1.2,0,.11+i*.22,side*(17+i),trim);
  }
  for(let i=0;i<8;i++){const a=i*Math.PI/4;box(1.8,.05,.6,Math.sin(a)*6,.035,Math.cos(a)*6,glow,-a)}
  for(const material of [dark,trim,red,glow])material.envMapIntensity=.08;
  scene.add(root);scene.background=new T.Color(0x21171d);scene.fog=new T.Fog(0x21171d,15,48);
  return root;
}

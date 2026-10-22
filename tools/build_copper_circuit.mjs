// Original, hand-laid arena. Bake once to the shared client/server map format.
import fs from 'node:fs';
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {parseEvMap, buildEvMapScene} from '../src/world/EvMapLoader.js';

const palette = [0xb96c46,0x556e69,0x202d34,0xe9cf8a,0xd28c56,0x00dddc,0x394a54,0xf4e6bc];
const buckets = new Map();
function add(g, material, collision=true) {
  // Author in gameplay coordinates, then convert to the container's mirrored X.
  g.scale(-1,1,1);
  if (!g.index) g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));
  const a=g.index.array; for(let i=0;i<a.length;i+=3)[a[i+1],a[i+2]]=[a[i+2],a[i+1]];
  g.deleteAttribute('uv'); g.computeVertexNormals();
  const key=`${material}:${collision}`;
  if(!buckets.has(key))buckets.set(key,[]); buckets.get(key).push(g);
}
function box(x,y,z,w,h,d,m=0,c=true,ry=0) {
  const g=new T.BoxGeometry(w,h,d);g.rotateY(ry);g.translate(x,y,z);add(g,m,c);
}
function cylinder(x,y,z,r,h,m=0,c=true,n=8){const g=new T.CylinderGeometry(r,r,h,n);g.translate(x,y,z);add(g,m,c);}
function strip(x,y,z,w,d){box(x,y,z,w,.055,d,5,false);}
function tower(x,z,w,d,h) {
  box(x,h/2,z,w,h,d,0);
  box(x,2,z,w+.12,4,d+.12,1);
  box(x,4.08,z,w+.5,.28,d+.5,2);
  box(x,h-.3,z,w+.65,.6,d+.65,2);
  box(x,h+.4,z,w*.65,.8,d*.65,6);
  // Panel seams, dark vertical ribs, inset cyan ground guides and upper vents.
  for(const side of [-1,1]){
    strip(x,.22,z+side*(d/2+.07),w+.2,.07);
    strip(x+side*(w/2+.07),.22,z,.07,d+.2);
    for(const offset of [-.32,.32]){
      box(x+offset*w,h*.53,z+side*(d/2+.16),.22,h*.77,.28,2,false);
      box(x+side*(w/2+.16),h*.53,z+offset*d,.28,h*.77,.22,2,false);
    }
    for(let y=6;y<h-2;y+=2.8){
      box(x,y,z+side*(d/2+.04),w,.045,.07,2,false);
      box(x+side*(w/2+.04),y,z,.07,.045,d,2,false);
    }
    for(let i=0;i<4;i++) box(x+(i-1.5)*.8,h-2,z+side*(d/2+.18),.44,1,.32,2,false);
    box(x,2,z+side*(d/2+.08),1.8,2.9,.08,6,false);
    box(x-.95,2,z+side*(d/2+.14),.06,3,.07,5,false);
    box(x+.95,2,z+side*(d/2+.14),.06,3,.07,5,false);
    strip(x,3.52,z+side*(d/2+.14),1.96,.07);
  }
}

// Broad cross lanes and a continuous outer loop. Ground is a single closed slab.
box(0,-.5,0,84,1,84,1);
box(0,.015,0,17,.03,78,3,false);box(0,.032,0,78,.03,14,3,false);
for(const side of [-1,1]){
  box(side*42,4,0,2,9,86,1);box(0,4,side*42,86,9,2,1);
  strip(side*40.94,.3,0,.06,82);strip(0,.3,side*40.94,82,.06);
  box(side*31,.018,0,7,.035,78,4,false);box(0,.021,side*31,78,.035,7,4,false);
  for(let q=-36;q<=36;q+=6){
    box(q,.06,side*8,3.8,.08,.9,2,false);box(side*9,.06,q,.9,.08,3.8,2,false);
    box(side*41,6,q,.28,.25,3.5,2,false);box(q,6,side*41,3.5,.25,.28,2,false);
  }
}
for(const [x,z,w,d,h] of [
  [-18,-18,11,12,18],[18,18,11,12,18],[-18,18,11,10,22],[18,-18,11,10,22],
  [-35,-17,8,11,13],[35,17,8,11,13],[-17,35,11,8,15],[17,-35,11,8,15]
])tower(x,z,w,d,h);

// Reactor island: octagonal plinth, faceted core, luminous horizontal rings.
cylinder(0,.22,0,5.4,.44,2);cylinder(0,.46,0,5.1,.05,5,false);
cylinder(0,.68,0,4.85,.4,4);cylinder(0,2.3,0,2.8,3.2,6);
cylinder(0,3.95,0,3.05,.22,2);cylinder(0,4.15,0,2.9,.12,5,false);
for(let i=0;i<8;i++){
  const angle=i*Math.PI/4,x=Math.sin(angle)*2.83,z=Math.cos(angle)*2.83;
  box(x,2.3,z,.075,3.12,.075,5,false,angle);
}
for(const y of [1,2.3,3.55])cylinder(0,y,0,2.84,.06,5,false);

// Offset low cover gives each approach a break in its long sightline.
for(const [x,z,ry]of[[-5,-17,0],[5,17,0],[-17,5,Math.PI/2],[17,-5,Math.PI/2],[-32,4,0],[32,-4,0],[5,32,0],[-5,-32,0]]){
  box(x,.65,z,4,1.3,1.8,4,true,ry);
  box(x,1.34,z,4.18,.16,1.94,2,false,ry);
  box(x,.28,z,4.05,.055,1.85,5,false,ry);
}

// Two elevated crossing decks, each reached by a gentle 1:3 ramp.
function ramp(x,z,sign){
  const vertices=[-2,0,-6,2,0,-6,-2,0,6,2,0,6,-2,4,6,2,4,6];
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  g.setIndex([0,2,1,1,2,3,0,1,4,1,5,4,2,4,3,3,4,5,0,4,2,1,3,5]);
  for(let i=0;i<g.index.count;i+=3){const a=g.index.array;[a[i+1],a[i+2]]=[a[i+2],a[i+1]];}
  if(sign<0)g.rotateY(Math.PI);g.translate(x,0,z);add(g,3);
}
for(const sign of [-1,1]){
  const z=sign*25;
  box(0,3.8,z,24,.4,4,6);
  for(const x of [-10,10])box(x,1.8,z,.6,3.6,.6,2);
  strip(0,4.03,z+1.8,23.5,.08);strip(0,4.03,z-1.8,23.5,.08);
  ramp(sign*10,z-sign*8,sign);
  // Railings protect the exposed edge; open ends preserve traversal.
  for(const edge of [-1,1]){
    box(0,4.95,z+edge*2,15,.13,.13,2);
    for(const x of [-7,0,7])box(x,4.5,z+edge*2,.12,1,.12,2);
  }
}
// Skyline silhouettes and amber rooftop equipment outside the playable perimeter.
for(let i=0;i<9;i++){
  const x=(i-4)*13,h=17+(i*7%13);
  box(x,h/2,-52,8,h,7,i%2?0:6,false);
  box(52,h/2,x,7,h,8,i%2?6:0,false);
}

const spawns=[[-31,0,31,135],[31,0,-31,315],[-31,0,-31,225],[31,0,31,45],
  [-7,0,-36,180],[7,0,36,0],[-36,0,7,90],[36,0,-7,270],[-29,0,-5,90],[29,0,5,270],[-10,4,25,90],[10,4,-25,270]];
const markers=[[-29,1,19,524288],[29,1,-19,2097152],[0,5,25,1048576],[0,5,-25,8388608]];

class Writer {
  constructor(){this.chunks=[];}
  n(type,v){const b=Buffer.alloc({UInt8:1,UInt16LE:2,UInt32LE:4,FloatLE:4}[type]);b[`write${type}`](v);this.chunks.push(b);}
  u8(v){this.n('UInt8',v)} u16(v){this.n('UInt16LE',v)} u32(v){this.n('UInt32LE',v)} f(v){this.n('FloatLE',v)}
  vec(v){v.forEach(x=>this.f(x))} color(hex){const c=new T.Color(hex);this.u8(Math.round(c.r*255));this.u8(Math.round(c.g*255));this.u8(Math.round(c.b*255))}
  str(s){this.u8(s.length);this.chunks.push(Buffer.from(s));}
  packed(attr){this.u8(1);const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<attr.count;i++)for(let k=0;k<3;k++){const v=attr.array[i*3+k];lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v)}
    this.vec(lo);this.vec(hi);this.u16(attr.count);
    for(let i=0;i<attr.count;i++)for(let k=0;k<3;k++)this.u16(Math.round(65535*(attr.array[i*3+k]-lo[k])/(hi[k]-lo[k]||1)));
  }
}
const chunks=[...buckets].map(([key,gs])=>({key,geometry:mergeGeometries(gs)}));
const w=new Writer();w.u8(3);w.u8(128|64|32|8|4);w.u8(64);
w.u16(chunks.length);
for(const {geometry:g}of chunks){w.u8(1);w.packed(g.attributes.position);w.u16(1);w.u16(g.index.count);for(const i of g.index.array)w.u16(i);w.packed(g.attributes.normal);}
w.u16(0);w.u16(palette.length);
palette.forEach((c,i)=>{w.u8(0);w.u8(i===5?21:1);w.color(c);w.u8(255);if(i===5){w.color(c);w.f(.8)}});
const transform=()=>w.vec([0,0,0,0,0,0,1,1,1,1]);
w.u8(0);transform();w.u16(chunks.length);
chunks.forEach(({key},i)=>{const[m,c]=key.split(':');w.u8(c==='true'?7:3);transform();w.u16(0);w.str(`Copper_${i}`);w.u16(i);w.u16(1);w.u16(Number(m));});
w.u16(markers.length);for(const[x,y,z,kind]of markers){w.u8(1);w.vec([-x,y,z]);w.u32(kind)}
w.u16(spawns.length);for(const[x,y,z,yaw]of spawns){w.vec([-x,y+.03,z,270-((yaw+180)%360)]);w.u8(1)}
w.u16(0);w.vec([0,50,0]);w.vec([1,1,1]);w.u8(0);w.color(0x8edcff);w.color(0xbee9ff);w.color(0xffffff);w.color(0xffffff);w.f(1);
const bytes=Buffer.concat(w.chunks);const parsed=parseEvMap(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
if(parsed.bytesRead!==bytes.length)throw Error('Incomplete export');
buildEvMapScene(parsed);
fs.writeFileSync('public/maps/CopperCircuit.evmap',bytes);
console.log(`Copper Circuit: ${bytes.length} bytes, ${chunks.length} material batches, ${spawns.length} spawns`);

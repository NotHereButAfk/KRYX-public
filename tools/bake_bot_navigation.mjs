// Bake walkable, directed connections from the same collision queries as players.
// Run after changing map geometry; runtime routing never needs to rediscover walls.
import fs from 'node:fs';
import {createState} from '../src/sim/MoveSim.js';
import {navigationComponents} from '../server/navigation-graph.mjs';
import {createHash} from 'node:crypto';
process.env.KYX_BAKE_NAVIGATION = '1';
const {IMPORTED_ARENAS} = await import('../server/rookarena.mjs');
import {IMPORTED_MAPS} from '../src/world/MapRegistry.js';
import {SurvivalNavigation} from '../server/survival-navigation.mjs';
fs.mkdirSync('server/navigation',{recursive:true});
const selected = process.argv[2]?.split(',');
if (selected?.some(id => !IMPORTED_ARENAS.some(a => a.id === id))) throw new Error('Unknown map in navigation bake selection');
for(const arena of IMPORTED_ARENAS.filter(a=>!selected||selected.includes(a.id))){
 const nav=new SurvivalNavigation({arena},{navigationRadius:.48});const step=1;
 const points=[],edges=[],indices=new Map();const key=p=>`${Math.round(p[0]*100)},${Math.round(p[1]*4)},${Math.round(p[2]*100)}`;
 function add(p){const k=key(p);if(indices.has(k))return indices.get(k);const id=points.length;indices.set(k,id);points.push(p.map(v=>Math.round(v*1e6)/1e6));edges.push([]);return id;}
 for(const p of arena.spawns) {
   const initial=createState(...p), settled=arena.resolveState({...initial},{...initial});
   add([settled.px,settled.py,settled.pz]);
 }
 for(let i=0;i<points.length;i++){
 if(points.length>100000)throw Error(`${arena.id}: unexpected navigation size`);
 const p=points[i];
 for(const[dx,dz]of[[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]]){
 const to=[(Math.round(p[0]/step)+dx)*step,p[1],(Math.round(p[2]/step)+dz)*step];const next=nav.lane(p,to);if(!next)continue;const n=add(next);if(n!==i&&!edges[i].includes(n))edges[i].push(n);
 }
 if(i%2000===0)console.log(`${arena.id}: ${i}/${points.length} nodes`);
 }
 // Quantized node merging can change a destination's height slightly. Validate
 // the final stored endpoints, not just the pre-merge candidate.
 const runtimeNav=new SurvivalNavigation({arena},{navigationRadius:.46});
 for(let i=0;i<edges.length;i++) edges[i]=edges[i].filter(j=>[nav,runtimeNav].every(probe=>{const lane=probe.lane(points[i],points[j]);return lane&&Math.abs(lane[1]-points[j][1])<.3;}));
 // Pick well-connected destinations throughout the map, including upper floors.
 const sectors=new Map();for(let i=0;i<points.length;i++){
 if(edges[i].length<5)continue;const p=points[i],k=`${Math.floor(p[0]/20)},${Math.floor(p[1]/4)},${Math.floor(p[2]/20)}`;
 const old=sectors.get(k);if(old===undefined||edges[i].length>edges[old].length)sectors.set(k,i);
 }
 const def=IMPORTED_MAPS.find(m=>m.id===arena.id);const mapHash=createHash('sha256').update(fs.readFileSync('public/maps/'+def.fileName)).digest('hex');
 fs.writeFileSync(`server/navigation/${arena.id}.json`,JSON.stringify({version:1,mapHash,step,points,edges,components:navigationComponents(edges),landmarks:[...sectors.values()]}));
 console.log(`${arena.id}: baked ${points.length} nodes, ${edges.reduce((n,e)=>n+e.length,0)} directed edges, ${sectors.size} destinations`);
}

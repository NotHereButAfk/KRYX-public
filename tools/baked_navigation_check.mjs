import assert from 'node:assert/strict';
import {createState} from '../src/sim/MoveSim.js';
import {IMPORTED_ARENAS} from '../server/rookarena.mjs';
import {PatrolNavigation} from '../server/patrol-navigation.mjs';
import {navigationComponents} from '../server/navigation-graph.mjs';
assert.deepEqual(navigationComponents([[1],[0,2],[]]).map((c,i,a)=>c===a[0]),[true,true,false], 'one-way drops cannot become climbable shortcuts');
for(const arena of IMPORTED_ARENAS){
 const g=arena.navigation;assert(g,`${arena.id}: missing baked routes`);
 assert.equal(g.points.length,g.edges.length);assert.equal(g.points.length,g.components.length);
 for(let i=0;i<g.points.length;i++){assert(g.points[i].every(Number.isFinite));for(const j of g.edges[i])assert(Number.isInteger(j)&&j>=0&&j<g.points.length);}
 const nav=new PatrolNavigation({arena});let checks=0;
 // Sample real collision connections throughout every map, not just spawn pads.
 for(let i=0;i<g.points.length;i+=Math.max(1,Math.floor(g.points.length/100))){for(const j of g.edges[i]){const lane=nav.lane(g.points[i],g.points[j]);assert(lane&&Math.abs(lane[1]-g.points[j][1])<.3,`${arena.id}: invalid baked edge ${i}->${j}`);checks++;}}
 for(let i=0;i<arena.spawns.length;i++){
 const initial=createState(...arena.spawns[i]),settled=arena.resolveState({...initial},{...initial});
 const from=[settled.px,settled.py,settled.pz],goals=nav.reachableGoals(from);assert(goals.length>8,`${arena.id}: spawn ${i} cannot reach the map`);
 const goal=goals.filter(p=>Math.hypot(p[0]-from[0],p[2]-from[2])>20)[i%8];assert(goal);
 nav.request(i,from,goal);let result;
 const lane=nav.lane;nav.lane=()=>{throw Error('baked A* must not perform runtime collision sampling');};
 for(let tick=0;tick<200&&!result;tick++){nav.update(i*200+tick);result=nav.take(i);}
 nav.lane=lane;assert.equal(result?.status,'ready',`${arena.id}: spawn ${i} path failed`);assert.deepEqual(result.route.at(-1),goal);
 }
 console.log(`${arena.id}: ${g.points.length} walkable nodes, ${checks} collision edges checked, every spawn routes to a reachable district`);
}

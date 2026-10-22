import { SurvivalNavigation } from './survival-navigation.mjs';

// Small min-heap avoids sorting the entire frontier on every expansion.
function push(heap, node) {
  let i = heap.length; heap.push(node);
  while (i > 0) {
    const parent = (i-1)>>1;
    if (heap[parent].g+heap[parent].h <= node.g+node.h) break;
    heap[i] = heap[parent]; i = parent;
  }
  heap[i] = node;
}
function pop(heap) {
  const top = heap[0], last = heap.pop();
  if (heap.length) {
    let i = 0;
    while (i*2+1 < heap.length) {
      let child = i*2+1;
      if (child+1 < heap.length && heap[child+1].g+heap[child+1].h < heap[child].g+heap[child].h) child++;
      if (last.g+last.h <= heap[child].g+heap[child].h) break;
      heap[i] = heap[child]; i = child;
    }
    heap[i] = last;
  }
  return top;
}

// Keep the search frontier between ticks. A short partial path to the nearest
// side of a wall is not a route to the courtyard on the other side of it.
export class PatrolNavigation extends SurvivalNavigation {
  constructor(room) {
    super(room, { navigationRadius: 0.46 });
    this.jobs = new Map();
    this.edges = new Map();
    this.cursor = 0;
    this.lastTick = -1;
    this.graph = room.arena.navigation;
    this.reachableCache = new Map();
    if (this.graph) {
      this.pointIndices = new Map(this.graph.points.map((p,i) => [p.join(','),i]));
      this.bins = new Map();
      this.graph.points.forEach((p,i) => {
        const key = Math.floor(p[0]/8)+':'+Math.floor(p[2]/8);
        if (!this.bins.has(key)) this.bins.set(key,[]);
        this.bins.get(key).push(i);
      });
    }
  }

  reachableGoals(from) {
    if(!this.graph)return this.room.arena.spawns;
    const start=this.nearest(from);if(start==null)return [];
    const component=this.graph.components[start];
    if(!this.reachableCache.has(component)) {
      const seen=new Uint8Array(this.graph.points.length),queue=[start];seen[start]=1;
      for(let i=0;i<queue.length;i++)for(const next of this.graph.edges[queue[i]])if(!seen[next]){seen[next]=1;queue.push(next);}
      this.reachableCache.set(component,this.graph.landmarks.filter(i=>seen[i]).map(i=>this.graph.points[i]));
    }
    return this.reachableCache.get(component);
  }

  nearest(point) {
    const candidates=[];
    for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++) {
      const key=(Math.floor(point[0]/8)+x)+':'+(Math.floor(point[2]/8)+z);
      for(const i of this.bins.get(key)||[]) {
        const p=this.graph.points[i];
        if(Math.abs(p[1]-point[1])<4.5)candidates.push({i,d:Math.hypot(p[0]-point[0],p[2]-point[2])+Math.abs(p[1]-point[1])*2});
      }
    }
    candidates.sort((a,b)=>a.d-b.d);
    for(const {i} of candidates.slice(0,12)) {
      const p=this.graph.points[i], lane=this.lane(point,p);
      if(lane && Math.abs(lane[1]-p[1])<.3)return i;
    }
    return null;
  }

  request(id, from, goal) {
    if (this.jobs.has(id)) return;
    if (this.graph) {
      const start=this.nearest(from), end=this.pointIndices.get(goal.join(','));
      if(start==null || end==null) {
        this.jobs.set(id,{status:'failed'});return;
      }
      const heuristic=p=>Math.hypot(p[0]-goal[0],p[2]-goal[2]);
      const p=this.graph.points[start];
      this.jobs.set(id,{status:'searching',baked:true,end,goal,heuristic,
        open:[{index:start,p,g:0,h:heuristic(p),parent:null}],cost:new Map([[start,0]]),closed:new Set()});
      return;
    }
    const direct = this.lane(from, goal);
    if (direct && Math.abs(direct[1] - goal[1]) < 0.7) {
      this.jobs.set(id, { status: 'ready', route: [direct] });
      return;
    }
    const step = 2;
    const key = p => `${Math.round(p[0]/step)}:${Math.round(p[1]*2)}:${Math.round(p[2]/step)}`;
    const heuristic = p => Math.hypot(p[0]-goal[0], p[2]-goal[2]) + Math.abs(p[1]-goal[1]);
    this.jobs.set(id, {
      status: 'searching', goal, step, key, heuristic,
      open: [{ p: from, g: 0, h: heuristic(from), parent: null }],
      cost: new Map([[key(from), 0]]), closed: new Set(),
    });
  }

  update(tick) {
    if (this.lastTick === tick) return;
    this.lastTick = tick;
    const pending = [...this.jobs.values()].filter(j => j.status === 'searching');
    if (!pending.length) return;
    const job = pending[this.cursor++ % pending.length];
    if (job.baked) {
      for(let n=0;job.open.length && n<768;n++) {
        const node=pop(job.open),key=node.index;
        if(job.closed.has(key)||node.g>job.cost.get(key))continue;
        job.closed.add(key);
        if(key===job.end) {
          const route=[];for(let p=node;p;p=p.parent)route.unshift(p.p);
          job.status='ready';job.route=route;job.open=[];job.cost.clear();job.closed.clear();return;
        }
        for(const index of this.graph.edges[key]) {
          const p=this.graph.points[index],g=node.g+Math.hypot(p[0]-node.p[0],p[2]-node.p[2])+Math.abs(p[1]-node.p[1]);
          if(job.closed.has(index)||g>=(job.cost.get(index)??Infinity))continue;
          job.cost.set(index,g);push(job.open,{index,p,g,h:job.heuristic(p),parent:node});
        }
      }
      if(!job.open.length){job.status='failed';job.cost.clear();job.closed.clear();}
      return;
    }
    const directions = [[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
    // One shared budget for the room, not a fresh expensive search per bot.
    let queries = 0;
    for (let expanded = 0; job.open.length && expanded < 192 && queries < 96;) {
      const node = pop(job.open), key = job.key(node.p);
      if (job.closed.has(key) || node.g > job.cost.get(key)) continue;
      job.closed.add(key); expanded++;
      if (node.h < job.step * 2) {
        const finish = this.lane(node.p, job.goal);
        if (finish && Math.abs(finish[1]-job.goal[1]) < 0.7) {
          const route = [finish];
          for (let n = node; n.parent; n = n.parent) route.unshift(n.p);
          job.status = 'ready'; job.route = route;
          job.open = []; job.cost.clear(); job.closed.clear();
          return;
        }
      }
      for (const [dx,dz] of directions) {
        const x = (Math.round(node.p[0]/job.step)+dx)*job.step;
        const z = (Math.round(node.p[2]/job.step)+dz)*job.step;
        const edgeKey = `${node.p[0]}:${Math.round(node.p[1]*1000)}:${node.p[2]}>${x}:${z}`;
        let next;
        if (this.edges.has(edgeKey)) next = this.edges.get(edgeKey);
        else {
          next = this.lane(node.p, [x,node.p[1],z]); queries++;
          // Static map geometry can be reused across every bot and patrol.
          if (this.edges.size >= 65536) this.edges.delete(this.edges.keys().next().value);
          this.edges.set(edgeKey,next);
        }
        if (!next) continue;
        const nextKey = job.key(next), g = node.g+Math.hypot(dx,dz)*job.step+Math.abs(next[1]-node.p[1]);
        if (job.closed.has(nextKey) || g >= (job.cost.get(nextKey) ?? Infinity)) continue;
        job.cost.set(nextKey,g);
        push(job.open,{p:next,g,h:job.heuristic(next),parent:node});
      }
      if (job.closed.size >= 16000) { job.open = []; break; }
    }
    if (!job.open.length) {
      job.status = 'failed'; job.cost.clear(); job.closed.clear();
    }
  }

  take(id) {
    const job = this.jobs.get(id);
    if (!job || job.status === 'searching') return null;
    this.jobs.delete(id);
    return job;
  }
}

// Each bot chooses its own destination; only static collision data is shared.
export function choosePatrolGoal(bot, players, candidates, tick, random) {
  const {px, pz} = bot.state;
  const peers = [...players.values()].filter(other => other.id !== bot.id && other.isBot && other.alive && !other.spectating);
  const scored = candidates.map(goal => {
    const distance = Math.hypot(goal[0] - px, goal[2] - pz);
    let congestion = 0;
    for (const peer of peers) {
      const destination = peer._botGoal;
      if (destination) congestion += Math.max(0, 1 - Math.hypot(goal[0]-destination[0], goal[2]-destination[2])/24) * 4;
      congestion += Math.max(0, 1 - Math.hypot(goal[0]-peer.state.px, goal[2]-peer.state.pz)/12) * 1;
    }
    const visits = bot._botLandmarkVisits?.get(goal.join(',')) || 0;
    const forward = Number.isFinite(bot._botAimYaw) && distance > 0
      ? (-Math.sin(bot._botAimYaw)*(goal[0]-px)-Math.cos(bot._botAimYaw)*(goal[2]-pz))/distance : 0;
    return {goal, score: Math.min(120,distance)*.5 + random(bot.id*71+tick+goal[0]*19+goal[2]*13)*20 + forward*16 - visits*70 - congestion};
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored[0]?.goal;
}



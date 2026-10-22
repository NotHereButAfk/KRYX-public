import { insidePlayableBounds } from '../src/world/PlayableBounds.js';
// Bounded local routing over the same ground/raycast queries as existing bots.
// Nodes include elevation: floors above one another cannot become false shortcuts.
export class SurvivalNavigation {
  constructor(room, config) {
    this.room = room;
    this.config = config;
  }
  lane(from, to) {
    const a = this.room.arena,
      dx = to[0] - from[0],
      dz = to[2] - from[2],
      length = Math.hypot(dx, dz);
    if (!length) return [to[0], from[1], to[2]];
    const maxDrop = a.botMaxDrop ?? 2;
    let y = from[1];
    for (let i = 1, n = Math.ceil(length / 0.6); i <= n; i++) {
      const x = from[0] + (dx * i) / n,
        z = from[2] + (dz * i) / n;
      if (Math.abs(x) > a.half - 0.4 || Math.abs(z) > a.half - 0.4) return null;
      // Test a step up before looking for a landing below. Passing y-2 as
      // the new feet height disables the arena's stair-step acceptance.
      let ground = a.groundHeightAt(x, z, y, y);
      if (!Number.isFinite(ground)) ground = a.groundHeightAt(x, z, y, y - maxDrop);
      if (
        !Number.isFinite(ground) ||
        ground <= a.killY ||
        ground - y > 0.6 || y - ground > maxDrop
      )
        return null;
      // Sweep the full capsule width, not only its centre line.
      const radius = this.config.navigationRadius ?? 0.3;
      if ([-radius, 0, radius].some(side => a.raycast(
        from[0] + dx * (i - 1) / n - dz / length * side,
        Math.max(y, ground) + 0.9,
        from[2] + dz * (i - 1) / n + dx / length * side,
        dx / length, 0, dz / length, length / n + 0.35,
      ) < length / n + 0.25)) return null;
      if (!insidePlayableBounds([x, ground, z], a.playableBounds, this.config.navigationRadius ?? .3)) return null;
      y = ground;
    }
    return [to[0], y, to[2]];
  }
  path(from, goal, salt = 0) {
    const deadline = performance.now() + this.config.navigationBudgetMs;
    const direct = this.lane(from, goal);
    if (direct && Math.abs(direct[1] - goal[1]) < 0.8) return [direct];
    const step = this.config.navigationCell;
    const key = p => `${Math.round((p[0]-from[0])/step)}:${Math.round(p[1]/0.5)}:${Math.round((p[2]-from[2])/step)}`;
    const heuristic = p => Math.hypot(p[0]-goal[0], p[2]-goal[2]) + Math.abs(p[1]-goal[1])*2;
    const open = [{ p: from, g: 0, h: heuristic(from), parent: null }];
    const cost = new Map([[key(from), 0]]), closed = new Set();
    const directions = [[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
    let best = open[0], expanded = 0;
    while (open.length && expanded < this.config.pathNodeBudget && performance.now() < deadline) {
      open.sort((a,b) => a.g+a.h-b.g-b.h);
      const node = open.shift(), nodeKey = key(node.p);
      // Duplicates must not consume the search budget. The old search spent
      // most of its nodes re-visiting cells and stopped at the same corners.
      if (closed.has(nodeKey) || node.g > cost.get(nodeKey)) continue;
      closed.add(nodeKey); expanded++;
      if (node.h < best.h) best = node;
      if (node.h < step * 2) {
        const finish = this.lane(node.p, goal);
        if (finish && Math.abs(finish[1]-goal[1]) < 0.7) {
          best = { p: finish, parent: node }; break;
        }
      }
      for (let i=0; i<8; i++) {
        const [dx,dz] = directions[(i+salt)%8];
        const next = this.lane(node.p, [node.p[0]+dx*step, node.p[1], node.p[2]+dz*step]);
        if (!next) continue;
        const nextKey=key(next), g=node.g+Math.hypot(dx,dz)*step+Math.abs(next[1]-node.p[1]);
        if (closed.has(nextKey) || g >= (cost.get(nextKey) ?? Infinity)) continue;
        cost.set(nextKey,g);
        open.push({p:next,g,h:heuristic(next),parent:node});
      }
    }
    const result = [];
    while (best.parent) {
      result.unshift(best.p);
      best = best.parent;
    }
    return result;
  }
  steer(p, goal) {
    const now = this.room.tick / 20,
      ai = p.survivalAI,
      pos = [p.state.px, p.state.py, p.state.pz];
    if (
      this.lastPathTick !== this.room.tick &&
      now >= ai.nextPath &&
      (!ai.path.length ||
        Math.hypot(goal[0] - ai.goal[0], goal[2] - ai.goal[2]) > 4 ||
        now - ai.pathAt > 4)
    ) {
      this.lastPathTick = this.room.tick;
      ai.goal = goal;
      ai.path = this.path(pos, goal, p.id % 8);
      ai.pathAt = now;
      ai.nextPath = now + this.config.pathfindingInterval;
    }
    while (
      ai.path.length &&
      Math.hypot(ai.path[0][0] - pos[0], ai.path[0][2] - pos[2]) < Math.max(.8, (p.enemySpeed || 0) / 20 * 1.25)
      && Math.abs(ai.path[0][1] - pos[1]) < 0.7
    )
      ai.path.shift();
    const point = ai.path[0];
    return point ? [point[0] - pos[0], point[2] - pos[2]] : [0, 0];
  }
}

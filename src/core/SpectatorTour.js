import * as THREE from 'three';

/** Independent, level establishing shots: translate through a lane, then cut. */
export function menuDollyShots(routes, clearSegment) {
  const shots = [];
  for (const route of routes) for (const node of route) {
    if (shots.length >= 12) return shots;
    const start = node.p.clone();
    // Stay among the architecture, above player eye height where clearance allows.
    for (const rise of [3, 2, 1]) {
      const lifted = node.p.clone().add(new THREE.Vector3(0, rise, 0));
      if (clearSegment(node.p, lifted)) { start.copy(lifted); break; }
    }
    if (shots.some(shot => shot[0].p.distanceTo(start) < 8)) continue;
    const direction = node.t.clone().sub(node.p).setY(0).normalize();
    if (direction.lengthSq() < 0.5) continue;
    for (const length of [32, 24, 16, 8]) {
      const end = start.clone().addScaledVector(direction, length);
      if (!clearSegment(start, end)) continue;
      shots.push([0, 1 / 3, 2 / 3, 1].map(u => {
        const p = start.clone().lerp(end, u);
        return { p, t: p.clone().addScaledVector(direction, 30) };
      }));
      break;
    }
  }
  return shots;
}

/** Lift map viewpoints into a free camera flight, respecting low ceilings. */
export function elevatedSpectatorRoutes(routes, clearSegment) {
  return routes.map(route => {
    // A dolly lane keeps one height. Independent offsets made the four nearby
    // spawn viewpoints bob up and down like footsteps.
    // A low doorway must not drag the entire overview down to eye level.
    // Omit cramped viewpoints; if none remain, use the map's aerial fallback.
    const flightNodes = route.filter(node => clearSegment(node.p, node.p.clone().add(new THREE.Vector3(0, 4, 0))));
    let rise = 14;
    for (; rise > 4; rise -= 0.5) {
      if (flightNodes.every(node => clearSegment(node.p, node.p.clone().add(new THREE.Vector3(0, rise, 0))))) break;
    }
    return flightNodes.map(node => ({ p: node.p.clone().add(new THREE.Vector3(0, rise, 0)), t: node.t.clone() }));
  });
}

/** Player spawn offsets are only candidate shots. Validate the entire dolly
 * spline after raising it; an overhang can obstruct an otherwise safe lane. */
export function safeSpectatorRoutes(routes, clearSegment) {
  return routes.filter(route => {
    if (route.length < 4) return false;
    const curve = new THREE.CatmullRomCurve3(route.map(node => node.p), false, 'centripetal', 0.5);
    const length = curve.getLength();
    if (length < 0.5) return false;
    const steps = Math.ceil(length / 0.2);
    for (let i = 0; i < steps; i++) {
      // Overlapping intervals keep geometry at a sample boundary detectable.
      const a = curve.getPointAt(Math.max(0, i - 1) / steps);
      const b = curve.getPointAt(Math.min(steps, i + 1) / steps);
      if (!clearSegment(a, b)) return false;
    }
    return true;
  });
}

/** Build a continuous tour through mutually visible map viewpoints.
 * Collision tests happen once at map readiness, never in the render loop.
 * Disconnected rooms are not joined by a teleport or a flight through a wall.
 */
export function buildSpectatorTour(routes, clearSegment) {
  const nodes = [];
  for (const route of routes) for (const waypoint of route) {
    if (nodes.length >= 96) break;
    if (!nodes.some((n) => n.p.distanceToSquared(waypoint.p) < 16)) {
      nodes.push({ p: waypoint.p.clone(), t: waypoint.t.clone() });
    }
  }
  if (nodes.length < 2) return null;
  const edges = nodes.map(() => []);
  const checked = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const nearest = nodes.map((n, j) => ({ j, d: n.p.distanceTo(nodes[i].p) }))
      .filter(({ j, d }) => j !== i && d < 65)
      .sort((a, b) => a.d - b.d).slice(0, 8);
    for (const { j } of nearest) {
      const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
      if (checked.has(key)) continue;
      checked.add(key);
      if (!clearSegment(nodes[i].p, nodes[j].p)) continue;
      edges[i].push(j); edges[j].push(i);
    }
  }
  // Seed a broad visible circuit, then insert reachable viewpoints. A DFS walk
  // retraced every branch and produced abrupt 180-degree reversals at dead ends.
  // Narrow/disconnected lanes instead use the slow dissolving dolly fallback.
  const cross = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let circuit = null, bestArea = 4;
  for (let i = 0; i < nodes.length; i++) for (const j of edges[i]) {
    if (j <= i) continue;
    for (const k of edges[j]) {
      if (k <= j || !edges[k].includes(i)) continue;
      const area = cross.crossVectors(ab.subVectors(nodes[j].p, nodes[i].p), ac.subVectors(nodes[k].p, nodes[i].p)).length();
      if (area > bestArea) { bestArea = area; circuit = [i, j, k]; }
    }
  }
  if (!circuit) return null;
  const used = new Set(circuit);
  for (;;) {
    let insertion = null, bestCost = Infinity;
    for (let c = 0; c < circuit.length; c++) {
      const a = circuit[c], b = circuit[(c + 1) % circuit.length];
      for (const n of edges[a]) {
        if (used.has(n) || !edges[n].includes(b)) continue;
        ab.subVectors(nodes[n].p, nodes[a].p).normalize();
        ac.subVectors(nodes[b].p, nodes[n].p).normalize();
        if (ab.dot(ac) < -0.35) continue; // no hairpin detours to collect a spawn
        const cost = nodes[a].p.distanceTo(nodes[n].p) + nodes[n].p.distanceTo(nodes[b].p) - nodes[a].p.distanceTo(nodes[b].p);
        if (cost < bestCost) { bestCost = cost; insertion = { c, n }; }
      }
    }
    if (!insertion) break;
    circuit.splice(insertion.c + 1, 0, insertion.n); used.add(insertion.n);
  }
  return [...circuit, circuit[0]].map(i => nodes[i]);
}

/** Round each corner within a small, collision-checked envelope. */
export function spectatorTourCurves(tour, clearSegment) {
  const path = new THREE.CurvePath();
  const look = new THREE.CurvePath();
  const unique = tour.slice(0, -1);
  const corners = unique.map((node, i) => {
    const prev = unique[(i + unique.length - 1) % unique.length];
    const next = unique[(i + 1) % unique.length];
    const radius = Math.min(6, node.p.distanceTo(prev.p) * 0.4, node.p.distanceTo(next.p) * 0.4);
    let enter = node.p.clone().lerp(prev.p, radius / Math.max(0.001, node.p.distanceTo(prev.p)));
    let leave = node.p.clone().lerp(next.p, radius / Math.max(0.001, node.p.distanceTo(next.p)));
    // Test the actual bend, not just its chord: an arch or pillar may sit
    // between a clear shortcut and the original two straight links.
    for (let attempt = 0; attempt < 5; attempt++) {
      const bend = new THREE.QuadraticBezierCurve3(enter, node.p, leave);
      const steps = Math.max(4, Math.ceil(bend.getLength() / 0.5));
      let previous = enter, safe = true;
      for (let s = 1; s <= steps; s++) {
        const point = bend.getPoint(s / steps);
        if (!clearSegment(previous, point)) { safe = false; break; }
        previous = point;
      }
      if (safe) break;
      enter.lerp(node.p, 0.5); leave.lerp(node.p, 0.5);
      if (attempt === 4) { enter = node.p.clone(); leave = node.p.clone(); }
    }
    return { enter, leave, node };
  });
  // Pair every position curve with a look curve of the same relative duration.
  // Sampling look by its own arc length would desynchronise it from the camera.
  const pieces = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const bend = new THREE.QuadraticBezierCurve3(a.enter, a.node.p, a.leave);
    if (bend.getLength() > 0.001) pieces.push({ p: bend, from: a.node.t, to: a.node.t });
    const line = new THREE.LineCurve3(a.leave, b.enter);
    if (line.getLength() > 0.001) pieces.push({ p: line, from: a.node.t, to: b.node.t });
  }
  for (const piece of pieces) path.add(piece.p);
  const lengths = pieces.map((piece) => piece.p.getLength());
  const total = lengths.reduce((a, b) => a + b, 0);
  // Same getPointAt interface as Three curves, without per-frame allocation.
  look.getPointAt = (u, target = new THREE.Vector3()) => {
    let remaining = THREE.MathUtils.clamp(u, 0, 1) * total;
    for (let i = 0; i < pieces.length; i++) {
      if (remaining <= lengths[i] || i === pieces.length - 1) {
        const blend = THREE.MathUtils.smoothstep(remaining / lengths[i], 0, 1);
        return target.copy(pieces[i].from).lerp(pieces[i].to, blend);
      }
      remaining -= lengths[i];
    }
    return target.copy(tour[0].t);
  };
  // CurvePath.getPoint already traverses child curves by length. Calling its
  // inherited getPointAt remaps it a second time and distorts corner timing.
  path.getPointAt = (u, target = new THREE.Vector3()) => path.getPoint(u, target);
  return { path, look, length: total };
}

export function makeSpectatorClearance(world) {
  const ray = new THREE.Ray(), delta = new THREE.Vector3();
  const offsets = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
  return (a, b) => {
    delta.subVectors(b, a);
    const distance = delta.length();
    if (distance < 0.001) return true;
    ray.direction.copy(delta).divideScalar(distance);
    for (const [x, y] of offsets) {
      ray.origin.copy(a); ray.origin.x += x; ray.origin.y += y;
      if (world.raycastCollisionDistance(ray, distance) < distance - 0.03) return false;
      // Two-sided testing catches camera exit through one-sided map triangles.
      ray.origin.copy(b); ray.origin.x += x; ray.origin.y += y;
      ray.direction.negate();
      const blocked = world.raycastCollisionDistance(ray, distance) < distance - 0.03;
      ray.direction.negate();
      if (blocked) return false;
    }
    return true;
  };
}

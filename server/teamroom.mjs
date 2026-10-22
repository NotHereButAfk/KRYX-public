import { AuthRoom } from "./authroom.mjs";
export class TeamRoom extends AuthRoom {
  constructor(arena, options) {
    super(arena, { ...options, shieldsEnabled: true });
    this.mode = "teamslayer";
    this.matchDurationMs = 600000;
    this.matchStart = Date.now();
  }
  _rotateMatch(now = Date.now()) {
    const kills = [0, 0];
    for (const p of this.players.values()) kills[p.team || 0] += p.kills;
    if (Math.max(...kills) >= 50) this.matchStart = now - this.matchDurationMs;
    return super._rotateMatch(now);
  }
  _add(send, name, isBot) {
    const id = super._add(send, name, isBot);
    const counts = [0, 0];
    for (const p of this.players.values())
      if (p.id !== id) counts[p.team || 0]++;
    this.players.get(id).team = counts[0] <= counts[1] ? 0 : 1;
    return id;
  }
  opponents(a, b) {
    return a.team !== b.team;
  }
  _damage(target, shooter, dmg, head, wid = null, source = null) {
    if (shooter && shooter !== target && target.team === shooter.team) return;
    super._damage(target, shooter, dmg, head, wid, source);
  }
  winnerIds() {
    const points = [0, 0];
    for (const p of this.players.values()) points[p.team] += p.kills;
    if (points[0] === points[1]) return [];
    const winning = points[0] > points[1] ? 0 : 1;
    return [...this.players.values()]
      .filter((p) => !p.isBot && p.team === winning)
      .map((p) => p.id);
  }
}

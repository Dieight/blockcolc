// Distances are world blocks; feet are at physical mesh tops,
// not ScenerySurface.supportY (which includes a half-block placement offset).
export interface Point { x: number; y: number; z: number }
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Solid extends Bounds {
  id: string; owner: string; minY: number; maxY: number;
  water?: boolean; walkable?: boolean;
}
export interface Body {
  id: string; radius: number; height: number; step: number; jump: number; drop: number; speed: number; supportRadius?: number;
}
export const SHEEP: Body = { id: 'sheep', radius: .49, supportRadius: .27, height: 1.35, step: .51, jump: 1.01, drop: 1.05, speed: 1.65 };
export const PIG: Body = { id: 'pig', radius: .32, height: .95, step: .51, jump: 1.01, drop: 1.05, speed: 1.8 };
export const HORSE: Body = { id: 'horse', radius: .64, height: 2.35, step: .51, jump: 1.01, drop: 1.05, speed: 2.2 };
export const COW: Body = { id: 'cow', radius: .55, supportRadius:.3, height: 1.65, step: .51, jump: 1.01, drop: 1.05, speed: 1.4 };
const EPS = .0001, BIN = 8;
const contains = (s: Bounds, x: number, z: number) => x >= s.minX - EPS && x <= s.maxX + EPS && z >= s.minZ - EPS && z <= s.maxZ + EPS;
const overlap = (a: Bounds, b: Bounds) => a.maxX > b.minX + EPS && a.minX < b.maxX - EPS && a.maxZ > b.minZ + EPS && a.minZ < b.maxZ - EPS;
const key = (x: number, z: number) => `${x}:${z}`;
const footprint = (p: Point, r: number): Bounds => ({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r });
function bins(b: Bounds): string[] {
  const result: string[] = [];
  for (let z = Math.floor(b.minZ / BIN); z <= Math.floor((b.maxZ - EPS) / BIN); z++)
    for (let x = Math.floor(b.minX / BIN); x <= Math.floor((b.maxX - EPS) / BIN); x++) result.push(key(x, z));
  return result;
}

/** Shared static broad phase. No continuous-coordinate memoization. */
export class CollisionWorld {
  readonly solids = new Map<string, Solid>();
  private readonly buckets = new Map<string, Set<string>>();
  private readonly epochs = new Map<string, number>();
  private readonly owners = new Map<string, Set<string>>();
  revision = 0;
  queries = 0;
  constructor(readonly bounds: Bounds, solids: readonly Solid[] = [], private readonly ground?: (b:Bounds)=>Solid[]) { this.replaceOwner('initial', solids); }

  replaceOwner(owner: string, replacement: readonly Solid[]): { dirtyBins: number; revision: number } {
    const incoming = new Set<string>();
    for (const s of replacement) {
      if (![s.minX, s.maxX, s.minY, s.maxY, s.minZ, s.maxZ].every(Number.isFinite)
        || s.minX >= s.maxX || s.minY >= s.maxY || s.minZ >= s.maxZ || incoming.has(s.id)
        || this.solids.has(s.id) && this.solids.get(s.id)!.owner !== owner) throw Error(`Invalid or duplicate collider: ${s.id}`);
      incoming.add(s.id);
    }
    const dirty = new Set<string>();
    for (const id of this.owners.get(owner) ?? []) { const s=this.solids.get(id)!;
      for (const k of bins(s)) { this.buckets.get(k)?.delete(id); dirty.add(k); }
      this.solids.delete(id);
    }
    this.owners.set(owner,incoming);
    for (const s of replacement) {
      const saved = Object.freeze({ ...s, owner }); this.solids.set(saved.id, saved);
      for (const k of bins(saved)) {
        let bucket = this.buckets.get(k); if (!bucket) this.buckets.set(k, bucket = new Set());
        bucket.add(saved.id); dirty.add(k);
      }
    }
    this.revision++;
    for (const k of dirty) {
      if (this.buckets.get(k)?.size === 0) this.buckets.delete(k);
      this.epochs.set(k, this.revision);
    }
    return { dirtyBins: dirty.size, revision: this.revision };
  }

  query(b: Bounds): Solid[] {
    this.queries++;
    const ids = new Set<string>(), result: Solid[] = [];
    for (const k of bins(b)) for (const id of this.buckets.get(k) ?? []) ids.add(id);
    for (const id of ids) { const s = this.solids.get(id)!; if (overlap(s, b)) result.push(s); }
    return this.ground ? result.concat(this.ground(b)) : result;
  }
  stamp(b: Bounds): string { return bins(b).map(k => `${k}/${this.epochs.get(k) ?? 0}`).join(','); }
  clear(p: Point, body: Body): boolean {
    if (!contains(this.bounds, p.x - body.radius, p.z - body.radius) || !contains(this.bounds, p.x + body.radius, p.z + body.radius)) return false;
    return !this.query(footprint(p, body.radius)).some(s => p.y + body.height > s.minY + EPS && p.y < s.maxY - EPS);
  }
  supported(p: Point, body: Body): boolean {
    const nearby = this.query(footprint(p, body.radius));
    const r = (body.supportRadius ?? body.radius) * .96;
    return [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]].every(([dx, dz]) =>
      nearby.some(s => !s.water && s.walkable !== false && Math.abs(s.maxY - p.y) < .025 && contains(s, p.x + dx!, p.z + dz!)));
  }
  floors(x: number, z: number, body: Body): Point[] {
    const heights = new Set(this.query(footprint({ x, y: 0, z }, body.radius))
      .filter(s => !s.water && s.walkable !== false && contains(s, x, z)).map(s => s.maxY));
    return [...heights].sort((a, b) => a - b).map(y => ({ x, y, z })).filter(p => this.clear(p, body) && this.supported(p, body));
  }
  stats() { return { solids: this.solids.size, bins: this.buckets.size, epochs: this.epochs.size, queries: this.queries, revision: this.revision }; }
}

export type Action = 'walk' | 'step' | 'jump' | 'drop';
export function edgeAction(a: Point, b: Point, body: Body): Action {
  return b.y < a.y - .025 ? 'drop' : b.y > a.y + .025 ? b.y - a.y <= body.step ? 'step' : 'jump' : 'walk';
}

/** Lift before crossing a riser, then land. No interpolation through its wall.
 * This intentionally conservative prototype is not final jump choreography. */
export function edgePoint(a: Point, b: Point, t: number, body: Body): Point {
  const action = edgeAction(a, b, body), lerp = (x: number, y: number, k: number) => x + (y - x) * k;
  if (action === 'walk') return { x: lerp(a.x, b.x, t), y: a.y, z: lerp(a.z, b.z, t) };
  const peak = Math.max(a.y, b.y) + (action === 'step' ? .12 : .28);
  if (t < .28) return { x: a.x, z: a.z, y: lerp(a.y, peak, Math.sin(t / .28 * Math.PI / 2)) };
  if (t < .8) { const k = (t - .28) / .52; return { x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k), y: peak + Math.sin(k * Math.PI) * .06 }; }
  return { x: b.x, z: b.z, y: lerp(peak, b.y, 1 - Math.cos((t - .8) / .2 * Math.PI / 2)) };
}

export function traversable(world: CollisionWorld, a: Point, b: Point, body: Body): boolean {
  const dy = b.y - a.y;
  if (dy > body.jump + EPS || -dy > body.drop + EPS) return false;
  if (!world.clear(a, body) || !world.clear(b, body) || !world.supported(b, body)) return false;
  if (Math.abs(dy) < .025) {
    // A continuous swept AABB covers every intermediate position on a straight
    // cardinal edge. Support also rejects holes, thin ledges and water.
    const r = body.radius, swept = { minX: Math.min(a.x, b.x) - r, maxX: Math.max(a.x, b.x) + r,
      minZ: Math.min(a.z, b.z) - r, maxZ: Math.max(a.z, b.z) + r };
    if (world.query(swept).some(s => a.y + body.height > s.minY + EPS && a.y < s.maxY - EPS)) return false;
    for (const t of [.25, .5, .75]) if (!world.supported(edgePoint(a, b, t, body), body)) return false;
    return true;
  }
  for (let i = 1; i < 32; i++) if (!world.clear(edgePoint(a, b, i / 32, body), body)) return false;
  return true;
}

interface HeapEntry { p: Point; g: number; f: number }
class Heap {
  values: HeapEntry[] = [];
  push(v: HeapEntry) { const a = this.values; let i = a.length; a.push(v); while (i) { const parent = (i - 1) >> 1; if (a[parent]!.f <= v.f) break; a[i] = a[parent]!; i = parent; } a[i] = v; }
  pop(): HeapEntry | undefined {
    const a = this.values, top = a[0], last = a.pop(); if (!a.length || !last) return top;
    let i = 0; while (i * 2 + 1 < a.length) { let child = i * 2 + 1; if (child + 1 < a.length && a[child + 1]!.f < a[child]!.f) child++;
      if (last.f <= a[child]!.f) break; a[i] = a[child]!; i = child; } a[i] = last; return top;
  }
}
const nodeKey = (p: Point) => `${p.x}:${p.z}:${Math.round(p.y * 10000)}`;
export interface Route { points: Point[]; actions: Action[]; expanded: number; ms: number; reason: 'arrived' | 'unreachable' | 'budget' | 'invalid' | 'cancelled' }

export class Navigator {
  private readonly columns = new Map<string, { stamp: string; points: Point[] }>();
  cacheHits = 0; cacheMisses = 0;
  constructor(readonly world: CollisionWorld, readonly body: Body, readonly cell = 1, readonly cacheLimit = 4096) {}
  column(x: number, z: number): Point[] {
    const k = key(x, z), stamp = this.world.stamp(footprint({ x, y: 0, z }, this.body.radius)), previous = this.columns.get(k);
    if (previous?.stamp === stamp) { this.cacheHits++; this.columns.delete(k); this.columns.set(k, previous); return previous.points; }
    this.cacheMisses++; const points = this.world.floors(x, z, this.body);
    this.columns.delete(k); this.columns.set(k, { stamp, points });
    if (this.columns.size > this.cacheLimit) this.columns.delete(this.columns.keys().next().value!);
    return points;
  }
  nearest(p: Point, distance = 3): Point | undefined {
    let best: Point | undefined, score = Infinity;
    const cx = Math.round(p.x / this.cell) * this.cell, cz = Math.round(p.z / this.cell) * this.cell;
    for (let dz = -distance; dz <= distance; dz++) for (let dx = -distance; dx <= distance; dx++) {
      if (Math.hypot(dx, dz) > distance) continue;
      for (const q of this.column(cx + dx * this.cell, cz + dz * this.cell)) {
        const next = Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 2;
        if (next < score) { best = q; score = next; }
      }
    }
    return best;
  }
  plan(start: Point, goal: Point, budget = 8000): Route {
    const work = this.search(start, goal, budget); let next = work.next();
    while (!next.done) next = work.next(); return next.value;
  }
  async planCooperatively(start: Point, goal: Point, isCurrent: () => boolean = () => true, budget = 8000) {
    const work = this.search(start, goal, budget), revision = this.world.revision, slices: number[] = [], began = performance.now();
    let next: IteratorResult<void, Route>;
    do {
      if (!isCurrent() || this.world.revision !== revision) {
        work.return({ points: [], actions: [], expanded: 0, ms: performance.now() - began, reason: 'cancelled' });
        return { route: { points: [], actions: [], expanded: 0, ms: performance.now() - began, reason: 'cancelled' } as Route, slices, wallMs: performance.now() - began };
      }
      const sliceStarted = performance.now(); next = work.next(); slices.push(performance.now() - sliceStarted);
      if (!next.done) await new Promise<void>(resolve => setTimeout(resolve, 0));
    } while (!next.done);
    return { route: next.value, slices, wallMs: performance.now() - began };
  }
  private *search(start: Point, goal: Point, budget: number): Generator<void, Route> {
    const began = performance.now(), result = (points: Point[], expanded: number, reason: Route['reason']): Route =>
      ({ points, actions: points.slice(1).map((p, i) => edgeAction(points[i]!, p, this.body)), expanded, reason, ms: performance.now() - began });
    if (!this.world.clear(start, this.body) || !this.world.supported(start, this.body) || !this.world.clear(goal, this.body) || !this.world.supported(goal, this.body)) return result([], 0, 'invalid');
    const origin = this.nearest(start, 1), target = this.nearest(goal, 1);
    if (!origin || !target || !traversable(this.world, start, origin, this.body) || !traversable(this.world, target, goal, this.body)) return result([], 0, 'invalid');
    const heap = new Heap(), costs = new Map<string, number>(), parents = new Map<string, Point>();
    const heuristic = (p: Point) => Math.hypot(p.x - target.x, p.z - target.z);
    costs.set(nodeKey(origin), 0); heap.push({ p: origin, g: 0, f: heuristic(origin) });
    let expanded = 0, sliceStarted = performance.now();
    while (heap.values.length && expanded < budget) {
      if (performance.now() - sliceStarted >= 2) { yield; sliceStarted = performance.now(); }
      const { p, g } = heap.pop()!, id = nodeKey(p); if (g > costs.get(id)! + EPS) continue;
      expanded++;
      if (id === nodeKey(target)) {
        const points = [p]; let cursor = p;
        while (parents.has(nodeKey(cursor))) { cursor = parents.get(nodeKey(cursor))!; points.push(cursor); }
        points.reverse(); if (Math.hypot(start.x - origin.x, start.z - origin.z) > EPS) points.unshift({ ...start });
        if (Math.hypot(goal.x - target.x, goal.z - target.z) > EPS) points.push({ ...goal });
        return result(points, expanded, 'arrived');
      }
      for (const [dx, dz] of [[this.cell, 0], [-this.cell, 0], [0, this.cell], [0, -this.cell],
        [this.cell,this.cell],[-this.cell,this.cell],[this.cell,-this.cell],[-this.cell,-this.cell]]) {
        for (const next of this.column(p.x + dx!, p.z + dz!)) {
          const nextId = nodeKey(next), nextG = g + Math.hypot(dx!,dz!) + Math.abs(next.y - p.y) * .6 + (Math.abs(next.y - p.y) > .025 ? .35 : 0);
          if (nextG >= (costs.get(nextId) ?? Infinity) - EPS || !traversable(this.world, p, next, this.body)) continue;
          costs.set(nextId, nextG); parents.set(nextId, p); heap.push({ p: next, g: nextG, f: nextG + heuristic(next) });
        }
      }
    }
    return result([], expanded, heap.values.length ? 'budget' : 'unreachable');
  }
  stats() { return { columns: this.columns.size, limit: this.cacheLimit, hits: this.cacheHits, misses: this.cacheMisses }; }
}

/** Dynamic state deliberately has no renderer/world-generation dependency. */
export class Walker {
  speedScale=1; curve=0;
  canOccupy?:(point:Point)=>boolean;
  position: Point; heading = 0; traveled = 0; reactions = 0; reactionRemaining = 0;
  route: Route | null = null; goal: Point | null = null; replans = 0; blocked = 0; droppedSeconds = 0;
  private edge = 0; private t = 0; private seenRevision: number; private replanOnLanding = false;
  constructor(readonly navigator: Navigator, start: Point) { this.position = { ...start }; this.seenRevision = navigator.world.revision; }
  setTarget(goal: Point): Route {
    return this.adoptRoute(goal, this.navigator.plan(this.position, goal));
  }
  adoptRoute(goal: Point, route: Route): Route {
    this.goal = { ...goal }; this.route = route; this.edge = 0; this.t = 0;
    this.seenRevision = this.navigator.world.revision; return this.route;
  }
  tap() { this.reactions++; this.reactionRemaining = 1.3; }
  get moving() { return !!this.route && this.edge + 1 < this.route.points.length; }
  update(elapsed: number) {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    const bounded = Math.min(elapsed, .12); this.droppedSeconds += Math.max(0, elapsed - bounded);
    if (this.reactionRemaining > 0) {
      this.reactionRemaining = Math.max(0, this.reactionRemaining - bounded);
      // A tap may turn the head in the air, but must not suspend a jump.
      if (this.navigator.world.supported(this.position, this.navigator.body)) return;
    }
    if (this.seenRevision !== this.navigator.world.revision) {
      this.seenRevision = this.navigator.world.revision;
      if (this.goal && this.moving) {
        if (this.navigator.world.supported(this.position, this.navigator.body)) { this.replans++; this.setTarget(this.goal); }
        else this.replanOnLanding = true;
      }
    }
    let remaining = bounded;
    while (remaining > EPS && this.moving) {
      const dt = Math.min(remaining, 1 / 90); remaining -= dt;
      const a = this.route!.points[this.edge]!, b = this.route!.points[this.edge + 1]!;
      const length = Math.max(.001, Math.hypot(b.x - a.x, b.z - a.z));
      const walk=edgeAction(a,b,this.navigator.body)==='walk';
      const duration = length / (this.navigator.body.speed*Math.max(.1,this.speedScale)) + (walk ? 0 : .45);
      const nextT = Math.min(1, this.t + dt / duration), straight = edgePoint(a, b, nextT, this.navigator.body);
      let next=straight;
      if(walk&&this.curve){const offset=Math.sin(Math.PI*nextT)*this.curve;
        const curved={x:straight.x-(b.z-a.z)/length*offset,y:straight.y,z:straight.z+(b.x-a.x)/length*offset};
        if(this.navigator.world.clear(curved,this.navigator.body)&&this.navigator.world.supported(curved,this.navigator.body))next=curved;}
      if (!this.navigator.world.clear(next, this.navigator.body)||walk&&!this.navigator.world.supported(next,this.navigator.body)
        ||this.canOccupy?.(next)===false) { this.blocked++; this.route = null; break; }
      this.traveled += Math.hypot(next.x - this.position.x, next.z - this.position.z);
      const desired=Math.hypot(next.x-this.position.x,next.z-this.position.z)>.00001?Math.atan2(next.x-this.position.x,next.z-this.position.z):this.heading;
      const turn=Math.atan2(Math.sin(desired-this.heading),Math.cos(desired-this.heading));
      this.position = next; this.heading += turn*Math.min(1,dt*12); this.t = nextT;
      if (nextT >= 1) {
        this.edge++; this.t = 0;
        if (this.replanOnLanding && this.goal) { this.replanOnLanding = false; this.replans++; this.setTarget(this.goal); }
      }
    }
  }
}

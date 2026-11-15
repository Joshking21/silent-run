// Tile grid, A* pathfinding and line-of-sight. Positions are in tile units;
// tile (x, y) spans [x, x+1) × [y, y+1) and its centre is (x+0.5, y+0.5).

export type Tile =
  | '#' // wall
  | '.' // floor
  | 'P' // player start (floor)
  | 'E' // extraction (floor)
  | 'H' // cover crate: walkable, hides you from guard eyes at range
  | 'V' // thermal vent: walkable, paced breathing cools you faster here
  | 'S' // acoustic floor: talking here trips sensors
  | 'D' // relay console: whisper here to throw a decoy
  | 'd' // decoy speaker (floor) the console throws to
  | 'C' // biometric ID checkpoint (floor, holds you for a scan)
  | 'T' // thermal sensor (solid)
  | 'I'; // intel pickup (floor)

export interface Vec {
  x: number;
  y: number;
}

export class Grid {
  readonly w: number;
  readonly h: number;
  private tiles: Tile[][];

  constructor(rows: string[]) {
    this.h = rows.length;
    this.w = rows[0].length;
    this.tiles = rows.map((r) => r.split('') as Tile[]);
  }

  at(x: number, y: number): Tile {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return '#';
    return this.tiles[y][x];
  }

  set(x: number, y: number, t: Tile) {
    this.tiles[y][x] = t;
  }

  walkable(x: number, y: number) {
    const t = this.at(x, y);
    return t !== '#' && t !== 'T';
  }

  blocksSight(x: number, y: number) {
    const t = this.at(x, y);
    return t === '#' || t === 'T';
  }

  find(t: Tile): Vec[] {
    const out: Vec[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (this.tiles[y][x] === t) out.push({ x, y });
    return out;
  }

  /**
   * True if nothing solid lies between two continuous points. The endpoints'
   * own tiles are ignored, so a wall-mounted sensor can see out of its tile.
   */
  lineOfSight(a: Vec, b: Vec): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 0.2);
    const ax = Math.floor(a.x), ay = Math.floor(a.y);
    const bx = Math.floor(b.x), by = Math.floor(b.y);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.floor(a.x + dx * t);
      const y = Math.floor(a.y + dy * t);
      if ((x === ax && y === ay) || (x === bx && y === by)) continue;
      if (this.blocksSight(x, y)) return false;
    }
    return true;
  }

  /** Distance a ray travels before hitting something solid (capped at max). */
  rayLength(from: Vec, angle: number, max: number): number {
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    for (let d = 0; d < max; d += 0.1) {
      if (this.blocksSight(Math.floor(from.x + cx * d), Math.floor(from.y + cy * d))) return d;
    }
    return max;
  }

  /** 4-connected A*. Returns tile path excluding start, or null. */
  path(from: Vec, to: Vec): Vec[] | null {
    if (!this.walkable(to.x, to.y)) return null;
    const key = (x: number, y: number) => y * this.w + x;
    const start = key(from.x, from.y);
    const goal = key(to.x, to.y);
    if (start === goal) return [];
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const open: { k: number; f: number }[] = [{ k: start, f: 0 }];
    const closed = new Set<number>();
    const hx = (k: number) => Math.abs((k % this.w) - to.x) + Math.abs(Math.floor(k / this.w) - to.y);

    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const { k } = open.splice(bi, 1)[0];
      if (k === goal) {
        const out: Vec[] = [];
        let c = k;
        while (c !== start) {
          out.push({ x: c % this.w, y: Math.floor(c / this.w) });
          c = came.get(c)!;
        }
        return out.reverse();
      }
      if (closed.has(k)) continue;
      closed.add(k);
      const x = k % this.w;
      const y = Math.floor(k / this.w);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (!this.walkable(nx, ny)) continue;
        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const ng = g.get(k)! + 1;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          came.set(nk, k);
          open.push({ k: nk, f: ng + hx(nk) });
        }
      }
    }
    return null;
  }

  /** Nearest walkable tile to a continuous point (for sloppy taps). */
  nearestWalkable(p: Vec, radius = 2): Vec | null {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    let best: Vec | null = null;
    let bestD = Infinity;
    for (let y = ty - radius; y <= ty + radius; y++)
      for (let x = tx - radius; x <= tx + radius; x++) {
        if (!this.walkable(x, y)) continue;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    return best;
  }
}

export const centre = (t: Vec): Vec => ({ x: t.x + 0.5, y: t.y + 0.5 });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const tileOf = (p: Vec): Vec => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

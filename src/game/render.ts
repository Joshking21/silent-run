import { PaintStyle, Skia, StrokeCap, createPicture, type SkCanvas, type SkPaint } from '@shopify/react-native-skia';

import type { Grid } from '../engine/grid';
import type { StealthSim } from '../engine/stealthSim';
import { COLORS } from '../ui/theme';

const paintCache = new Map<string, SkPaint>();
/** Cached paints, keyed by colour/style; mutate alpha only via withAlpha(). */
function paint(color: string, stroke = 0): SkPaint {
  const key = `${color}|${stroke}`;
  let p = paintCache.get(key);
  if (!p) {
    p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color(color));
    if (stroke) {
      p.setStyle(PaintStyle.Stroke);
      p.setStrokeWidth(stroke);
      p.setStrokeCap(StrokeCap.Round);
    }
    paintCache.set(key, p);
  }
  return p;
}
const alphaCache = new Map<string, SkPaint>();
/** Paint with alpha quantised to 1/50 steps, cached (no per-frame allocs). */
function withAlpha(color: string, alpha: number, stroke = 0): SkPaint {
  const q = Math.round(Math.max(0, Math.min(1, alpha)) * 50);
  const key = `${color}|${stroke}|${q}`;
  let p = alphaCache.get(key);
  if (!p) {
    p = paint(color, stroke).copy();
    p.setAlphaf(q / 50);
    alphaCache.set(key, p);
  }
  return p;
}

/** Static map layer: drawn once per mission (and when intel is taken). */
export function drawMap(grid: Grid, s: number) {
  return createPicture((c) => {
    c.drawRect(Skia.XYWHRect(0, 0, grid.w * s, grid.h * s), paint(COLORS.bg));
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const t = grid.at(x, y);
        const px = x * s;
        const py = y * s;
        const r = Skia.XYWHRect(px, py, s, s);
        if (t === '#') {
          c.drawRect(r, paint(COLORS.wall));
          // Top-edge highlight on walls bordering floor below, for depth.
          if (grid.at(x, y + 1) !== '#') c.drawRect(Skia.XYWHRect(px, py + s - 3, s, 3), paint(COLORS.wallEdge));
          continue;
        }
        c.drawRect(r, paint(COLORS.floor));
        c.drawRect(Skia.XYWHRect(px + 0.5, py + 0.5, s - 1, s - 1), paint(COLORS.floorLine, 1));
        tileGlyph(c, t, px, py, s);
      }
    }
  }, Skia.XYWHRect(0, 0, grid.w * s, grid.h * s));
}

function tileGlyph(c: SkCanvas, t: string, px: number, py: number, s: number) {
  const cx = px + s / 2;
  const cy = py + s / 2;
  switch (t) {
    case 'H': {
      const r = Skia.RRectXY(Skia.XYWHRect(px + 3, py + 3, s - 6, s - 6), 3, 3);
      c.drawRRect(r, paint(COLORS.cover));
      c.drawLine(px + 5, py + 5, px + s - 5, py + s - 5, paint(COLORS.coverEdge, 1.5));
      c.drawLine(px + s - 5, py + 5, px + 5, py + s - 5, paint(COLORS.coverEdge, 1.5));
      break;
    }
    case 'V':
      c.drawRect(Skia.XYWHRect(px + 2, py + 2, s - 4, s - 4), paint(COLORS.vent));
      for (let i = 1; i <= 3; i++) {
        const yy = py + (s * i) / 4;
        c.drawLine(px + 5, yy, px + s - 5, yy, paint(COLORS.ventLine, 1.5));
      }
      break;
    case 'S':
      c.drawRect(Skia.XYWHRect(px, py, s, s), paint(COLORS.acoustic));
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          c.drawCircle(px + (s * (i + 1)) / 4, py + (s * (j + 1)) / 4, 1.3, paint(COLORS.acousticDot));
      break;
    case 'D': {
      const b = Skia.PathBuilder.Make()
        .moveTo(cx, py + 4)
        .lineTo(px + s - 4, cy)
        .lineTo(cx, py + s - 4)
        .lineTo(px + 4, cy)
        .close()
        .build();
      c.drawPath(b, paint(COLORS.decoy));
      break;
    }
    case 'd':
      c.drawCircle(cx, cy, s * 0.22, paint(COLORS.decoy, 1.5));
      c.drawCircle(cx, cy, s * 0.08, paint(COLORS.decoy));
      break;
    case 'C':
      c.drawRect(Skia.XYWHRect(px + 2, py + 2, s - 4, s - 4), paint(COLORS.checkpoint, 2));
      c.drawLine(px + 6, cy, px + s - 6, cy, paint(COLORS.checkpoint, 1));
      break;
    case 'T': {
      c.drawRect(Skia.XYWHRect(px, py, s, s), paint(COLORS.wall));
      const tri = Skia.PathBuilder.Make()
        .moveTo(cx, py + 5)
        .lineTo(px + s - 5, py + s - 6)
        .lineTo(px + 5, py + s - 6)
        .close()
        .build();
      c.drawPath(tri, paint(COLORS.thermal));
      break;
    }
    case 'I':
      c.drawRect(Skia.XYWHRect(cx - s * 0.18, cy - s * 0.18, s * 0.36, s * 0.36), paint(COLORS.intel));
      break;
    case 'E':
      c.drawRect(Skia.XYWHRect(px + 3, py + 3, s - 6, s - 6), paint(COLORS.exit, 2));
      c.drawCircle(cx, cy, s * 0.12, paint(COLORS.exit));
      break;
  }
}

/** Dynamic layer: everything that moves or reacts to your body. */
export function drawDynamic(sim: StealthSim, s: number, now: number) {
  const W = sim.grid.w * s;
  const H = sim.grid.h * s;
  return createPicture((c) => {
    // Retinal sweeps
    for (const sw of sim.sweeps) {
      const { x, y, w, h } = sw.def;
      const r = Skia.XYWHRect(x * s, y * s, w * s, h * s);
      if (sw.phase === 'warn') {
        const blink = 0.12 + 0.1 * Math.sin(now / 90);
        c.drawRect(r, withAlpha(COLORS.warn, blink));
        c.drawRect(r, withAlpha(COLORS.warn, 0.6, 1.5));
      } else if (sw.phase === 'active') {
        c.drawRect(r, withAlpha(COLORS.danger, 0.18));
        const bx = (x + sw.beam * w) * s;
        c.drawLine(bx, y * s, bx, (y + h) * s, withAlpha(COLORS.danger, 0.95, 3));
        c.drawRect(r, withAlpha(COLORS.danger, 0.8, 1.5));
      } else {
        c.drawRect(r, withAlpha(COLORS.danger, 0.15, 1));
      }
    }

    // Thermal sensor detection radius (grows with your heat)
    if (sim.sensors.length) {
      const rad = sim.sensorRadius * s;
      sim.sensors.forEach((p, i) => {
        const hot = sim.sensorsHot.has(i);
        c.drawCircle(p.x * s, p.y * s, rad, withAlpha(COLORS.thermal, hot ? 0.22 : 0.07));
        c.drawCircle(p.x * s, p.y * s, rad, withAlpha(COLORS.thermal, hot ? 0.9 : 0.35, 1));
      });
    }

    // Decoy ping
    if (sim.decoy && sim.t < sim.decoy.until) {
      const k = 1 - (sim.decoy.until - sim.t) / 2.5;
      c.drawCircle(sim.decoy.pos.x * s, sim.decoy.pos.y * s, s * (0.3 + k * 1.8), withAlpha(COLORS.decoy, 1 - k, 2));
    }

    // Guard vision cones
    for (const g of sim.guards) {
      if (g.cone.length < 3) continue;
      const b = Skia.PathBuilder.Make().moveTo(g.cone[0].x * s, g.cone[0].y * s);
      for (let i = 1; i < g.cone.length; i++) b.lineTo(g.cone[i].x * s, g.cone[i].y * s);
      const cone = b.close().build();
      const alert = g.seesPlayer;
      const investigating = g.state === 'investigate' || g.state === 'look';
      c.drawPath(cone, withAlpha(alert ? COLORS.danger : investigating ? COLORS.warn : COLORS.cone, alert ? 0.32 : 0.16));
    }

    // Player path
    if (sim.playerPath.length) {
      for (const p of sim.playerPath) c.drawCircle((p.x + 0.5) * s, (p.y + 0.5) * s, 2, withAlpha(COLORS.text, 0.4));
    }

    // Player heat aura (thermal signature ring)
    const px = sim.player.x * s;
    const py = sim.player.y * s;
    if (sim.features.has('thermal')) {
      const ar = sim.aura * s;
      c.drawCircle(px, py, ar, withAlpha(COLORS.heat, 0.08 + sim.heat * 0.22));
      c.drawCircle(px, py, ar, withAlpha(COLORS.heat, 0.3 + sim.heat * 0.6, 1.5));
    }

    // Checkpoint scan
    if (sim.scanning) {
      const { tile, progress } = sim.scanning;
      const y = (tile.y + 1 - progress) * s;
      c.drawLine(tile.x * s, y, (tile.x + 1) * s, y, withAlpha(COLORS.checkpoint, 1, 2));
    }

    // Guards
    for (const g of sim.guards) {
      const gx = g.pos.x * s;
      const gy = g.pos.y * s;
      c.drawCircle(gx, gy, s * 0.32, paint(g.seesPlayer ? COLORS.danger : COLORS.guard));
      c.drawLine(gx, gy, gx + Math.cos(g.facing) * s * 0.42, gy + Math.sin(g.facing) * s * 0.42, paint(COLORS.bg, 2.5));
    }

    // Player
    c.drawCircle(px, py, s * 0.3, paint(COLORS.player));
    c.drawCircle(px, py, s * 0.3, paint(sim.playerInCover() ? COLORS.cover : COLORS.bg, 2));

    // Exit pulse
    for (const e of sim.grid.find('E')) {
      const k = (now % 1600) / 1600;
      c.drawCircle((e.x + 0.5) * s, (e.y + 0.5) * s, s * (0.2 + k * 0.5), withAlpha(COLORS.exit, 1 - k, 1.5));
    }
  }, Skia.XYWHRect(0, 0, W, H));
}

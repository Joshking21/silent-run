import { Canvas, PaintStyle, Picture, Skia, StrokeCap, createPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';

import type { SimEvent } from '../engine/stealthSim';
import type { TimelineSample } from '../engine/debrief';
import { COLORS } from './theme';

export const GOOD_KINDS = new Set<SimEvent['kind']>([
  'sweep_evaded',
  'decoy',
  'checkpoint_cleared',
  'vent_cooling',
  'intel',
  'extracted',
]);

export function momentColor(k: SimEvent['kind']) {
  return GOOD_KINDS.has(k) ? COLORS.accent : COLORS.danger;
}

interface Props {
  width: number;
  height: number;
  samples: TimelineSample[];
  moments: SimEvent[];
  duration: number;
}

function mk(color: string, stroke = 0, alpha = 1) {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  p.setAlphaf(alpha);
  if (stroke) {
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(stroke);
    p.setStrokeCap(StrokeCap.Round);
  }
  return p;
}

/**
 * Pressure timeline: HR delta (heat) and breathing rate (blue) as lines,
 * detection as a red area, HRV as a faint green line, and numbered
 * mission moments as markers along the top.
 */
export function TimelineChart({ width, height, samples, moments, duration }: Props) {
  const pic = useMemo(() => {
    const padL = 28;
    const padR = 8;
    const top = 18;
    const bottom = height - 18;
    const plotW = width - padL - padR;
    const T = Math.max(duration, 1);
    const x = (t: number) => padL + (t / T) * plotW;

    const deltas = samples.map((s) => s.hrDelta).filter((d): d is number => d != null);
    const maxD = Math.max(20, ...deltas.map((d) => d + 2));
    const minD = Math.min(-6, ...deltas.map((d) => d - 2));
    const yD = (d: number) => bottom - ((d - minD) / (maxD - minD)) * (bottom - top);

    return createPicture((c) => {
      // Recovery band: within +3 BPM of baseline.
      c.drawRect(Skia.XYWHRect(padL, yD(3), plotW, yD(minD) - yD(3)), mk(COLORS.accent, 0, 0.06));
      // Zero line + grid
      c.drawLine(padL, yD(0), width - padR, yD(0), mk(COLORS.dim, 1));
      for (const g of [10, 20, 30]) if (g < maxD) c.drawLine(padL, yD(g), width - padR, yD(g), mk(COLORS.panelEdge, 1));

      // Detection area (0..1 scaled to plot height)
      if (samples.length > 1) {
        const b = Skia.PathBuilder.Make().moveTo(x(samples[0].t), bottom);
        for (const s of samples) b.lineTo(x(s.t), bottom - s.alarm * (bottom - top));
        b.lineTo(x(samples[samples.length - 1].t), bottom).close();
        c.drawPath(b.build(), mk(COLORS.danger, 0, 0.18));
      }

      const line = (vals: (number | null)[], map: (v: number) => number, color: string, w: number, a = 1) => {
        const b = Skia.PathBuilder.Make();
        let started = false;
        samples.forEach((s, i) => {
          const v = vals[i];
          if (v == null) {
            started = false;
            return;
          }
          if (!started) b.moveTo(x(s.t), map(v));
          else b.lineTo(x(s.t), map(v));
          started = true;
        });
        c.drawPath(b.build(), mk(color, w, a));
      };

      // HRV (scaled into the plot independently), breathing rate, HR delta
      const rm = samples.map((s) => s.rmssd);
      const rmVals = rm.filter((v): v is number => v != null);
      if (rmVals.length > 1) {
        const lo = Math.min(...rmVals) * 0.9;
        const hi = Math.max(...rmVals) * 1.1;
        line(rm, (v) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top), COLORS.accent, 1.5, 0.55);
      }
      const br = samples.map((s) => s.breathRate);
      line(br, (v) => bottom - (Math.min(v, 30) / 30) * (bottom - top), COLORS.breath, 1.5, 0.8);
      line(samples.map((s) => s.hrDelta), yD, COLORS.heat, 2.5);

      // Moment markers
      moments.forEach((m) => {
        const mx = x(m.t);
        c.drawLine(mx, top - 6, mx, bottom, mk(momentColor(m.kind), 1, 0.35));
        c.drawCircle(mx, top - 8, 4, mk(momentColor(m.kind)));
      });

      c.drawRect(Skia.XYWHRect(padL, top, plotW, bottom - top), mk(COLORS.panelEdge, 1));
    }, Skia.XYWHRect(0, 0, width, height));
  }, [width, height, samples, moments, duration]);

  return (
    <Canvas style={{ width, height }}>
      <Picture picture={pic} />
    </Canvas>
  );
}

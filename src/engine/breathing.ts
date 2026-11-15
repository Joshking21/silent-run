// Turns the raw chest breathing trace into phase + cadence for the
// "thermal vent" mechanic (target: 4 s inhale / 6 s exhale).

export const TARGET_INHALE_S = 4;
export const TARGET_EXHALE_S = 6;

/**
 * Which direction of the SDK chest trace means "inhaling". The SDK docs
 * don't state it; flip to -1 if the device test shows the pacer inverted.
 */
export const TRACE_INHALE_SIGN: 1 | -1 = 1;

export interface BreathAnalysis {
  /** Current phase, or null when the trace is too flat/short to tell. */
  phase: 'in' | 'out' | null;
  /** Seconds since the current phase began. */
  phaseElapsed: number;
  /** Most recent completed inhale / exhale durations (s). */
  lastInhale: number | null;
  lastExhale: number | null;
  /** 0..1 — how close recent breaths are to 4 s / 6 s. */
  cadence: number;
}

const EMPTY: BreathAnalysis = {
  phase: null,
  phaseElapsed: 0,
  lastInhale: null,
  lastExhale: null,
  cadence: 0,
};

/**
 * @param values chest trace, oldest→newest
 * @param times  ms timestamps for each value
 * @param fallbackRate SDK breaths/min, used when the trace is unusable
 */
export function analyzeBreathing(
  values: number[],
  times: number[],
  fallbackRate: number | null = null,
): BreathAnalysis {
  if (values.length < 45) return withFallback(EMPTY, fallbackRate);

  // Smooth (moving average of 7 ≈ 0.23 s) and detrend against a 12 s mean
  // (longer than one 10 s target breath, so slow breathing isn't flattened).
  const n = values.length;
  const sm = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) {
      s += values[j];
      c++;
    }
    sm[i] = (s / c) * TRACE_INHALE_SIGN;
  }
  const detr = new Array<number>(n);
  let lo = 0;
  let runSum = 0;
  for (let i = 0; i < n; i++) {
    runSum += sm[i];
    while (times[i] - times[lo] > 12000) runSum -= sm[lo++];
    detr[i] = sm[i] - runSum / (i - lo + 1);
  }

  const mean = detr.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(detr.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (std < 1e-6) return withFallback(EMPTY, fallbackRate);
  const hyst = 0.25 * std;

  // Hysteresis state machine: rising = inhale, falling = exhale. A turn is
  // confirmed once the signal retreats `hyst` from the running extreme, and
  // is timestamped at the extreme itself (the true peak/trough).
  const turns: { t: number; to: 'in' | 'out' }[] = [];
  let phase: 'in' | 'out' | null = null;
  let hi = detr[0];
  let lo2 = detr[0];
  let extreme = detr[0];
  let extremeT = times[0];
  for (let i = 1; i < n; i++) {
    const v = detr[i];
    if (phase === null) {
      hi = Math.max(hi, v);
      lo2 = Math.min(lo2, v);
      if (v > lo2 + hyst) phase = 'in';
      else if (v < hi - hyst) phase = 'out';
      if (phase) {
        extreme = v;
        extremeT = times[i];
      }
    } else if (phase === 'in') {
      if (v > extreme) {
        extreme = v;
        extremeT = times[i];
      } else if (v < extreme - hyst) {
        turns.push({ t: extremeT, to: 'out' });
        phase = 'out';
        extreme = v;
        extremeT = times[i];
      }
    } else {
      if (v < extreme) {
        extreme = v;
        extremeT = times[i];
      } else if (v > extreme + hyst) {
        turns.push({ t: extremeT, to: 'in' });
        phase = 'in';
        extreme = v;
        extremeT = times[i];
      }
    }
  }

  let lastInhale: number | null = null;
  let lastExhale: number | null = null;
  for (let i = turns.length - 1; i > 0; i--) {
    const dur = (turns[i].t - turns[i - 1].t) / 1000;
    if (turns[i - 1].to === 'in' && lastInhale == null) lastInhale = dur;
    if (turns[i - 1].to === 'out' && lastExhale == null) lastExhale = dur;
    if (lastInhale != null && lastExhale != null) break;
  }
  const phaseStart = turns.length ? turns[turns.length - 1].t : times[0];
  const phaseElapsed = (times[n - 1] - phaseStart) / 1000;

  let cadence = 0;
  if (lastInhale != null && lastExhale != null) {
    const e = (lastInhale - TARGET_INHALE_S) ** 2 + (lastExhale - TARGET_EXHALE_S) ** 2;
    cadence = Math.exp(-e / (2 * 1.6 ** 2));
  }
  // An in-progress phase running long is still slow breathing: don't punish
  // someone mid-way through a good 6 s exhale.
  const result: BreathAnalysis = { phase, phaseElapsed, lastInhale, lastExhale, cadence };
  return cadence > 0 ? result : withFallback(result, fallbackRate);
}

/** Without a usable trace, reward slow breathing (≈6/min) from the SDK rate. */
function withFallback(a: BreathAnalysis, rate: number | null): BreathAnalysis {
  if (rate == null) return a;
  const cadence = Math.exp(-((rate - 6) ** 2) / (2 * 2.5 ** 2));
  return { ...a, cadence: Math.max(a.cadence, cadence) };
}

/** Where the 4/6 pacer is at time t (s): phase and 0..1 progress within it. */
export function pacerAt(tSeconds: number): { phase: 'in' | 'out'; progress: number } {
  const cycle = TARGET_INHALE_S + TARGET_EXHALE_S;
  const p = ((tSeconds % cycle) + cycle) % cycle;
  return p < TARGET_INHALE_S
    ? { phase: 'in', progress: p / TARGET_INHALE_S }
    : { phase: 'out', progress: (p - TARGET_INHALE_S) / TARGET_EXHALE_S };
}

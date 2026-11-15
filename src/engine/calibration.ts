import type { SignalState } from '../signals/signalStore';

export interface Baseline {
  hr: number;
  /** Null if the SDK produced no HRV in the window; game falls back to HR only. */
  rmssd: number | null;
  breathRate: number | null;
  /** Spontaneous blinks per minute at rest; sizes retinal-sweep fairness. */
  blinkRate: number;
  capturedAt: number;
}

export interface CalibrationProgress {
  /** 0..1 of valid (well-framed) time collected. */
  progress: number;
  validMs: number;
  pulseSamples: number;
  hrvSamples: number;
  breathSamples: number;
  blinks: number;
  /** Why we can't finish yet, if the timer is up but data is thin. */
  waitingFor: string | null;
}

export const CALIBRATION_MS = 20_000;
const MIN_PULSE_SAMPLES = 8;
const MIN_BREATH_SAMPLES = 2;
/** Give up waiting for HRV/breathing this long past the timer. */
const GRACE_MS = 10_000;

/**
 * Feed it every store update (store.subscribeRaw). Only time with valid
 * framing counts, so a face drifting out of shot just pauses the lock.
 */
export class Calibrator {
  private validMs = 0;
  private lastT = 0;
  private pulses: number[] = [];
  private hrvs: number[] = [];
  private breaths: number[] = [];
  private blinks = 0;
  private wasBlinking = false;
  private seen = { pulse: 0, hrv: 0, breath: 0 };

  update(s: SignalState, now = Date.now()): CalibrationProgress {
    if (this.lastT && s.signalValid) this.validMs += now - this.lastT;
    this.lastT = now;

    if (s.signalValid) {
      if (s.pulseRate != null && s.pulseAt !== this.seen.pulse) {
        this.seen.pulse = s.pulseAt;
        this.pulses.push(s.pulseRate);
      }
      if (s.hrvRmssd != null && s.hrvAt !== this.seen.hrv) {
        this.seen.hrv = s.hrvAt;
        this.hrvs.push(s.hrvRmssd);
      }
      if (s.breathingRate != null && s.breathingAt !== this.seen.breath) {
        this.seen.breath = s.breathingAt;
        this.breaths.push(s.breathingRate);
      }
      if (s.isBlinking && !this.wasBlinking) this.blinks++;
      this.wasBlinking = s.isBlinking;
    }
    return this.progress();
  }

  progress(): CalibrationProgress {
    const timerDone = this.validMs >= CALIBRATION_MS;
    let waitingFor: string | null = null;
    if (timerDone) {
      const inGrace = this.validMs < CALIBRATION_MS + GRACE_MS;
      if (this.pulses.length < MIN_PULSE_SAMPLES) waitingFor = 'pulse';
      else if (inGrace && this.breaths.length < MIN_BREATH_SAMPLES) waitingFor = 'breathing';
    }
    return {
      progress: Math.min(1, this.validMs / CALIBRATION_MS),
      validMs: this.validMs,
      pulseSamples: this.pulses.length,
      hrvSamples: this.hrvs.length,
      breathSamples: this.breaths.length,
      blinks: this.blinks,
      waitingFor,
    };
  }

  isComplete() {
    const p = this.progress();
    return p.progress >= 1 && p.waitingFor === null;
  }

  result(now = Date.now()): Baseline {
    const minutes = Math.max(this.validMs / 60000, 1 / 60);
    return {
      hr: median(this.pulses) ?? 72,
      rmssd: this.hrvs.length ? median(this.hrvs) : null,
      breathRate: this.breaths.length ? median(this.breaths) : null,
      blinkRate: this.blinks / minutes,
      capturedAt: now,
    };
  }
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// --- personal deltas: every threshold in the game goes through these --------

/** BPM above personal baseline (negative = calmer than rest). */
export function hrDelta(b: Baseline, s: SignalState): number {
  return s.pulseRate == null ? 0 : s.pulseRate - b.hr;
}

/**
 * Composure 0..1 from HRV relative to baseline: 1 = at/above resting RMSSD,
 * 0 = at half of it or lower. Returns 1 (neutral) when HRV is unavailable,
 * so missing HRV never punishes the player.
 */
export function composure(b: Baseline, s: SignalState): number {
  if (b.rmssd == null || s.hrvRmssd == null) return 1;
  const ratio = s.hrvRmssd / b.rmssd;
  return Math.max(0, Math.min(1, (ratio - 0.5) / 0.5));
}

import { analyzeBreathing, type BreathAnalysis } from '../engine/breathing';
import { composure, hrDelta, type Baseline } from '../engine/calibration';
import type { BioInput } from '../engine/stealthSim';
import { LiveSource } from '../signals/liveSource';
import { signalStore } from '../signals/signalStore';

const BREATH_INTERVAL_MS = 250;

/** Builds the sim's per-frame BioInput from the signal store + baseline. */
export class BioReader {
  private breath: BreathAnalysis = {
    phase: null,
    phaseElapsed: 0,
    lastInhale: null,
    lastExhale: null,
    cadence: 0,
  };
  private breathAt = 0;

  constructor(private baseline: Baseline) {}

  read(now = Date.now()): BioInput {
    const s = signalStore.get();
    if (now - this.breathAt >= BREATH_INTERVAL_MS) {
      this.breathAt = now;
      const { values, times } = signalStore.getTrace();
      this.breath = analyzeBreathing(values, times, s.breathingRate);
    }
    const src = signalStore.getSource();
    const faceAvailable = src instanceof LiveSource ? src.hasFaceMetrics : true;
    return {
      signalValid: s.signalValid,
      hrDelta: hrDelta(this.baseline, s),
      composure: composure(this.baseline, s),
      isTalking: s.isTalking,
      blinkCount: s.blinkCount,
      expression: s.expression,
      expressionConfidence: s.expressionConfidence,
      breath: this.breath,
      faceAvailable,
    };
  }

  /** Values for the debrief timeline (null when no reading yet). */
  timelineValues() {
    const s = signalStore.get();
    return {
      hrDelta: s.pulseRate != null ? s.pulseRate - this.baseline.hr : null,
      rmssd: s.hrvRmssd,
      breathRate: s.breathingRate,
    };
  }

  get lastBreath() {
    return this.breath;
  }
}

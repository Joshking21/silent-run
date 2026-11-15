import { SignalEmitter } from './emitter';
import type { Expression, QualityCode, SignalListeners, SignalSource } from './types';

/**
 * Synthetic physiology for developing without a camera.
 *
 * Not random noise: arousal follows a target with asymmetric lag (fast-ish
 * rise, slow decay, like real adrenaline), pulse/HRV/breathing derive from
 * arousal, the breathing trace is a phase oscillator, and blinks are Poisson.
 * Dev controls let you drive it (stress spikes, talking, held breath, bad
 * framing) so game thresholds can be tuned before touching the device.
 */
export interface MockControls {
  /** 0..1 target arousal. Game or dev panel can poke this. */
  setStress(target: number): void;
  /** Momentary spike, e.g. simulate a guard catching sight of you. */
  spike(amount?: number): void;
  setTalking(on: boolean): void;
  blinkNow(): void;
  setExpression(e: Expression): void;
  setQuality(code: QualityCode): void;
  /**
   * Manual breathing: while enabled, `setInhaling(true)` raises the chest
   * trace and `false` lowers it. Lets you rehearse the 4s/6s cooling cadence.
   */
  setManualBreathing(on: boolean): void;
  setInhaling(on: boolean): void;
}

export interface MockProfile {
  baseHR: number;
  baseRMSSD: number;
  baseBreathRate: number;
  /** Mean seconds between spontaneous blinks. */
  blinkInterval: number;
}

const DEFAULT_PROFILE: MockProfile = {
  baseHR: 72,
  baseRMSSD: 42,
  baseBreathRate: 13,
  blinkInterval: 4,
};

const TICK_MS = 33; // ~30 Hz, matching the SDK's frame-driven cadence
const RISE_TAU = 3.5; // seconds
const DECAY_TAU = 9; // seconds

export class MockSource implements SignalSource, MockControls {
  readonly kind = 'mock' as const;
  private emitter = new SignalEmitter();
  private timer: ReturnType<typeof setInterval> | null = null;
  private profile: MockProfile;

  // dynamic state
  private targetStress = 0;
  private arousal = 0;
  private breathPhase = 0;
  private chest = 0;
  private manualBreathing = false;
  private inhaling = false;
  private talking = false;
  private blinkUntil = 0;
  private nextBlinkAt = 0;
  private blinkCount = 0;
  private wasBlinking = false;
  private expression: Expression = 'NEUTRAL';
  private quality: QualityCode = 'OK';
  private startedAt = 0;
  private lastTick = 0;
  private lastVitalsAt = 0;
  private lastHrvAt = 0;
  private lastBreathRateAt = 0;
  private traceBuf: number[] = [];
  private lastFastKey = '';
  private lastFastAt = 0;
  private manualCrossings: number[] = [];
  private lastManualSign = 0;

  constructor(profile: Partial<MockProfile> = {}) {
    this.profile = { ...DEFAULT_PROFILE, ...profile };
  }

  subscribe(l: SignalListeners) {
    return this.emitter.subscribe(l);
  }

  async start() {
    if (this.timer) return;
    const now = Date.now();
    this.startedAt = now;
    this.lastTick = now;
    this.blinkCount = 0;
    this.scheduleBlink(now);
    this.emitStatus('STARTING');
    this.timer = setInterval(() => this.tick(), TICK_MS);
    setTimeout(() => this.emitStatus('RUNNING'), 400);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emitStatus('IDLE');
  }

  // --- controls -----------------------------------------------------------
  setStress(target: number) {
    this.targetStress = clamp(target, 0, 1);
  }
  spike(amount = 0.6) {
    this.arousal = clamp(this.arousal + amount * 0.35, 0, 1);
    this.targetStress = clamp(Math.max(this.targetStress, amount), 0, 1);
    // A spike's target relaxes back after a few seconds, the arousal lags it.
    setTimeout(() => {
      this.targetStress = Math.max(0, this.targetStress - amount);
    }, 3000);
  }
  setTalking(on: boolean) {
    this.talking = on;
  }
  blinkNow() {
    this.blinkUntil = Date.now() + 160;
  }
  setExpression(e: Expression) {
    this.expression = e;
  }
  setQuality(code: QualityCode) {
    this.quality = code;
    this.emitStatus(this.timer ? 'RUNNING' : 'IDLE');
  }
  setManualBreathing(on: boolean) {
    this.manualBreathing = on;
    this.manualCrossings = [];
  }
  setInhaling(on: boolean) {
    this.inhaling = on;
  }

  // --- simulation ---------------------------------------------------------
  private tick() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    const valid = this.quality === 'OK';

    // Asymmetric first-order lag toward target.
    const tau = this.targetStress > this.arousal ? RISE_TAU : DECAY_TAU;
    this.arousal += (this.targetStress - this.arousal) * (1 - Math.exp(-dt / tau));

    // Breathing trace.
    if (this.manualBreathing) {
      const target = this.inhaling ? 1 : -1;
      this.chest += (target - this.chest) * (1 - Math.exp(-dt / 0.8));
      const sign = Math.sign(this.chest);
      if (sign > 0 && this.lastManualSign <= 0) this.manualCrossings.push(now);
      this.lastManualSign = sign;
      this.manualCrossings = this.manualCrossings.filter((c) => now - c < 60000);
    } else {
      const rate = this.profile.baseBreathRate + 7 * this.arousal; // bpm
      this.breathPhase += (2 * Math.PI * rate * dt) / 60;
      this.chest = Math.sin(this.breathPhase);
    }
    if (valid) this.traceBuf.push(this.chest + gauss() * 0.04);

    // Blinks.
    if (now >= this.nextBlinkAt) {
      // Stress raises blink rate a little.
      this.blinkUntil = now + 150;
      this.scheduleBlink(now);
    }
    const blinking = now < this.blinkUntil;

    if (!valid) return; // the real SDK goes quiet on bad frames too

    if (blinking && !this.wasBlinking) this.blinkCount++;
    this.wasBlinking = blinking;

    // Fast signals: on change, or 10 Hz heartbeat.
    const key = `${blinking}|${this.talking}|${this.expression}`;
    if (key !== this.lastFastKey || now - this.lastFastAt >= 100) {
      this.lastFastKey = key;
      this.lastFastAt = now;
      this.emitter.fast({
        isBlinking: blinking,
        isTalking: this.talking,
        expression: this.expression,
        expressionConfidence: 70 + Math.random() * 25,
        blinkCount: this.blinkCount,
        t: now,
      });
    }

    // Trace batches at ~10 Hz.
    if (this.traceBuf.length >= 3) {
      this.emitter.trace({ chest: this.traceBuf, t: now });
      this.traceBuf = [];
    }

    // Vitals: pulse ~1 Hz, HRV every 2 s after 10 s warm-up, breathing rate every 3 s.
    const sinceStart = (now - this.startedAt) / 1000;
    if (sinceStart < 3) return;
    const pulseDue = now - this.lastVitalsAt >= 1000;
    const hrvDue = sinceStart > 10 && now - this.lastHrvAt >= 2000;
    const brDue = sinceStart > 6 && now - this.lastBreathRateAt >= 3000;
    if (pulseDue || hrvDue || brDue) {
      const p = this.profile;
      const pulse = p.baseHR + 26 * this.arousal + gauss() * 1.2;
      const rmssd = Math.max(8, p.baseRMSSD * (1 - 0.55 * this.arousal) + gauss() * 3);
      const br = this.manualBreathing
        ? this.manualCrossings.length > 1
          ? (this.manualCrossings.length - 1) /
            ((now - this.manualCrossings[0]) / 60000)
          : null
        : p.baseBreathRate + 7 * this.arousal + gauss() * 0.4;
      if (pulseDue) this.lastVitalsAt = now;
      if (hrvDue) this.lastHrvAt = now;
      if (brDue) this.lastBreathRateAt = now;
      this.emitter.vitals({
        pulseRate: pulseDue ? round1(pulse) : null,
        hrvRmssd: hrvDue ? round1(rmssd) : null,
        hrvStable: sinceStart > 20,
        breathingRate: brDue && br != null ? round1(br) : null,
        t: now,
      });
    }
  }

  private scheduleBlink(now: number) {
    const mean = this.profile.blinkInterval * (1 - 0.35 * this.arousal);
    this.nextBlinkAt = now + -Math.log(1 - Math.random()) * mean * 1000 + 200;
  }

  private emitStatus(processing: 'IDLE' | 'STARTING' | 'RUNNING') {
    this.emitter.status({
      processing,
      quality: this.quality,
      hint: this.quality === 'OK' ? '' : `Mock: ${this.quality}`,
      t: Date.now(),
    });
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function round1(v: number) {
  return Math.round(v * 10) / 10;
}
/** Standard normal via Box–Muller. */
function gauss() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

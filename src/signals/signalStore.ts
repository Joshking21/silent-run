import type {
  ErrorEvent,
  Expression,
  ProcessingStatus,
  QualityCode,
  SignalSource,
  SourceKind,
} from './types';

/**
 * Latest-known biometric state. Rate metrics are *retained*: the SDK emits
 * payloads without a new pulse/breathing sample between physiological events,
 * so we never overwrite a value with null (per SmartSpectra metrics docs).
 */
export interface SignalState {
  source: SourceKind | null;
  processing: ProcessingStatus;
  quality: QualityCode;
  hint: string;
  /** True when hazards may read signals: running + OK framing (debounced). */
  signalValid: boolean;

  isBlinking: boolean;
  isTalking: boolean;
  expression: Expression;
  expressionConfidence: number;
  blinkCount: number;
  fastAt: number;

  pulseRate: number | null;
  pulseAt: number;
  hrvRmssd: number | null;
  hrvStable: boolean;
  hrvAt: number;
  breathingRate: number | null;
  breathingAt: number;

  lastError: ErrorEvent | null;
}

const INITIAL: SignalState = {
  source: null,
  processing: 'IDLE',
  quality: 'UNKNOWN',
  hint: '',
  signalValid: false,
  isBlinking: false,
  isTalking: false,
  expression: 'UNKNOWN',
  expressionConfidence: 0,
  blinkCount: 0,
  fastAt: 0,
  pulseRate: null,
  pulseAt: 0,
  hrvRmssd: null,
  hrvStable: false,
  hrvAt: 0,
  breathingRate: null,
  breathingAt: 0,
  lastError: null,
};

/** Framing must be OK this long before hazards resume (avoids flicker). */
const VALID_DEBOUNCE_MS = 600;
/** ~30 s of chest trace at ~30 Hz: ≥2 full 10 s breaths for cadence. */
const TRACE_CAPACITY = 900;
/** React subscribers are notified at most this often. */
const NOTIFY_INTERVAL_MS = 100;

class SignalStore {
  private state: SignalState = { ...INITIAL };
  private source: SignalSource | null = null;
  private unsub: (() => void) | null = null;
  private subs = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private okSince = 0;
  private validTimer: ReturnType<typeof setTimeout> | null = null;

  // Chest trace ring buffer, read directly by the game loop / HUD canvas.
  private trace = new Float32Array(TRACE_CAPACITY);
  private traceTimes = new Float64Array(TRACE_CAPACITY);
  private traceHead = 0;
  private traceCount = 0;

  /** Raw listeners for high-frequency consumers (debrief logger, game). */
  private rawSubs = new Set<(s: SignalState) => void>();

  get = () => this.state;

  /** React: useSyncExternalStore(store.subscribe, store.get). Throttled. */
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  /** Unthrottled; called synchronously on every update. */
  subscribeRaw(fn: (s: SignalState) => void) {
    this.rawSubs.add(fn);
    return () => {
      this.rawSubs.delete(fn);
    };
  }

  /** Copy of the chest trace, oldest→newest. */
  getTrace(maxSamples = TRACE_CAPACITY): { values: number[]; times: number[] } {
    const n = Math.min(maxSamples, this.traceCount);
    const values: number[] = new Array(n);
    const times: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = (this.traceHead - n + i + TRACE_CAPACITY) % TRACE_CAPACITY;
      values[i] = this.trace[idx];
      times[i] = this.traceTimes[idx];
    }
    return { values, times };
  }

  async attach(source: SignalSource) {
    await this.detach();
    this.source = source;
    this.state = { ...INITIAL, source: source.kind };
    this.traceCount = 0;
    this.traceHead = 0;
    this.unsub = source.subscribe({
      onFastSignals: (e) =>
        this.patch({
          isBlinking: e.isBlinking,
          isTalking: e.isTalking,
          expression: e.expression,
          expressionConfidence: e.expressionConfidence,
          blinkCount: e.blinkCount,
          fastAt: e.t,
        }),
      onVitals: (e) => {
        const p: Partial<SignalState> = {};
        if (e.pulseRate != null && e.pulseRate > 0) {
          p.pulseRate = e.pulseRate;
          p.pulseAt = e.t;
        }
        if (e.hrvRmssd != null && e.hrvRmssd > 0) {
          p.hrvRmssd = e.hrvRmssd;
          p.hrvStable = e.hrvStable;
          p.hrvAt = e.t;
        }
        if (e.breathingRate != null && e.breathingRate > 0) {
          p.breathingRate = e.breathingRate;
          p.breathingAt = e.t;
        }
        if (Object.keys(p).length) this.patch(p);
      },
      onTrace: (e) => {
        const n = e.chest.length;
        // Spread batch samples evenly over the ~100 ms window they arrived in.
        for (let i = 0; i < n; i++) {
          this.trace[this.traceHead] = e.chest[i];
          this.traceTimes[this.traceHead] = e.t - (n - 1 - i) * 33;
          this.traceHead = (this.traceHead + 1) % TRACE_CAPACITY;
          if (this.traceCount < TRACE_CAPACITY) this.traceCount++;
        }
      },
      onStatus: (e) => {
        if (__DEV__ && (e.processing !== this.state.processing || e.quality !== this.state.quality)) {
          console.log(`[signal] status ${e.processing} ${e.quality} ${e.hint ?? ''}`);
        }
        this.patch({ processing: e.processing, quality: e.quality, hint: e.hint });
        this.updateValidity();
      },
      onError: (e) => {
        if (__DEV__) console.warn(`[signal] error ${e.code}: ${e.message}`);
        this.patch({ lastError: e });
      },
    });
    await source.start();
  }

  async detach() {
    this.unsub?.();
    this.unsub = null;
    if (this.source) await this.source.stop();
    this.source = null;
    if (this.validTimer) clearTimeout(this.validTimer);
    this.patch({ ...INITIAL });
  }

  getSource() {
    return this.source;
  }

  private updateValidity() {
    const { processing, quality } = this.state;
    const ok = processing === 'RUNNING' && quality === 'OK';
    if (this.validTimer) clearTimeout(this.validTimer);
    if (!ok) {
      this.okSince = 0;
      if (this.state.signalValid) this.patch({ signalValid: false });
      return;
    }
    if (!this.okSince) this.okSince = Date.now();
    const wait = VALID_DEBOUNCE_MS - (Date.now() - this.okSince);
    if (wait <= 0) {
      if (!this.state.signalValid) this.patch({ signalValid: true });
    } else {
      this.validTimer = setTimeout(() => this.updateValidity(), wait);
    }
  }

  private patch(p: Partial<SignalState>) {
    this.state = { ...this.state, ...p };
    this.rawSubs.forEach((fn) => fn(this.state));
    if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => {
        this.notifyTimer = null;
        this.subs.forEach((fn) => fn());
      }, NOTIFY_INTERVAL_MS);
    }
  }
}

export const signalStore = new SignalStore();

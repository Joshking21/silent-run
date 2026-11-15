import type {
  ErrorEvent,
  FastSignals,
  SignalListeners,
  StatusEvent,
  TraceBatch,
  Vitals,
} from './types';

/** Minimal fan-out used by the JS-side sources (mock, replay). */
export class SignalEmitter {
  private listeners = new Set<SignalListeners>();

  subscribe(l: SignalListeners): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  fast(e: FastSignals) {
    this.listeners.forEach((l) => l.onFastSignals?.(e));
  }
  vitals(e: Vitals) {
    this.listeners.forEach((l) => l.onVitals?.(e));
  }
  trace(e: TraceBatch) {
    this.listeners.forEach((l) => l.onTrace?.(e));
  }
  status(e: StatusEvent) {
    this.listeners.forEach((l) => l.onStatus?.(e));
  }
  error(e: ErrorEvent) {
    this.listeners.forEach((l) => l.onError?.(e));
  }
}

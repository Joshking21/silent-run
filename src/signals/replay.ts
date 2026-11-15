import { SignalEmitter } from './emitter';
import type {
  ErrorEvent,
  FastSignals,
  SignalListeners,
  SignalSource,
  StatusEvent,
  TraceBatch,
  Vitals,
} from './types';

type RecordedEvent =
  | { dt: number; type: 'fast'; e: FastSignals }
  | { dt: number; type: 'vitals'; e: Vitals }
  | { dt: number; type: 'trace'; e: TraceBatch }
  | { dt: number; type: 'status'; e: StatusEvent }
  | { dt: number; type: 'error'; e: ErrorEvent };

export interface Recording {
  version: 1;
  /** Source the recording came from, e.g. "live" on the Infinix. */
  source: string;
  recordedAt: string;
  durationMs: number;
  events: RecordedEvent[];
}

/**
 * Taps any SignalSource and captures its events with relative timestamps.
 * Recordings stay on the device; nothing here touches the network.
 */
export class Recorder {
  private events: RecordedEvent[] = [];
  private t0 = 0;
  private unsub: (() => void) | null = null;

  constructor(private source: SignalSource) {}

  begin() {
    this.events = [];
    this.t0 = Date.now();
    const at = () => Date.now() - this.t0;
    this.unsub = this.source.subscribe({
      onFastSignals: (e) => this.events.push({ dt: at(), type: 'fast', e }),
      onVitals: (e) => this.events.push({ dt: at(), type: 'vitals', e }),
      onTrace: (e) => this.events.push({ dt: at(), type: 'trace', e }),
      onStatus: (e) => this.events.push({ dt: at(), type: 'status', e }),
      onError: (e) => this.events.push({ dt: at(), type: 'error', e }),
    });
  }

  end(): Recording {
    this.unsub?.();
    this.unsub = null;
    return {
      version: 1,
      source: this.source.kind,
      recordedAt: new Date(this.t0).toISOString(),
      durationMs: Date.now() - this.t0,
      events: this.events,
    };
  }
}

/** Plays a Recording back in real time, rewriting timestamps to "now". */
export class ReplaySource implements SignalSource {
  readonly kind = 'replay' as const;
  private emitter = new SignalEmitter();
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private recording: Recording,
    private opts: { loop?: boolean } = {},
  ) {}

  subscribe(l: SignalListeners) {
    return this.emitter.subscribe(l);
  }

  async start() {
    this.schedule();
  }

  async stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private schedule() {
    const { events, durationMs } = this.recording;
    for (const ev of events) {
      this.timers.push(
        setTimeout(() => {
          const t = Date.now();
          switch (ev.type) {
            case 'fast':
              return this.emitter.fast({ ...ev.e, t });
            case 'vitals':
              return this.emitter.vitals({ ...ev.e, t });
            case 'trace':
              return this.emitter.trace({ ...ev.e, t });
            case 'status':
              return this.emitter.status({ ...ev.e, t });
            case 'error':
              return this.emitter.error(ev.e);
          }
        }, ev.dt),
      );
    }
    if (this.opts.loop) {
      this.timers.push(setTimeout(() => this.schedule(), durationMs + 50));
    }
  }
}

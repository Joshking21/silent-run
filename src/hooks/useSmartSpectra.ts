import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { isNativeAvailable } from '../../modules/smartspectra-bridge';
import { LiveSource } from '../signals/liveSource';
import { MockSource } from '../signals/mockSource';
import { ReplaySource, type Recording } from '../signals/replay';
import { signalStore, type SignalState } from '../signals/signalStore';
import type { SignalSource, SourceKind } from '../signals/types';

/** Throttled (~10 Hz) React view of the signal store. */
export function useSignals(): SignalState {
  return useSyncExternalStore(signalStore.subscribe, signalStore.get);
}

export interface UseSmartSpectra {
  state: SignalState;
  kind: SourceKind | null;
  running: boolean;
  error: string | null;
  /** The mock, when active, so dev panels can drive it. */
  mock: MockSource | null;
  start(kind: SourceKind, recording?: Recording): Promise<void>;
  stop(): Promise<void>;
}

/** Default source: live on a dev build with the module, mock otherwise. */
export const defaultSourceKind: SourceKind = isNativeAvailable ? 'live' : 'mock';

/**
 * Owns the active signal source. Also enforces "camera only while visible":
 * backgrounding stops the source (the native side stops the SDK too), and
 * returning restarts it.
 */
export function useSmartSpectra(): UseSmartSpectra {
  const state = useSignals();
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mock, setMock] = useState<MockSource | null>(null);
  const resume = useRef<{ kind: SourceKind; recording?: Recording } | null>(null);

  const start = useCallback(async (k: SourceKind, recording?: Recording) => {
    setError(null);
    let source: SignalSource;
    if (k === 'live') source = new LiveSource();
    else if (k === 'replay') {
      if (!recording) throw new Error('Replay needs a recording');
      source = new ReplaySource(recording, { loop: true });
    } else source = new MockSource();
    try {
      await signalStore.attach(source);
      resume.current = { kind: k, recording };
      setKind(k);
      setMock(source instanceof MockSource ? source : null);
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await signalStore.detach();
      setRunning(false);
    }
  }, []);

  const stop = useCallback(async () => {
    resume.current = null;
    await signalStore.detach();
    setRunning(false);
    setKind(null);
    setMock(null);
  }, []);

  useEffect(() => {
    let paused: { kind: SourceKind; recording?: Recording } | null = null;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && resume.current) {
        paused = resume.current;
        void signalStore.detach();
        setRunning(false);
      } else if (s === 'active' && paused) {
        const p = paused;
        paused = null;
        void start(p.kind, p.recording);
      }
    });
    return () => sub.remove();
  }, [start]);

  return { state, kind, running, error, mock, start, stop };
}

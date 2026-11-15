import type { EventSubscription } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

import { SmartSpectraBridge, type ConfigureOptions } from '../../modules/smartspectra-bridge';
import { SignalEmitter } from './emitter';
import type { SignalListeners, SignalSource } from './types';

export class LiveSourceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Real SmartSpectra data from the front camera via the native bridge. */
export class LiveSource implements SignalSource {
  readonly kind = 'live' as const;
  private emitter = new SignalEmitter();
  private subs: EventSubscription[] = [];
  private faceMetricsEnabled: boolean;

  constructor(private options: ConfigureOptions = {}) {
    this.faceMetricsEnabled = options.faceMetrics ?? true;
  }

  /** False if the key isn't authorised for face metrics and we fell back. */
  get hasFaceMetrics() {
    return this.faceMetricsEnabled;
  }

  subscribe(l: SignalListeners) {
    return this.emitter.subscribe(l);
  }

  async start() {
    const native = SmartSpectraBridge;
    if (!native) {
      throw new LiveSourceError('E_NO_NATIVE', 'SmartSpectra native module is not in this build.');
    }
    if (!native.isApiKeyConfigured()) {
      throw new LiveSourceError('E_NO_API_KEY', 'Add PRESAGE_API_KEY to .env and rebuild.');
    }
    await ensureCameraPermission();

    this.subs = [
      native.addListener('onFastSignals', (e) => this.emitter.fast(e)),
      native.addListener('onVitals', (e) => this.emitter.vitals(e)),
      native.addListener('onTrace', (e) => this.emitter.trace(e)),
      native.addListener('onStatus', (e) => this.emitter.status(e)),
      native.addListener('onError', (e) => this.emitter.error(e)),
    ];

    await native.configure({ ...this.options, faceMetrics: this.faceMetricsEnabled });
    try {
      await native.start();
    } catch (err) {
      // Face metrics need a face-enabled key. Fall back to vitals-only rather
      // than failing the whole session; the game disables face hazards.
      if (errCode(err) === 'E_METRIC_NOT_AUTHORIZED' && this.faceMetricsEnabled) {
        this.faceMetricsEnabled = false;
        await native.configure({ ...this.options, faceMetrics: false });
        await native.start();
        return;
      }
      this.removeSubs();
      throw err;
    }
  }

  async stop() {
    await SmartSpectraBridge?.stop();
    this.removeSubs();
  }

  private removeSubs() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }
}

async function ensureCameraPermission() {
  if (Platform.OS !== 'android') return;
  const perm = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (await PermissionsAndroid.check(perm)) return;
  const result = await PermissionsAndroid.request(perm);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new LiveSourceError('E_CAMERA_DENIED', 'Camera permission was not granted.');
  }
}

function errCode(err: unknown): string | undefined {
  return typeof err === 'object' && err && 'code' in err ? String(err.code) : undefined;
}

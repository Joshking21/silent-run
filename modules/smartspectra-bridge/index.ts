import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

import type {
  ErrorEvent,
  FastSignals,
  StatusEvent,
  TraceBatch,
  Vitals,
} from '../../src/signals/types';

export interface ConfigureOptions {
  /** Blinking / talking / expressions. Needs a face-enabled Presage key. */
  faceMetrics?: boolean;
  /** Pulse / HRV. */
  cardioMetrics?: boolean;
}

export interface DeviceReadiness {
  verdict: 'READY' | 'LIMITED' | 'BLOCKED' | 'INCONCLUSIVE';
  reason: string;
}

type Events = {
  onFastSignals: (e: FastSignals) => void;
  onVitals: (e: Vitals) => void;
  onTrace: (e: TraceBatch) => void;
  onStatus: (e: StatusEvent) => void;
  onError: (e: ErrorEvent) => void;
};

export interface SmartSpectraBridgeModule {
  isApiKeyConfigured(): boolean;
  getSdkVersion(): string;
  configure(options: ConfigureOptions): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  checkDeviceReadiness(): Promise<DeviceReadiness>;
  addListener<K extends keyof Events>(event: K, listener: Events[K]): EventSubscription;
}

/** Null when the native module isn't compiled in (Expo Go, web, old build). */
export const SmartSpectraBridge =
  requireOptionalNativeModule<SmartSpectraBridgeModule>('SmartSpectraBridge');

export const isNativeAvailable = SmartSpectraBridge != null;

/** Live front-camera preview. Mount it before starting the SDK. */
export const SmartSpectraPreview: React.ComponentType<ViewProps> | null = isNativeAvailable
  ? requireNativeViewManager<ViewProps>('SmartSpectraBridge')
  : null;

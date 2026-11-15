// Shared signal contract between the native SmartSpectra bridge, the mock
// source and the replay source. Everything downstream (calibration, game,
// debrief) reads only these shapes, so it never knows which source is live.

/** Mirrors SmartSpectra's ValidationCode enum (Android SDK 3.5). */
export type QualityCode =
  | 'OK'
  | 'NO_FACE_FOUND'
  | 'MULTIPLE_FACES_FOUND'
  | 'FACE_NOT_CENTERED'
  | 'FACE_SIZE_OUT_OF_RANGE'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'CHEST_NOT_VISIBLE'
  | 'CAMERA_TUNING'
  | 'FRAME_RATE_TOO_LOW'
  | 'EXCESSIVE_MOTION'
  | 'FACE_TOO_CLOSE'
  | 'FACE_TOO_FAR'
  | 'FACE_TOO_HIGH'
  | 'FACE_TOO_LOW'
  | 'FACE_NOT_FORWARD'
  | 'UNKNOWN';

export type Expression =
  | 'NEUTRAL'
  | 'HAPPY'
  | 'SAD'
  | 'ANGRY'
  | 'FEAR'
  | 'SURPRISE'
  | 'DISGUST'
  | 'CONTEMPT'
  | 'UNKNOWN';

export type ProcessingStatus = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR';

/** Frame-driven signals, emitted on change or at most ~10 Hz. */
export interface FastSignals {
  isBlinking: boolean;
  isTalking: boolean;
  expression: Expression;
  /** 0–100, confidence of the top expression score. */
  expressionConfidence: number;
  /**
   * Running count of blink onsets this session, counted at frame rate on the
   * native side. Compare against the previous value to never miss a blink.
   */
  blinkCount: number;
  /** Receive time, ms since epoch (JS clock). */
  t: number;
}

/** Event-driven vitals, emitted only when a new sample exists (~1–2 Hz). */
export interface Vitals {
  /** BPM, or null if no new sample in this payload. */
  pulseRate: number | null;
  /** RMSSD in ms, or null. */
  hrvRmssd: number | null;
  /** Whether the SDK marked the HRV window as stable. */
  hrvStable: boolean;
  /** Breaths per minute, or null. */
  breathingRate: number | null;
  t: number;
}

/** Batched breathing waveform samples (chest = upper trace). */
export interface TraceBatch {
  /** Raw trace values in arrival order. Unitless; normalise downstream. */
  chest: number[];
  t: number;
}

export interface StatusEvent {
  processing: ProcessingStatus;
  quality: QualityCode;
  /** Human-readable hint from the SDK, e.g. "Move closer". */
  hint: string;
  t: number;
}

export interface ErrorEvent {
  code: string;
  message: string;
  retryable: boolean;
}

export interface SignalListeners {
  onFastSignals?: (e: FastSignals) => void;
  onVitals?: (e: Vitals) => void;
  onTrace?: (e: TraceBatch) => void;
  onStatus?: (e: StatusEvent) => void;
  onError?: (e: ErrorEvent) => void;
}

export type SourceKind = 'live' | 'mock' | 'replay';

/** Anything that can feed the app biometric events. */
export interface SignalSource {
  readonly kind: SourceKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listeners: SignalListeners): () => void;
}

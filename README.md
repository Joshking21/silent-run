# Silent Run

A top-down stealth game where **your body is the controller**. The phone's front camera reads your pulse, breathing, heart-rate variability, blinks, speech and facial expression in real time. The game turns each one into a stealth mechanic, so staying calm is the skill you're practising.

Built with React Native (Expo) and a custom Kotlin bridge to the [Presage SmartSpectra SDK](https://physiology.presagetech.com) for camera-based vital signs.

> Status: a working prototype on Android, tested on a budget device (Infinix Hot 60i, 4 GB RAM). It isn't a medical device; the readings shape gameplay and are not health advice.

---

## How your body drives the game

| Signal (from the camera) | Game mechanic |
|---|---|
| **Pulse** above your resting baseline | **Heat aura.** Thermal sensors detect you from further away, and a spike takes seconds to fade, like real adrenaline. |
| **Breathing**, 4 s in / 6 s out | **Vent cooling.** Matching a slow breathing pattern at a vent cools you down. |
| **Heart-rate variability (HRV)** | **Composure.** Higher HRV steadies the detection meter. |
| **Blinking** | **Retinal scanners.** Blink inside a scanner beam and you're spotted. |
| **Talking** | **Noise.** Speaking on wired floor alerts guards, but a whisper at a relay console throws your voice as a decoy. |
| **Facial expression** | **ID checkpoints.** Hold a neutral face while the scan runs. |

If the camera loses your face or the lighting is poor, the game **pauses all hazards** ("optic jammed") instead of punishing you for a bad reading.

## The flow

1. **Consent.** A plain-language explanation of what the camera reads, before anything turns on. You can also play with simulated signals and no camera.
2. **Calibration.** 20 seconds of still, framed time to capture your resting pulse, breathing, HRV and blink rate. Only time with your face clearly in frame counts.
3. **Three missions**, each turning on more systems:
   - **Dead Air:** sound and retinal scanners
   - **Thermal Grid:** heat sensors and breathing vents
   - **The Vault:** everything at once, plus ID checkpoints
4. **After-action debrief.** A timeline of your pulse, breathing, HRV and detection level, with key moments marked, how long you took to recover after each spike, and an S–D rank.

## Architecture

```
Camera ─► SmartSpectra SDK (on-device) ─► Kotlin bridge ─► JS signal store ─► stealth engine ─► Skia renderer
                                              │                  ▲
                                   throttled CameraX capture   mock / replay sources
```

- **`modules/smartspectra-bridge/`** is an Expo native module in Kotlin.
  - It configures the SDK with telemetry off and turns its output into a few typed events:
    - **fast face signals**, on change or up to 10 Hz
    - **vitals**, only when a new sample arrives
    - a **batched chest-breathing trace**, about 10 Hz
    - **status** and **errors**
  - The API key is copied into the Android build at compile time and never goes into the JavaScript bundle.
- **`src/signals/`** has three interchangeable sources behind one interface:
  - **live:** the camera, through the bridge
  - **mock:** a physiology model whose arousal rises and falls with a lag, so pulse, HRV and breathing respond realistically
  - **replay:** a recorded session played back
  - All three feed one store, which smooths out validity flicker and keeps a ring buffer of the chest trace. The whole game can be built and played without the phone.
- **`src/engine/`** is pure TypeScript with no React:
  - grid and A* pathfinding, line of sight
  - guard AI: patrol, investigate, chase decoys
  - vision cones, heat, the detection meter
  - a breathing-pattern analyser (smoothing, detrending, turn detection)
  - calibration and the debrief scoring
- **`src/game/`** has the Skia renderer and the frame loop. **`src/screens/`** has the four screens and a hidden developer "Signal Lab".

## Engineering notes

**Running a vitals SDK on a 4 GB phone.**
- On the test device, the app was closed by Android's low-memory killer within about a minute of the camera starting.
- Memory profiling showed native memory passing 600 MB in under 30 seconds and still climbing, with more pushed to swap.
- The fix was to take over the camera:
  - CameraX image analysis at 640×480, set to keep only the latest frame, at most one frame in flight
  - the SDK fed through its custom-input API
- Native memory dropped to a stable 100–200 MB.
- The budget front camera then slowed to about 15 fps indoors, too slow for the SDK to lock on. So the camera's auto-exposure is now pinned to a fixed frame rate.

**Testing the engine without a phone.**
- The stealth engine and breathing analyser were checked with a headless script.
- Bots played every mission to confirm each one is winnable by a calm player.
- The same careful route at +20 BPM gets caught in the later missions.
- A 4 s / 6 s breathing pattern scores as matched, and fast breathing doesn't.
- This run caught real bugs, including thermal sensors that could never see the player because their line-of-sight check was blocked by the sensor's own tile.

**Privacy by design.**
- The app never saves or uploads video, images or vitals.
- The debrief lives in memory for the session only.
- The SDK's telemetry is switched off.
- The consent screen only states things the code or SDK docs confirm.

## Tech

- Expo SDK 58 (development build), React Native 0.88, React 19, TypeScript
- Kotlin, Expo Modules API, CameraX, coroutines
- Presage SmartSpectra Android SDK 3.5.0
- @shopify/react-native-skia for the game and charts

## Running it

**Simulated signals.** You need Android, but no camera and no API key:

```bash
npm install
npm run android        # builds the dev client and installs it on a connected device or emulator
```

On the consent screen, choose **Practise with simulated signals**. A control bar lets you fake a pulse spike, a blink, talking or a smile.

**Live camera.** Get a Presage API key at [physiology.presagetech.com](https://physiology.presagetech.com), then:

```bash
cp .env.example .env   # then set PRESAGE_API_KEY=...
npm run android
```

`.env` is gitignored. Rebuild after changing the key, because it's baked into the native build.

Low-RAM machines can build for just the phone's CPU type, which is much faster:

```bash
cd android && ./gradlew app:installDebug -PreactNativeArchitectures=arm64-v8a
```

## Known limitations

- Android only. The bridge has no iOS side yet.
- Camera readings on budget phones depend heavily on light. Dim rooms lower the frame rate and signal quality.
- Blink, talking and expression tracking need a Presage key that includes face metrics. Without one, the app falls back to pulse and breathing only.
- Difficulty is tuned in simulation. Tuning it against real readings is still in progress.

## Credits

Vital-sign estimation by the Presage SmartSpectra SDK. All game design, code and art in this repository are original.

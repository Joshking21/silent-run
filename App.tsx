import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { MISSIONS } from './src/data/missions';
import type { Baseline } from './src/engine/calibration';
import type { DebriefReport } from './src/engine/debrief';
import { useSmartSpectra } from './src/hooks/useSmartSpectra';
import { CalibrationScreen } from './src/screens/CalibrationScreen';
import { ConsentScreen } from './src/screens/ConsentScreen';
import { DebriefScreen } from './src/screens/DebriefScreen';
import { MissionScreen } from './src/screens/MissionScreen';
import { SignalLabScreen } from './src/screens/SignalLabScreen';
import type { SourceKind } from './src/signals/types';
import { DockProvider, type DockMode } from './src/ui/CameraDock';
import { COLORS } from './src/ui/theme';

type Screen = 'consent' | 'calibration' | 'mission' | 'debrief' | 'lab';

export default function App() {
  const ss = useSmartSpectra();
  const [screen, setScreen] = useState<Screen>('consent');
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [missionIdx, setMissionIdx] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<DebriefReport | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  const startSource = useCallback(
    async (kind: SourceKind) => {
      setConsentError(null);
      setScreen('calibration');
      await ss.start(kind);
    },
    [ss.start],
  );

  const endSession = useCallback(async () => {
    await ss.stop();
    setBaseline(null);
    setReport(null);
    setMissionIdx(0);
    setScreen('consent');
  }, [ss.stop]);

  const live = ss.kind === 'live';
  const dockMode: DockMode = !live ? 'hidden' : screen === 'calibration' ? 'full' : screen === 'mission' ? 'thumb' : 'hidden';
  const mission = MISSIONS[missionIdx];

  let body: React.ReactNode = null;
  switch (screen) {
    case 'consent':
      body = (
        <ConsentScreen
          onAccept={startSource}
          onOpenLab={async () => {
            await ss.stop();
            setScreen('lab');
          }}
          error={consentError}
        />
      );
      break;
    case 'calibration':
      body = (
        <CalibrationScreen
          sourceKind={ss.kind}
          sourceError={ss.error}
          onComplete={(b) => {
            setBaseline(b);
            setAttempt((a) => a + 1);
            setScreen('mission');
          }}
          onUseMock={async () => {
            await ss.stop();
            await ss.start('mock');
          }}
          onRetry={async () => {
            await ss.stop();
            await ss.start('live');
          }}
          onBack={endSession}
        />
      );
      break;
    case 'mission':
      if (!baseline) break;
      body = (
        <MissionScreen
          key={`${mission.id}-${attempt}`}
          mission={mission}
          baseline={baseline}
          live={live}
          mock={ss.mock}
          onEnd={(r) => {
            setReport(r);
            setScreen('debrief');
          }}
          onQuit={() => setAttempt((a) => a + 1)}
          onSelectMission={(i) => {
            setMissionIdx(i);
            setAttempt((a) => a + 1);
          }}
          onEndSession={endSession}
        />
      );
      break;
    case 'debrief':
      if (!report) break;
      body = (
        <DebriefScreen
          report={report}
          mission={mission}
          hasNext={missionIdx < MISSIONS.length - 1}
          onRetry={() => {
            setAttempt((a) => a + 1);
            setScreen('mission');
          }}
          onNext={() => {
            setMissionIdx((i) => Math.min(i + 1, MISSIONS.length - 1));
            setAttempt((a) => a + 1);
            setScreen('mission');
          }}
          onRecalibrate={() => setScreen('calibration')}
          onExit={endSession}
        />
      );
      break;
    case 'lab':
      body = <SignalLabScreen onBack={() => setScreen('consent')} />;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <DockProvider mode={screen === 'lab' ? 'hidden' : dockMode}>{body}</DockProvider>
      <StatusBar style="light" />
    </View>
  );
}

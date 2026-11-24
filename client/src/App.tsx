import { useEffect, useState } from 'react';
import { fetchMe, logout, type Me } from './api.ts';
import { transcriptText } from './session/transcript.ts';
import { useRecorder, type TranscriptionMode } from './session/useRecorder.ts';
import { speechRecognitionCtor } from './stt/webspeech.ts';
import { AccuracyCheck } from './ui/AccuracyCheck.tsx';
import { ConsentDialog } from './ui/ConsentDialog.tsx';
import { Login } from './ui/Login.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { TranscriptPane } from './ui/TranscriptPane.tsx';

export function App() {
  const [me, setMe] = useState<Me | null | 'checking'>('checking');

  const refresh = () =>
    fetchMe().then(
      (result) => setMe(result),
      () => setMe(null),
    );
  useEffect(() => {
    void refresh();
  }, []);

  if (me === 'checking') return <p className="app muted">Loading…</p>;
  if (me === null) return <Login onLoggedIn={() => void refresh()} />;
  return <Recorder me={me} onLoggedOut={() => setMe(null)} />;
}

const MODE_LABEL: Record<TranscriptionMode, string> = {
  simulated: 'Simulated',
  webspeech: 'Browser speech',
  groq: 'Groq Whisper',
};
const MODE_KEY = 'metor.mode';

function savedMode(): TranscriptionMode | null {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'simulated' || value === 'webspeech' || value === 'groq' ? value : null;
  } catch {
    return null;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function Recorder({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const recorder = useRecorder(onLoggedOut);
  const available: TranscriptionMode[] = [
    'simulated',
    ...(speechRecognitionCtor() ? (['webspeech'] as const) : []),
    ...(me.providers.groq ? (['groq'] as const) : []),
  ];
  const saved = savedMode();
  const [mode, setMode] = useState<TranscriptionMode>(saved && available.includes(saved) ? saved : 'simulated');
  const [askingConsent, setAskingConsent] = useState(false);
  const { phase, connection, latencies } = recorder;
  const micOpen = phase === 'recording' || phase === 'paused';
  const activeMode = recorder.mode ?? mode;
  // Web Speech doesn't need the WebSocket; server modes do.
  const canStart = phase === 'idle' && (mode === 'webspeech' || connection === 'connected');

  const chooseMode = (value: TranscriptionMode) => {
    setMode(value);
    try {
      localStorage.setItem(MODE_KEY, value);
    } catch {
      // Private browsing etc.: the choice just isn't remembered.
    }
  };

  const onLogout = async () => {
    recorder.stop();
    try {
      await logout();
    } finally {
      onLoggedOut();
    }
  };

  return (
    <div className="app">
      <header>
        <strong>Metor</strong>
        <StatusBar phase={phase} connection={connection} elapsedMs={recorder.elapsedMs} />
        <button type="button" className="link" onClick={onLogout}>
          Log out
        </button>
      </header>

      <div className="controls">
        <label className="mode">
          Transcription
          <select value={mode} onChange={(e) => chooseMode(e.target.value as TranscriptionMode)} disabled={phase !== 'idle'}>
            {available.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        {!micOpen && (
          <button type="button" onClick={() => setAskingConsent(true)} disabled={!canStart}>
            {phase === 'starting' ? 'Starting…' : 'Start'}
          </button>
        )}
        {phase === 'recording' && (
          <button type="button" onClick={() => void recorder.pause()}>
            Pause
          </button>
        )}
        {phase === 'paused' && (
          <button type="button" onClick={() => void recorder.resume()}>
            Resume
          </button>
        )}
        {micOpen && (
          <button type="button" onClick={recorder.stop}>
            Stop
          </button>
        )}
        {connection === 'failed' && (
          <button type="button" onClick={recorder.reconnect}>
            Reconnect
          </button>
        )}
      </div>

      {micOpen && (
        <p className="debug" data-testid="audio-debug">
          {activeMode === 'webspeech'
            ? 'Audio goes to the browser speech service; nothing is sent to the Metor server.'
            : `Server received: ${
                recorder.audioStats
                  ? `${recorder.audioStats.frames} frames/s · ${(recorder.audioStats.bytes / 1024).toFixed(1)} KB/s · level ${recorder.audioStats.levelDb.toFixed(0)} dB`
                  : 'waiting…'
              }`}
          {latencies.length > 0 &&
            ` · final latency p50 ${(median(latencies) / 1000).toFixed(2)} s (n=${latencies.length})`}
        </p>
      )}

      {recorder.error && <p role="alert" className="error">{recorder.error}</p>}

      <TranscriptPane transcript={recorder.transcript} label={MODE_LABEL[activeMode]} onClear={recorder.clear} />

      <AccuracyCheck
        transcript={transcriptText(recorder.transcript)}
        mode={MODE_LABEL[activeMode]}
        latencies={latencies}
      />

      {askingConsent && (
        <ConsentDialog
          mode={mode}
          onCancel={() => setAskingConsent(false)}
          onConfirm={() => {
            setAskingConsent(false);
            void recorder.start(mode);
          }}
        />
      )}
    </div>
  );
}

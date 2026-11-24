import { useEffect, useState } from 'react';
import { isLoggedIn, logout } from './api.ts';
import { useRecorder } from './session/useRecorder.ts';
import { ConsentDialog } from './ui/ConsentDialog.tsx';
import { Login } from './ui/Login.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { TranscriptPane } from './ui/TranscriptPane.tsx';

export function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');

  useEffect(() => {
    isLoggedIn().then(
      (ok) => setAuth(ok ? 'in' : 'out'),
      () => setAuth('out'),
    );
  }, []);

  if (auth === 'checking') return <p className="app muted">Loading…</p>;
  if (auth === 'out') return <Login onLoggedIn={() => setAuth('in')} />;
  return <Recorder onLoggedOut={() => setAuth('out')} />;
}

function Recorder({ onLoggedOut }: { onLoggedOut: () => void }) {
  const recorder = useRecorder(onLoggedOut);
  const [askingConsent, setAskingConsent] = useState(false);
  const { phase, connection } = recorder;
  const micOpen = phase === 'recording' || phase === 'paused';

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
        {!micOpen && (
          <button
            type="button"
            onClick={() => setAskingConsent(true)}
            disabled={connection !== 'connected' || phase === 'starting'}
          >
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
          Server received:{' '}
          {recorder.audioStats
            ? `${recorder.audioStats.frames} frames/s · ${(recorder.audioStats.bytes / 1024).toFixed(1)} KB/s · level ${recorder.audioStats.levelDb.toFixed(0)} dB`
            : 'waiting…'}
        </p>
      )}

      {recorder.error && <p role="alert" className="error">{recorder.error}</p>}

      <TranscriptPane transcript={recorder.transcript} />

      {askingConsent && (
        <ConsentDialog
          onCancel={() => setAskingConsent(false)}
          onConfirm={() => {
            setAskingConsent(false);
            void recorder.start();
          }}
        />
      )}
    </div>
  );
}

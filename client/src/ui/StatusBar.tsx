import type { ConnectionStatus } from '../net/wsClient.ts';
import type { RecorderPhase } from '../session/useRecorder.ts';

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Disconnected',
};

interface Props {
  phase: RecorderPhase;
  connection: ConnectionStatus;
  elapsedMs: number;
}

/** The recording indicator reflects real mic state and can't be hidden while the mic is open. */
export function StatusBar({ phase, connection, elapsedMs }: Props) {
  const micOpen = phase === 'recording' || phase === 'paused';
  const online = connection === 'connected';
  return (
    <div className="status-bar">
      {micOpen && (
        <span className={`indicator indicator-${phase}`} data-testid="recording-indicator" role="status">
          <span className="rec-dot" aria-hidden="true" />
          {phase === 'recording' ? 'REC' : 'Paused, mic still open'} {formatElapsed(elapsedMs)}
          {!online && ' · Reconnecting, mic on'}
        </span>
      )}
      <span className="connection" data-testid="connection-status">
        <span className={`dot dot-${connection}`} aria-hidden="true" />
        {CONNECTION_LABEL[connection]}
      </span>
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_TEXT_LENGTH, type ServerMessage } from '../../shared/messages.ts';
import { WsClient, sameOriginWsUrl, type ConnectionStatus } from './net/wsClient.ts';

interface LogEntry {
  key: number;
  kind: 'sent' | 'echo' | 'error';
  text: string;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

const MAX_LOG = 200;

export function App() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [text, setText] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const clientRef = useRef<WsClient | null>(null);
  const keyRef = useRef(0);

  const append = (kind: LogEntry['kind'], entryText: string) => {
    keyRef.current += 1;
    const entry = { key: keyRef.current, kind, text: entryText };
    setLog((prev) => [...prev.slice(-(MAX_LOG - 1)), entry]);
  };

  useEffect(() => {
    const client = new WsClient({
      url: sameOriginWsUrl(window.location),
      onStatus: setStatus,
      onMessage: (msg: ServerMessage) => {
        if (msg.type === 'echo') append('echo', msg.text);
        else append('error', `${msg.code}: ${msg.message}`);
      },
      onInvalid: (error) => append('error', `invalid server message: ${error}`),
    });
    clientRef.current = client;
    client.start();
    return () => client.stop();
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    const sent = clientRef.current?.send({
      type: 'echo.request',
      id: crypto.randomUUID(),
      ts: Date.now(),
      text: trimmed,
    });
    if (sent) {
      append('sent', trimmed);
      setText('');
    } else {
      append('error', 'not connected; message not sent');
    }
  };

  return (
    <div className="app">
      <header className="status-bar" role="status" aria-live="polite">
        <span className={`dot dot-${status}`} aria-hidden="true" />
        <span data-testid="connection-status">{STATUS_LABEL[status]}</span>
        <span className="phase">Phase 1 · WebSocket echo</span>
      </header>
      <main>
        <form onSubmit={onSubmit} className="composer">
          <label htmlFor="message" className="visually-hidden">
            Message
          </label>
          <input
            id="message"
            value={text}
            maxLength={MAX_TEXT_LENGTH}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message to echo"
            autoComplete="off"
          />
          <button type="submit" disabled={status !== 'connected' || !text.trim()}>
            Send
          </button>
        </form>
        <ol className="log" data-testid="message-log" aria-label="Message log">
          {log.map((entry) => (
            <li key={entry.key} className={`log-${entry.kind}`}>
              <span className="log-kind">{entry.kind}</span> {entry.text}
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}

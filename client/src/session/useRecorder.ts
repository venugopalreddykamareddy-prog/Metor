import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeAudioFrame, type ServerMessage } from '../../../shared/messages.ts';
import { startCapture, type Capture } from '../audio/capture.ts';
import { WsClient, sameOriginWsUrl, type ConnectionStatus } from '../net/wsClient.ts';
import { AudioBuffer } from './audioBuffer.ts';
import { applyTranscript, dropPartial, emptyTranscript, type Transcript } from './transcript.ts';

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'paused';

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Microphone permission was denied. Allow it in the browser and try again.';
  if (name === 'NotFoundError') return 'No microphone found.';
  return `Could not start the microphone${err instanceof Error ? `: ${err.message}` : '.'}`;
}

/** Mic capture + WebSocket session (ARCHITECTURE §6.2–6.3). `onAuthEnded` runs when the server ends the login. */
export function useRecorder(onAuthEnded: () => void) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [connection, setConnection] = useState<ConnectionStatus>('disconnected');
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const wsRef = useRef<WsClient | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const bufferRef = useRef(new AudioBuffer());
  const seqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const sessionReadyRef = useRef(false);
  const lastFinalSeqRef = useRef(0);
  // Recording time excluding pauses: total so far + time since the last start/resume.
  const timeRef = useRef({ total: 0, since: 0 });
  const onAuthEndedRef = useRef(onAuthEnded);
  onAuthEndedRef.current = onAuthEnded;

  /** Stops the mic and forgets the session. Used by stop, logout, auth expiry and terminal failures. */
  const release = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    sessionIdRef.current = null;
    sessionReadyRef.current = false;
    bufferRef.current.clear();
    setPhase('idle');
  }, []);

  const flush = (fromSeq: number) => {
    for (const frame of bufferRef.current.from(fromSeq)) wsRef.current?.sendBinary(frame);
  };

  useEffect(() => {
    const handleMessage = (msg: ServerMessage) => {
      switch (msg.type) {
        case 'session.started':
          sessionIdRef.current = msg.sessionId;
          sessionReadyRef.current = true;
          flush(0);
          break;
        case 'session.resumed':
          sessionReadyRef.current = true;
          setTranscript(dropPartial);
          flush(msg.nextAudioSeq);
          break;
        case 'audio.ack':
          bufferRef.current.ack(msg.seq);
          break;
        case 'transcript.final':
          lastFinalSeqRef.current = Math.max(lastFinalSeqRef.current, msg.finalSeq);
          setTranscript((t) => applyTranscript(t, msg));
          break;
        case 'transcript.partial':
        case 'transcript.gap':
          setTranscript((t) => applyTranscript(t, msg));
          break;
        case 'error':
          if (msg.code === 'session_expired') {
            release();
            setError('The connection was down too long, so recording stopped. The transcript is kept below.');
          } else {
            setError(`Server error: ${msg.message}`);
          }
          break;
      }
    };

    const ws = new WsClient({
      url: sameOriginWsUrl(window.location),
      onStatus: (status) => {
        setConnection(status);
        if (status !== 'connected') sessionReadyRef.current = false;
        if (status === 'failed' && captureRef.current) {
          release();
          setError('Lost the connection to the server, so recording stopped. The transcript is kept below.');
        }
      },
      onOpen: () => {
        if (!captureRef.current) return;
        if (sessionIdRef.current) {
          ws.send({ type: 'session.resume', sessionId: sessionIdRef.current, lastFinalSeq: lastFinalSeqRef.current });
        } else {
          // The connection dropped before session.start went out.
          ws.send({ type: 'session.start', mode: 'simulated', source: 'mic' });
        }
      },
      onMessage: handleMessage,
      onInvalid: (err) => setError(`Unexpected message from server: ${err}`),
      onAuthEnded: () => {
        release();
        onAuthEndedRef.current();
      },
    });
    wsRef.current = ws;
    ws.start();
    return () => {
      ws.stop();
      captureRef.current?.stop();
      captureRef.current = null;
    };
  }, [release]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = () => setElapsedMs(timeRef.current.total + Date.now() - timeRef.current.since);
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [phase]);

  const start = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws?.isOpen || captureRef.current) return;
    setError(null);
    setPhase('starting');
    seqRef.current = 0;
    lastFinalSeqRef.current = 0;
    sessionReadyRef.current = false;
    bufferRef.current.clear();
    let capture: Capture;
    try {
      capture = await startCapture((samples) => {
        const seq = seqRef.current++;
        const frame = encodeAudioFrame(seq, samples);
        bufferRef.current.add(seq, frame);
        if (sessionReadyRef.current) wsRef.current?.sendBinary(frame);
      });
    } catch (err) {
      setPhase('idle');
      setError(micErrorMessage(err));
      return;
    }
    captureRef.current = capture;
    setTranscript(emptyTranscript);
    timeRef.current = { total: 0, since: Date.now() };
    setElapsedMs(0);
    ws.send({ type: 'session.start', mode: 'simulated', source: 'mic' });
    setPhase('recording');
  }, []);

  const pause = useCallback(async () => {
    if (!captureRef.current) return;
    await captureRef.current.pause();
    timeRef.current.total += Date.now() - timeRef.current.since;
    setElapsedMs(timeRef.current.total);
    setPhase('paused');
  }, []);

  const resume = useCallback(async () => {
    if (!captureRef.current) return;
    await captureRef.current.resume();
    timeRef.current.since = Date.now();
    setPhase('recording');
  }, []);

  const stop = useCallback(() => {
    if (captureRef.current) wsRef.current?.send({ type: 'session.stop' });
    release();
  }, [release]);

  const reconnect = useCallback(() => {
    setError(null);
    wsRef.current?.start();
  }, []);

  return { phase, connection, transcript, error, elapsedMs, start, pause, resume, stop, reconnect };
}

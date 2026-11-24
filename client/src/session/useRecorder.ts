import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeAudioFrame, type ServerMessage } from '../../../shared/messages.ts';
import { startCapture, type Capture } from '../audio/capture.ts';
import { WsClient, sameOriginWsUrl, type ConnectionStatus } from '../net/wsClient.ts';
import { startWebSpeech, type WebSpeech } from '../stt/webspeech.ts';
import { AudioBuffer } from './audioBuffer.ts';
import {
  applyTranscript,
  clearTranscript,
  dropPartial,
  emptyTranscript,
  type Transcript,
  type TranscriptMessage,
} from './transcript.ts';

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'paused';
export type TranscriptionMode = 'simulated' | 'webspeech' | 'groq';

export interface AudioStats {
  frames: number;
  bytes: number;
  levelDb: number;
}

/** How long each final took to arrive (Groq: end of segment → text; Web Speech: last interim → final). */
const MAX_LATENCY_SAMPLES = 50;

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Microphone permission was denied. Allow it in the browser and try again.';
  if (name === 'NotFoundError') return 'No microphone found.';
  return `Could not start the microphone${err instanceof Error ? `: ${err.message}` : '.'}`;
}

/** Ends the media tracks and recognition behind one recording, whatever the mode. */
interface ActiveRecording {
  mode: TranscriptionMode;
  pause(): Promise<void> | void;
  resume(): Promise<void> | void;
  stop(): void;
}

/** Mic capture + transcription (ARCHITECTURE §4, §6.2–6.3). `onAuthEnded` runs when the server ends the login. */
export function useRecorder(onAuthEnded: () => void) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [connection, setConnection] = useState<ConnectionStatus>('disconnected');
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioStats, setAudioStats] = useState<AudioStats | null>(null);
  const [latencies, setLatencies] = useState<number[]>([]);

  const wsRef = useRef<WsClient | null>(null);
  const activeRef = useRef<ActiveRecording | null>(null);
  const bufferRef = useRef(new AudioBuffer());
  const seqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const sessionReadyRef = useRef(false);
  const lastFinalSeqRef = useRef(0);
  const serverModeRef = useRef<'simulated' | 'groq'>('simulated');
  // Recording time excluding pauses: total so far + time since the last start/resume.
  const timeRef = useRef({ total: 0, since: 0 });
  const onAuthEndedRef = useRef(onAuthEnded);
  onAuthEndedRef.current = onAuthEnded;

  const addLatency = (ms: number) => setLatencies((l) => [...l.slice(-(MAX_LATENCY_SAMPLES - 1)), ms]);

  const applyMessage = useCallback((msg: TranscriptMessage) => {
    if (msg.type === 'transcript.final') {
      lastFinalSeqRef.current = Math.max(lastFinalSeqRef.current, msg.finalSeq);
      if (msg.latencyMs !== undefined) addLatency(msg.latencyMs);
    }
    setTranscript((t) => applyTranscript(t, msg));
  }, []);

  /** Stops the mic and forgets the session. Used by stop, logout, auth expiry and terminal failures. */
  const release = useCallback(() => {
    activeRef.current?.stop();
    activeRef.current = null;
    sessionIdRef.current = null;
    sessionReadyRef.current = false;
    bufferRef.current.clear();
    setAudioStats(null);
    setPhase('idle');
  }, []);

  const flush = (fromSeq: number) => {
    for (const frame of bufferRef.current.from(fromSeq)) wsRef.current?.sendBinary(frame);
  };

  useEffect(() => {
    const serverRecording = () => activeRef.current !== null && activeRef.current.mode !== 'webspeech';

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
        case 'audio.stats':
          setAudioStats({ frames: msg.frames, bytes: msg.bytes, levelDb: msg.levelDb });
          break;
        case 'transcript.partial':
        case 'transcript.final':
        case 'transcript.gap':
          applyMessage(msg);
          break;
        case 'error':
          // Terminal: the session is gone, the length limit hit, or the mode can't start at all.
          // Other errors (Groq quota, a failed upload) are shown while recording continues.
          if (
            msg.code === 'session_expired' ||
            msg.code === 'limit_reached' ||
            (msg.code === 'provider_unavailable' && !sessionIdRef.current)
          ) {
            release();
            setError(
              msg.code === 'session_expired'
                ? 'The connection was down too long, so recording stopped. The transcript is kept below.'
                : `Recording stopped: ${msg.message}`,
            );
          } else {
            setError(msg.message);
          }
          break;
      }
    };

    const ws = new WsClient({
      url: sameOriginWsUrl(window.location),
      onStatus: (status) => {
        setConnection(status);
        if (status !== 'connected') sessionReadyRef.current = false;
        if (status === 'failed' && serverRecording()) {
          release();
          setError('Lost the connection to the server, so recording stopped. The transcript is kept below.');
        }
      },
      onOpen: () => {
        if (!serverRecording()) return;
        if (sessionIdRef.current) {
          ws.send({ type: 'session.resume', sessionId: sessionIdRef.current, lastFinalSeq: lastFinalSeqRef.current });
        } else {
          // The connection dropped before session.start went out.
          ws.send({ type: 'session.start', mode: serverModeRef.current, source: 'mic' });
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
      activeRef.current?.stop();
      activeRef.current = null;
    };
  }, [release, applyMessage]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = () => setElapsedMs(timeRef.current.total + Date.now() - timeRef.current.since);
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [phase]);

  /** Server modes: worklet capture streamed over the WebSocket. */
  const startServerRecording = async (mode: 'simulated' | 'groq'): Promise<ActiveRecording> => {
    seqRef.current = 0;
    sessionReadyRef.current = false;
    sessionIdRef.current = null;
    bufferRef.current.clear();
    serverModeRef.current = mode;
    const capture: Capture = await startCapture((samples) => {
      const seq = seqRef.current++;
      const frame = encodeAudioFrame(seq, samples);
      bufferRef.current.add(seq, frame);
      if (sessionReadyRef.current) wsRef.current?.sendBinary(frame);
    });
    wsRef.current?.send({ type: 'session.start', mode, source: 'mic' });
    return {
      mode,
      pause: () => capture.pause(),
      resume: () => capture.resume(),
      stop: () => {
        wsRef.current?.send({ type: 'session.stop' });
        capture.stop();
      },
    };
  };

  /** Web Speech: recognition runs in the browser on our own mic track; no audio goes to the Metor server. */
  const startBrowserRecording = async (): Promise<ActiveRecording> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stopTracks();
      throw new Error('no audio track');
    }
    let finalSeq = lastFinalSeqRef.current;
    let speech: WebSpeech;
    try {
      speech = startWebSpeech(track, {
        onPartial: (text) => applyMessage({ type: 'transcript.partial', id: '', ts: Date.now(), segmentId: 'web', text }),
        onFinal: (text, delayMs) =>
          applyMessage({
            type: 'transcript.final',
            id: '',
            ts: Date.now(),
            segmentId: 'web',
            finalSeq: ++finalSeq,
            text,
            startMs: 0,
            endMs: 0,
            latencyMs: delayMs,
          }),
        onFatal: (message) => {
          release();
          setError(`Recording stopped: ${message}`);
        },
      });
    } catch (err) {
      stopTracks();
      throw err;
    }
    return {
      mode: 'webspeech',
      pause: () => speech.pause(),
      resume: () => speech.resume(),
      stop: () => {
        speech.stop();
        stopTracks();
      },
    };
  };

  const start = useCallback(async (mode: TranscriptionMode) => {
    if (activeRef.current) return;
    if (mode !== 'webspeech' && !wsRef.current?.isOpen) return;
    setError(null);
    setPhase('starting');
    lastFinalSeqRef.current = 0;
    setTranscript(emptyTranscript);
    setLatencies([]);
    try {
      activeRef.current = mode === 'webspeech' ? await startBrowserRecording() : await startServerRecording(mode);
    } catch (err) {
      setPhase('idle');
      setError(micErrorMessage(err));
      return;
    }
    timeRef.current = { total: 0, since: Date.now() };
    setElapsedMs(0);
    setPhase('recording');
  }, []);

  const pause = useCallback(async () => {
    if (!activeRef.current) return;
    await activeRef.current.pause();
    timeRef.current.total += Date.now() - timeRef.current.since;
    setElapsedMs(timeRef.current.total);
    setPhase('paused');
  }, []);

  const resume = useCallback(async () => {
    if (!activeRef.current) return;
    await activeRef.current.resume();
    timeRef.current.since = Date.now();
    setPhase('recording');
  }, []);

  const clear = useCallback(() => setTranscript(clearTranscript), []);

  const reconnect = useCallback(() => {
    setError(null);
    wsRef.current?.start();
  }, []);

  return {
    phase,
    connection,
    transcript,
    error,
    elapsedMs,
    audioStats,
    latencies,
    mode: activeRef.current?.mode ?? null,
    start,
    pause,
    resume,
    stop: release,
    clear,
    reconnect,
  };
}

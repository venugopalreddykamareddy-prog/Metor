import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerEngine, AnswerLength } from '../../shared/messages.ts';
import { fetchMe, fetchUsage, logout, type Me, type Usage } from './api.ts';
import { useAnswers, type AnswerCard } from './answers/useAnswers.ts';
import type { DetectedQuestion } from './questions/tracker.ts';
import { useQuestions } from './questions/useQuestions.ts';
import { buildCleanTranscript, cleanTranscriptText } from './session/cleanTranscript.ts';
import { useCorrections } from './session/corrections.ts';
import { transcriptText } from './session/transcript.ts';
import { useRecorder, type AnswerMessage, type TranscriptionMode } from './session/useRecorder.ts';
import { speechRecognitionCtor } from './stt/webspeech.ts';
import { AccuracyCheck } from './ui/AccuracyCheck.tsx';
import { AnswersPanel } from './ui/AnswersPanel.tsx';
import { QuestionsPanel } from './ui/QuestionsPanel.tsx';
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
const ENGINE_LABEL: Record<AnswerEngine, string> = {
  simulated: 'Simulated',
  'groq-120b': 'Groq GPT-OSS 120B',
  'groq-20b': 'Groq GPT-OSS 20B',
};

function load(key: string): string | null {
  try {
    return localStorage.getItem(`metor.${key}`);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(`metor.${key}`, value);
  } catch {
    // Private browsing etc.: the choice just isn't remembered.
  }
}

/** A remembered choice, if it's still one of the allowed values. */
function useSetting<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const stored = load(key);
  const [value, setValue] = useState<T>(allowed.includes(stored as T) ? (stored as T) : fallback);
  return [value, (v: T) => (setValue(v), save(key, v))] as const;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function Recorder({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const answerHandler = useRef<(msg: AnswerMessage) => void>(() => {});
  const recorder = useRecorder(onLoggedOut, (msg) => answerHandler.current(msg));
  const answers = useAnswers(recorder.send);
  answerHandler.current = answers.handleMessage;

  const available: TranscriptionMode[] = [
    'simulated',
    ...(speechRecognitionCtor() ? (['webspeech'] as const) : []),
    ...(me.providers.groq ? (['groq'] as const) : []),
  ];
  const engines: AnswerEngine[] = me.providers.groq ? ['groq-120b', 'groq-20b', 'simulated'] : ['simulated'];
  const [mode, setMode] = useSetting<TranscriptionMode>('mode', available, 'simulated');
  const [engine, setEngine] = useSetting<AnswerEngine>('engine', engines, engines[0] ?? 'simulated');
  const [length, setLength] = useSetting<AnswerLength>('length', ['short', 'standard', 'detailed'], 'standard');
  const [autoAnswer, setAutoAnswer] = useSetting<'on' | 'off'>('autoAnswer', ['on', 'off'], 'on');
  const [autoScroll, setAutoScroll] = useState(true);
  const [askingConsent, setAskingConsent] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const corrections = useCorrections();
  // Hand edits of single sentences, for the current recording only.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const { phase, connection, latencies } = recorder;
  const clean = useMemo(
    () =>
      buildCleanTranscript(recorder.transcript.lines, {
        replacements: corrections.replacements,
        overrides,
        lastIsOpen: recorder.transcript.partial !== null,
      }),
    [recorder.transcript, corrections.replacements, overrides],
  );

  const questions = useQuestions(clean, autoAnswer === 'on', (q) => answers.ask(q, engine, length));
  const regenerate = (card: AnswerCard) => {
    const q: DetectedQuestion = {
      id: card.sourceId,
      text: card.question,
      kind: 'question',
      status: 'answered',
      statements: [],
      spokenAt: Date.now(),
      firstSeenAt: Date.now(),
    };
    answers.ask(q, engine, length);
  };

  // Free-tier usage, refreshed now and then and after each finished answer.
  const doneCount = answers.cards.filter((c) => c.status === 'done').length;
  useEffect(() => {
    if (!me.providers.groq) return;
    const refresh = () => void fetchUsage().then(setUsage, () => setUsage(null));
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [me.providers.groq, doneCount]);
  const micOpen = phase === 'recording' || phase === 'paused';
  const activeMode = recorder.mode ?? mode;
  // Web Speech doesn't need the WebSocket; server modes do.
  const canStart = phase === 'idle' && (mode === 'webspeech' || connection === 'connected');


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
          <select value={mode} onChange={(e) => setMode(e.target.value as TranscriptionMode)} disabled={phase !== 'idle'}>
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
          {answers.latencies.length > 0 &&
            ` · speech end → first answer word p50 ${(median(answers.latencies) / 1000).toFixed(2)} s (n=${answers.latencies.length})`}
        </p>
      )}

      <div className="settings" aria-label="Answer settings">
        <label>
          Answers
          <select value={engine} onChange={(e) => setEngine(e.target.value as AnswerEngine)}>
            {engines.map((e) => (
              <option key={e} value={e}>
                {ENGINE_LABEL[e]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Length
          <select value={length} onChange={(e) => setLength(e.target.value as AnswerLength)}>
            <option value="short">Short (~30 s)</option>
            <option value="standard">Standard (~1 min)</option>
            <option value="detailed">Detailed (2–3 min)</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={autoAnswer === 'on'} onChange={(e) => setAutoAnswer(e.target.checked ? 'on' : 'off')} />
          Answer automatically
        </label>
        <button type="button" aria-pressed={!autoScroll} onClick={() => setAutoScroll(!autoScroll)}>
          {autoScroll ? 'Pause scrolling' : 'Resume scrolling'}
        </button>
        {engine !== 'simulated' && <span className="muted">Questions and recent answers are sent to Groq (free tier).</span>}
        {usage?.groq && (
          <span className="muted" data-testid="usage">
            Groq answers today: {usage.groq.answers.lastDay.requests}/{usage.groq.answers.limits.perDay.requests} requests ·{' '}
            {Math.round(usage.groq.answers.lastDay.units / 1000)}k/{Math.round(usage.groq.answers.limits.perDay.units / 1000)}k tokens
          </span>
        )}
      </div>

      {recorder.error && <p role="alert" className="error">{recorder.error}</p>}

      <div className="workspace">
      <TranscriptPane
        transcript={recorder.transcript}
        autoScroll={autoScroll}
        clean={clean}
        label={MODE_LABEL[activeMode]}
        replacements={corrections.replacements}
        onClear={() => {
          recorder.clear();
          setOverrides({});
        }}
        onEditSentence={(key, text) => setOverrides((o) => ({ ...o, [key]: text }))}
        onAddCorrection={corrections.add}
        onRemoveCorrection={corrections.remove}
      />
      <QuestionsPanel
        questions={questions.questions}
        onAnswer={questions.answer}
        onDismiss={questions.dismiss}
        onMerge={questions.mergeWithPrevious}
        onAsk={questions.ask}
      />
      <AnswersPanel cards={answers.cards} autoScroll={autoScroll} onCancel={answers.cancel} onRegenerate={regenerate} />
      </div>

      <AccuracyCheck
        rawText={transcriptText(recorder.transcript)}
        cleanText={cleanTranscriptText(clean)}
        mode={MODE_LABEL[activeMode]}
        latencies={latencies}
      />

      {askingConsent && (
        <ConsentDialog
          mode={mode}
          onCancel={() => setAskingConsent(false)}
          onConfirm={() => {
            setAskingConsent(false);
            setOverrides({});
            questions.reset(); // sentence keys restart with each recording
            void recorder.start(mode);
          }}
        />
      )}
    </div>
  );
}

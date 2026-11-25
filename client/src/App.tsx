import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerEngine, AnswerLength } from '../../shared/messages.ts';
import { fetchMe, fetchUsage, logout, type Me, type Usage } from './api.ts';
import { groupAnswers } from './answers/grouping.ts';
import { useAnswers, type AnswerCard } from './answers/useAnswers.ts';
import type { DetectedQuestion } from './questions/tracker.ts';
import { useQuestions } from './questions/useQuestions.ts';
import { buildCleanTranscript, cleanTranscriptText } from './session/cleanTranscript.ts';
import { useCorrections } from './session/corrections.ts';
import { transcriptText } from './session/transcript.ts';
import { useRecorder, type AnswerMessage, type TranscriptionMode } from './session/useRecorder.ts';
import { retrieve } from '../../shared/kb.ts';
import { deleteDatabase, idbStore } from './kb/db.ts';
import { useKb } from './kb/useKb.ts';
import { RETENTION_DAYS, exportJson, purgeExpired, saveSession, type SavedSession } from './session/history.ts';
import { KnowledgeBase } from './ui/KnowledgeBase.tsx';
import { load, save, useAnswerDisplay, useSetting } from './settings.ts';
import { leftToday, preferredMode, whisperQuotaLeft } from './session/transcriptionMode.ts';
import { speechRecognitionCtor } from './stt/webspeech.ts';
import { AccuracyCheck } from './ui/AccuracyCheck.tsx';
import { AnswersPanel } from './ui/AnswersPanel.tsx';
import { FocusView } from './ui/FocusView.tsx';
import { QuestionsPanel } from './ui/QuestionsPanel.tsx';
import { ConsentDialog } from './ui/ConsentDialog.tsx';
import { Login } from './ui/Login.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { TranscriptPane } from './ui/TranscriptPane.tsx';
import { Workspace } from './ui/Workspace.tsx';

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

const sessionStore = idbStore<SavedSession>('sessions');

const MODE_LABEL: Record<TranscriptionMode, string> = {
  simulated: 'Simulated',
  webspeech: 'Browser speech',
  groq: 'Groq Whisper',
};
const ENGINE_LABEL: Record<AnswerEngine, string> = {
  simulated: 'Simulated (not AI)',
  'groq-120b': 'Groq GPT-OSS 120B',
  'groq-20b': 'Groq GPT-OSS 20B (fast mode)',
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function Recorder({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const answerHandler = useRef<(msg: AnswerMessage) => void>(() => {});
  const recorder = useRecorder(onLoggedOut, (msg) => answerHandler.current(msg));
  const kb = useKb();
  // Only the excerpts that match this question and what was said just before it (FR-K2).
  const answers = useAnswers(recorder.send, (q) => retrieve(kb.items, [q.text, ...q.statements].join(' ')));
  answerHandler.current = answers.handleMessage;

  const available: TranscriptionMode[] = [
    'simulated',
    ...(speechRecognitionCtor() ? (['webspeech'] as const) : []),
    ...(me.providers.groq ? (['groq'] as const) : []),
  ];
  // GPT-OSS 120B (medium reasoning) is the default for accuracy; 20B is the optional fast mode.
  const engines: AnswerEngine[] = me.providers.groq ? ['groq-120b', 'groq-20b', 'simulated'] : ['simulated'];
  const [engine, setEngine] = useSetting<AnswerEngine>('answerModel', engines, engines[0] ?? 'simulated');
  const [length, setLength] = useSetting<AnswerLength>('length', ['short', 'standard', 'detailed'], 'standard');
  const [autoAnswer, setAutoAnswer] = useSetting<'on' | 'off'>('autoAnswer', ['on', 'off'], 'on');
  const [autoScroll, setAutoScroll] = useState(true);
  const [focus, setFocus] = useState(false);
  const { display, setFontSize, setLineSpacing } = useAnswerDisplay();
  const [askingConsent, setAskingConsent] = useState(false);
  // Opt-in session history: off by default; expired sessions are purged when the app opens.
  const [persist, setPersist] = useSetting<'on' | 'off'>('persistSessions', ['on', 'off'], 'off');
  const [retentionDays, setRetentionDays] = useSetting('retentionDays', RETENTION_DAYS, '30');
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const recordingStartedAt = useRef(0);
  useEffect(() => {
    // On app start and hourly (SECURITY_PRIVACY §Deletion ships with storage).
    const purge = () => void purgeExpired(sessionStore, Date.now()).then(setSessions, () => undefined);
    purge();
    const timer = setInterval(purge, 60 * 60_000);
    return () => clearInterval(timer);
  }, []);
  const [usage, setUsage] = useState<Usage | null>(null);
  // A mode the user picked is kept; otherwise Groq Whisper within its free quota, then Browser speech.
  const [picked, setPicked] = useState<TranscriptionMode | null>(() => {
    const stored = load('mode');
    return available.find((m) => m === stored) ?? null;
  });
  const mode = picked !== null && available.includes(picked) ? picked : preferredMode(available, whisperQuotaLeft(usage));
  const setMode = (m: TranscriptionMode) => {
    setPicked(m);
    save('mode', m);
  };
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
  /** Always a new request (skips the answer cache); optionally with another engine. */
  const regenerate = (card: AnswerCard, withEngine?: AnswerEngine) => {
    const q: DetectedQuestion = {
      id: card.sourceId,
      text: card.question,
      kind: 'question',
      status: 'answered',
      statements: [],
      spokenAt: Date.now(),
      firstSeenAt: Date.now(),
    };
    answers.ask(q, withEngine ?? engine, length, true);
  };

  // One entry per question; regenerated answers are kept as versions (grouping.ts).
  const repeats = questions.questions.flatMap((q) => (q.repeatOf ? [{ sourceId: q.repeatOf, at: q.firstSeenAt }] : []));
  const groups = useMemo(() => groupAnswers(answers.cards, repeats), [answers.cards, repeats.map((r) => `${r.sourceId}@${r.at}`).join()]);
  const latest = groups.at(-1) ?? null;
  const pending =
    questions.questions.filter((q) => (q.status === 'waiting' || q.status === 'ready') && q.firstSeenAt > (latest?.lastActivity ?? 0)).at(-1)
      ?.text ?? null;
  const displayProps = { display, onFontSize: setFontSize, onLineSpacing: setLineSpacing };

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


  /** Stop, then save the recording if the user opted in (nothing is written otherwise). */
  const stopRecording = () => {
    recorder.stop();
    const startedAt = recordingStartedAt.current;
    const done = answers.cards.filter((c) => c.sentAt >= startedAt && c.status === 'done');
    void saveSession(
      sessionStore,
      { persist: persist === 'on', retentionDays },
      {
        id: crypto.randomUUID(),
        startedAt,
        mode: MODE_LABEL[activeMode],
        transcript: cleanTranscriptText(clean),
        answers: done.map((c) => ({ question: c.question, answer: c.text, engine: c.engine })),
      },
      Date.now(),
    ).then((saved) => saved && void purgeExpired(sessionStore, Date.now()).then(setSessions));
  };
  const deleteSession = (id: string) => void sessionStore.delete(id).then(() => setSessions((all) => all.filter((x) => x.id !== id)));
  const exportAll = () => {
    const url = URL.createObjectURL(new Blob([exportJson({ kb: kb.items, sessions }, Date.now())], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'metor-export.json' });
    a.click();
    URL.revokeObjectURL(url);
  };
  const deleteEverything = () => {
    if (!window.confirm('Delete the knowledge base, saved sessions and all Metor settings in this browser? This cannot be undone.')) return;
    void deleteDatabase().finally(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('metor.')) localStorage.removeItem(key);
      window.location.reload();
    });
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
          <button type="button" onClick={stopRecording}>
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
        {engine === 'simulated' ? (
          <span className="muted" data-testid="engine-note">
            Simulated answers are canned placeholders for testing, not AI output.
          </span>
        ) : (
          <span className="muted" data-testid="engine-note">
            AI-generated by an open-weight model on Groq (free tier). Questions and recent answers are sent to Groq. Check answers before
            relying on them.
          </span>
        )}
        {usage?.groq && (
          <span className="muted" data-testid="usage">
            Groq free tier left today: transcription {(leftToday(usage.groq.transcription).units / 60).toFixed(0)} min of audio ·{' '}
            {leftToday(usage.groq.transcription).requests} requests; answers {leftToday(usage.groq.answers).requests} requests ·{' '}
            {(leftToday(usage.groq.answers).units / 1000).toFixed(1)}k tokens
            {(() => {
              const t = usage.answerTokens?.[engine];
              const avg = t?.averagePerAnswer.total;
              return avg ? ` · ${avg} tokens per answer on average (n=${t.withUsage}${t.cached ? `, ${t.cached} from cache` : ''})` : '';
            })()}
          </span>
        )}
      </div>

      {recorder.error && (
        <p role="alert" className="error">
          {recorder.error}
          {recorder.quotaExhausted && activeMode === 'groq' && available.includes('webspeech') && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => {
                  // Never switched automatically: stop, then ask consent for the other provider.
                  recorder.stop();
                  setMode('webspeech');
                  setAskingConsent(true);
                }}
              >
                Switch to Browser speech
              </button>
            </>
          )}
        </p>
      )}

      {focus && (
        <FocusView
          latest={latest}
          pending={pending}
          {...displayProps}
          onCancel={answers.cancel}
          onRegenerate={regenerate}
          onExit={() => setFocus(false)}
        />
      )}
      <div hidden={focus}>
        <Workspace
          transcript={(onCollapse) => (
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
              onCollapse={onCollapse}
            />
          )}
          questions={(onCollapse) => (
            <QuestionsPanel
              questions={questions.questions}
              onAnswer={questions.answer}
              onDismiss={questions.dismiss}
              onMerge={questions.mergeWithPrevious}
              onAsk={questions.ask}
              onCollapse={onCollapse}
            />
          )}
          answers={
            <AnswersPanel
              groups={groups}
              autoScroll={autoScroll}
              onCancel={answers.cancel}
              onRegenerate={regenerate}
              onFocus={() => setFocus(true)}
              {...displayProps}
            />
          }
        />

        <KnowledgeBase
          items={kb.items}
          error={kb.error}
          onSave={kb.save}
          onRemove={kb.remove}
          persist={persist === 'on'}
          retentionDays={retentionDays}
          onPersist={(on) => setPersist(on ? 'on' : 'off')}
          onRetention={setRetentionDays}
          sessions={sessions}
          onDeleteSession={deleteSession}
          onExport={exportAll}
          onDeleteEverything={deleteEverything}
        />

        <AccuracyCheck
          rawText={transcriptText(recorder.transcript)}
          cleanText={cleanTranscriptText(clean)}
          mode={MODE_LABEL[activeMode]}
          latencies={latencies}
        />
      </div>

      {askingConsent && (
        <ConsentDialog
          mode={mode}
          onCancel={() => setAskingConsent(false)}
          onConfirm={() => {
            setAskingConsent(false);
            recordingStartedAt.current = Date.now();
            setOverrides({});
            questions.reset(); // sentence keys restart with each recording
            void recorder.start(mode);
          }}
        />
      )}
    </div>
  );
}

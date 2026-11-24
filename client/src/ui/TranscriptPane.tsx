import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { CleanItem, Replacement } from '../session/cleanTranscript.ts';
import type { Transcript } from '../session/transcript.ts';

/** Stick to the bottom unless the user has scrolled up to read. */
const STICKY_PX = 40;

interface Props {
  transcript: Transcript;
  /** Off when the user paused scrolling. */
  autoScroll: boolean;
  clean: CleanItem[];
  label: string;
  replacements: Replacement[];
  onClear: () => void;
  onEditSentence: (key: string, text: string) => void;
  onAddCorrection: (heard: string, correct: string) => void;
  onRemoveCorrection: (heard: string) => void;
  /** Collapses the panel to a rail (the recording indicator is elsewhere and stays visible). */
  onCollapse?: () => void;
}

export function TranscriptPane(props: Props) {
  const { transcript, clean } = props;
  const [view, setView] = useState<'clean' | 'raw'>('clean');
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Before paint, so new lines never flash above the fold.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current && props.autoScroll) el.scrollTop = el.scrollHeight;
  }, [transcript, view, props.autoScroll]);

  const empty = transcript.lines.length === 0 && transcript.partial === null;
  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (editing) props.onEditSentence(editing.key, editing.text.trim());
    setEditing(null);
  };

  return (
    <section className="transcript" aria-label="Transcript">
      <h2>
        Transcript <span className="badge">{props.label}</span>
        <span className="view-toggle" role="group" aria-label="Transcript view">
          <button type="button" aria-pressed={view === 'clean'} onClick={() => setView('clean')}>
            Clean
          </button>
          <button type="button" aria-pressed={view === 'raw'} onClick={() => setView('raw')}>
            Raw
          </button>
        </span>
        <button type="button" className="link" onClick={props.onClear} disabled={empty}>
          Clear transcript
        </button>
        {props.onCollapse && (
          <button type="button" className="link" aria-label="Hide transcript" onClick={props.onCollapse}>
            ◂ Hide
          </button>
        )}
      </h2>
      <div
        className="transcript-scroll"
        ref={scrollRef}
        data-testid="transcript-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_PX;
        }}
      >
        {empty && <p className="muted">Nothing yet. Press Start and speak.</p>}
        <ol data-testid="transcript" data-view={view}>
          {view === 'raw'
            ? transcript.lines.map((line) =>
                line.kind === 'final' ? (
                  <li key={line.key} className="final">{line.text}</li>
                ) : (
                  <li key={line.key} className="gap">[audio gap, {line.seconds.toFixed(1)} s]</li>
                ),
              )
            : clean.map((item) => {
                if (item.kind === 'gap') {
                  return <li key={item.key} className="gap">[audio gap, {item.seconds.toFixed(1)} s]</li>;
                }
                if (editing?.key === item.key) {
                  return (
                    <li key={item.key} className="final">
                      <form onSubmit={saveEdit} className="edit">
                        <input
                          aria-label="Edit sentence"
                          value={editing.text}
                          onChange={(e) => setEditing({ key: item.key, text: e.target.value })}
                          autoFocus
                        />
                        <button type="submit">Save</button>
                        <button type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </form>
                    </li>
                  );
                }
                return (
                  <li key={item.key} className={`final${item.isQuestion ? ' question' : ''}`} title={`Heard: ${item.raw}`}>
                    {item.text}
                    {item.edited && <span className="muted"> (edited)</span>}
                    {!item.open && (
                      <button
                        type="button"
                        className="link edit-btn"
                        aria-label={`Edit: ${item.text}`}
                        onClick={() => setEditing({ key: item.key, text: item.text })}
                      >
                        Edit
                      </button>
                    )}
                  </li>
                );
              })}
          {transcript.partial !== null && (
            <li className="partial" data-testid="partial">{transcript.partial}</li>
          )}
        </ol>
      </div>
      <Corrections replacements={props.replacements} onAdd={props.onAddCorrection} onRemove={props.onRemoveCorrection} />
    </section>
  );
}

function Corrections({
  replacements,
  onAdd,
  onRemove,
}: {
  replacements: Replacement[];
  onAdd: (heard: string, correct: string) => void;
  onRemove: (heard: string) => void;
}) {
  const [heard, setHeard] = useState('');
  const [correct, setCorrect] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd(heard, correct);
    setHeard('');
    setCorrect('');
  };
  return (
    <details className="corrections">
      <summary>Fix recognition errors ({replacements.length})</summary>
      <p className="muted">Applies to the clean view of this and future recordings. The raw transcript is never changed.</p>
      <form onSubmit={submit}>
        <input aria-label="Heard as" placeholder="Heard as (e.g. cloud flair)" value={heard} onChange={(e) => setHeard(e.target.value)} />
        <input aria-label="Should be" placeholder="Should be (e.g. Cloudflare)" value={correct} onChange={(e) => setCorrect(e.target.value)} />
        <button type="submit" disabled={!heard.trim() || !correct.trim()}>
          Add
        </button>
      </form>
      <ul>
        {replacements.map((r) => (
          <li key={r.heard}>
            “{r.heard}” → “{r.correct}”{' '}
            <button type="button" className="link" aria-label={`Remove correction ${r.heard}`} onClick={() => onRemove(r.heard)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

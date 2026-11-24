import { useEffect, useRef } from 'react';
import type { Transcript } from '../session/transcript.ts';

/** Stick to the bottom unless the user has scrolled up to read. */
const STICKY_PX = 40;

export function TranscriptPane({
  transcript,
  label,
  onClear,
}: {
  transcript: Transcript;
  label: string;
  onClear: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const empty = transcript.lines.length === 0 && transcript.partial === null;
  return (
    <section className="transcript" aria-label="Transcript">
      <h2>
        Transcript <span className="badge">{label}</span>
        <button type="button" className="link" onClick={onClear} disabled={empty}>
          Clear transcript
        </button>
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
        <ol data-testid="transcript">
          {transcript.lines.map((line) =>
            line.kind === 'final' ? (
              <li key={line.key} className="final">{line.text}</li>
            ) : (
              <li key={line.key} className="gap">[audio gap, {line.seconds.toFixed(1)} s]</li>
            ),
          )}
          {transcript.partial !== null && (
            <li className="partial" data-testid="partial">{transcript.partial}</li>
          )}
        </ol>
      </div>
    </section>
  );
}

import type { Transcript } from '../session/transcript.ts';

export function TranscriptPane({ transcript }: { transcript: Transcript }) {
  const empty = transcript.lines.length === 0 && transcript.partial === null;
  return (
    <section className="transcript" aria-label="Transcript">
      <h2>
        Transcript <span className="badge">simulated</span>
      </h2>
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
    </section>
  );
}

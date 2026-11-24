import { useState } from 'react';
import { ACCURACY_SCRIPT, termRecall, wordErrorRate } from '../eval/score.ts';

interface Result {
  mode: string;
  wer: number;
  found: string[];
  missed: string[];
  p50: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** Read the script aloud while recording, then score the transcript against it. */
export function AccuracyCheck({ transcript, mode, latencies }: { transcript: string; mode: string; latencies: number[] }) {
  const [script, setScript] = useState(ACCURACY_SCRIPT);
  const [results, setResults] = useState<Result[]>([]);

  const score = () => {
    const recall = termRecall(script, transcript);
    setResults((r) => [...r, { mode, wer: wordErrorRate(script, transcript), ...recall, p50: median(latencies) }]);
  };

  return (
    <details className="accuracy">
      <summary>Accuracy check</summary>
      <p className="muted">
        Record yourself reading this text at a normal pace, press Stop, then score. Run it once per mode to compare.
      </p>
      <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={8} aria-label="Reference text" />
      <button type="button" onClick={score} disabled={!transcript}>
        Score transcript
      </button>
      {results.length > 0 && (
        <table data-testid="accuracy-results">
          <thead>
            <tr>
              <th>Mode</th>
              <th>Word error rate</th>
              <th>Tech terms</th>
              <th>Final latency p50</th>
              <th>Missed terms</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.mode}</td>
                <td>{(r.wer * 100).toFixed(1)}%</td>
                <td>
                  {r.found.length}/{r.found.length + r.missed.length}
                </td>
                <td>{r.p50 === null ? '—' : `${(r.p50 / 1000).toFixed(2)} s`}</td>
                <td>{r.missed.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

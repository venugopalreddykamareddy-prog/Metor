import { useState } from 'react';
import { ACCURACY_SCRIPT, termRecall, wordErrorRate } from '../eval/score.ts';

interface Result {
  mode: string;
  rawWer: number;
  cleanWer: number;
  rawTerms: number;
  cleanTerms: number;
  totalTerms: number;
  missed: string[];
  p50: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** Read the script aloud while recording, then score the raw and cleaned transcripts against it. */
export function AccuracyCheck({
  rawText,
  cleanText,
  mode,
  latencies,
}: {
  rawText: string;
  cleanText: string;
  mode: string;
  latencies: number[];
}) {
  const [script, setScript] = useState(ACCURACY_SCRIPT);
  const [results, setResults] = useState<Result[]>([]);

  const score = () => {
    const raw = termRecall(script, rawText);
    const cleaned = termRecall(script, cleanText);
    setResults((r) => [
      ...r,
      {
        mode,
        rawWer: wordErrorRate(script, rawText),
        cleanWer: wordErrorRate(script, cleanText),
        rawTerms: raw.found.length,
        cleanTerms: cleaned.found.length,
        totalTerms: cleaned.found.length + cleaned.missed.length,
        missed: cleaned.missed,
        p50: median(latencies),
      },
    ]);
  };

  return (
    <details className="accuracy">
      <summary>Accuracy check</summary>
      <p className="muted">
        Record yourself reading this text at a normal pace, press Stop, then score. Run it once per mode to compare.
      </p>
      <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={8} aria-label="Reference text" />
      <button type="button" onClick={score} disabled={!rawText}>
        Score transcript
      </button>
      {results.length > 0 && (
        <table data-testid="accuracy-results">
          <thead>
            <tr>
              <th>Mode</th>
              <th>WER raw</th>
              <th>WER clean</th>
              <th>Terms raw</th>
              <th>Terms clean</th>
              <th>Final latency p50</th>
              <th>Missed (clean)</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.mode}</td>
                <td>{(r.rawWer * 100).toFixed(1)}%</td>
                <td>{(r.cleanWer * 100).toFixed(1)}%</td>
                <td>
                  {r.rawTerms}/{r.totalTerms}
                </td>
                <td>
                  {r.cleanTerms}/{r.totalTerms}
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

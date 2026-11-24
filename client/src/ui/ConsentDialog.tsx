import { useState } from 'react';
import type { TranscriptionMode } from '../session/useRecorder.ts';

const WHERE_AUDIO_GOES: Record<TranscriptionMode, string> = {
  simulated:
    'Audio is streamed to the Metor server and not stored. Transcription is simulated: the text is canned and does not come from your speech.',
  webspeech:
    "Your browser's speech service turns audio into text. In Chrome and Edge that service runs on Google or Microsoft servers under their policies. No audio is sent to the Metor server.",
  groq: 'Audio is streamed to the Metor server, which sends speech segments to Groq for transcription (free tier). Groq does not keep them by default. Metor does not store audio.',
};

export function ConsentDialog({
  mode,
  onConfirm,
  onCancel,
}: {
  mode: TranscriptionMode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="dialog">
        <h2 id="consent-title">Start recording?</h2>
        <ul>
          <li>Metor captures your microphone until you press Stop. A red indicator shows while it is on.</li>
          <li>{WHERE_AUDIO_GOES[mode]}</li>
          <li>The transcript stays in this tab only.</li>
          <li>Only record others if they know and agree.</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I understand and want to start recording
        </label>
        <div className="actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={!agreed}>
            Start recording
          </button>
        </div>
      </div>
    </div>
  );
}

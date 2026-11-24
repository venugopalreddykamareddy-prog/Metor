import { useState } from 'react';

export function ConsentDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="dialog">
        <h2 id="consent-title">Start recording?</h2>
        <ul>
          <li>Metor captures your microphone until you press Stop. A red indicator shows while it is on.</li>
          <li>Audio is streamed to the Metor server and is not stored. The transcript stays in this tab only.</li>
          <li>Transcription is <strong>simulated</strong> in this version: the text is canned and does not come from your speech.</li>
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

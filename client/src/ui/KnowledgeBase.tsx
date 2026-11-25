import { useState } from 'react';
import { KB_KINDS, PROVENANCES, hasProvenance, type KbItem, type KbKind, type Provenance } from '../../../shared/kb.ts';
import { DEFAULT_PROFILE_ID } from '../../../shared/profile.ts';
import { setShared } from '../profile/profiles.ts';
import { RETENTION_DAYS, type RetentionDays, type SavedSession } from '../session/history.ts';

const KIND_LABEL: Record<KbKind, string> = {
  resume: 'Resume',
  job: 'Job description',
  story: 'Experience story',
  project: 'Project',
  skill: 'Skill',
  term: 'Internal term',
  reference: 'Reference note',
};
const PROVENANCE_HELP: Record<Provenance, string> = {
  verified: 'Verified: I did this hands-on',
  theoretical: 'Theoretical: I know it, no hands-on claim',
  hypothetical: 'Hypothetical: illustration only',
};
const MAX_IMPORT_BYTES = 200_000;

interface Props {
  /** The answer model selected now, e.g. "Groq GPT-OSS 120B"; null for Simulated. */
  provider: string | null;
  /** The active profile and the others it can share with (Phase 6). */
  profileId: string;
  profiles: { id: string; name: string }[];
  /** Only items this profile owns or that were shared with it. */
  items: KbItem[];
  error: string | null;
  onSave: (item: KbItem) => void;
  onRemove: (id: string) => void;
  persist: boolean;
  retentionDays: RetentionDays;
  onPersist: (on: boolean) => void;
  onRetention: (days: RetentionDays) => void;
  sessions: SavedSession[];
  onDeleteSession: (id: string) => void;
  onExport: () => void;
  onDeleteEverything: () => void;
}

/** Resume, job description, stories and notes (FR-K1–K6), plus opt-in session history (FR-S1b, FR-S4). */
export function KnowledgeBase(p: Props) {
  const [kind, setKind] = useState<KbKind>('resume');
  const [provenance, setProvenance] = useState<Provenance>('verified');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const importFile = async (file: File | undefined) => {
    setImportError(null);
    if (!file) return;
    if (!/\.(txt|md|markdown)$/i.test(file.name)) return setImportError('Only .txt and .md files can be imported.');
    if (file.size > MAX_IMPORT_BYTES) return setImportError('That file is over 200 KB.');
    setText(await file.text());
    if (!title) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, ''));
  };

  const add = () => {
    if (!title.trim() || !text.trim()) return;
    p.onSave({ id: crypto.randomUUID(), kind, provenance: hasProvenance(kind) ? provenance : 'verified', title: title.trim(), text: text.trim(), active: true, updatedAt: Date.now(), profileId: p.profileId });
    setTitle('');
    setText('');
  };

  return (
    <details className="accuracy kb" data-testid="kb">
      <summary>Knowledge base and history ({p.items.length} items)</summary>
      <p className="muted" data-testid="kb-disclosure">
        Stored only in this browser. For each question, the few excerpts that match it (never the whole knowledge base) are sent with the
        question to the selected answer model:{' '}
        {p.provider ? (
          <strong>{p.provider}, an AI provider outside Metor. Turn on Zero Data Retention in Groq.</strong>
        ) : (
          <strong>Simulated: nothing is sent to an AI provider.</strong>
        )}{' '}
        Untick "Use in answers" to keep an item out. Answers claim experience only from items marked verified. Deleting here doesn't delete
        what a provider already received.
      </p>
      {p.error && <p className="error">{p.error}</p>}

      <div className="kb-form">
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as KbKind)}>
            {KB_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {hasProvenance(kind) && (
          <label>
            Provenance
            <select value={provenance} onChange={(e) => setProvenance(e.target.value as Provenance)}>
              {PROVENANCES.map((v) => (
                <option key={v} value={v}>
                  {PROVENANCE_HELP[v]}
                </option>
              ))}
            </select>
          </label>
        )}
        <input aria-label="Title" placeholder={kind === 'term' ? 'Term, e.g. Shipyard' : 'Title'} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          aria-label="Content"
          rows={5}
          placeholder={kind === 'term' ? 'What it is, e.g. our internal deploy tool' : 'Paste text, or import a .txt or .md file'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="file">
          Import .txt or .md
          <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={(e) => void importFile(e.target.files?.[0])} />
        </label>
        {importError && <p className="error">{importError}</p>}
        <button type="button" onClick={add} disabled={!title.trim() || !text.trim()}>
          Add to knowledge base
        </button>
      </div>

      {p.items.length > 0 && (
        <ul className="kb-list" data-testid="kb-list">
          {p.items.map((item) => {
            const owner = item.profileId ?? DEFAULT_PROFILE_ID;
            const own = owner === p.profileId;
            const others = p.profiles.filter((o) => o.id !== p.profileId);
            return (
              <li key={item.id}>
                {own && (
                  <label className="check">
                    <input type="checkbox" checked={item.active} onChange={(e) => p.onSave({ ...item, active: e.target.checked, updatedAt: Date.now() })} />
                    Use in answers
                  </label>
                )}{' '}
                <strong>{item.title}</strong> <span className="badge">{KIND_LABEL[item.kind]}</span>
                {hasProvenance(item.kind) && <span className={`badge provenance-${item.provenance}`}>{item.provenance}</span>}{' '}
                <span className="muted">{item.text.length.toLocaleString()} chars</span>{' '}
                {own ? (
                  <>
                    {others.length > 0 && (
                      <span className="share" role="group" aria-label={`Share ${item.title} with`}>
                        Share with:{' '}
                        {others.map((o) => (
                          <label key={o.id} className="check">
                            <input type="checkbox" checked={(item.sharedWith ?? []).includes(o.id)} onChange={(e) => p.onSave(setShared(item, o.id, e.target.checked))} />
                            {o.name}
                          </label>
                        ))}
                      </span>
                    )}{' '}
                    <button type="button" className="link" onClick={() => p.onRemove(item.id)}>
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <span className="badge" data-testid="shared-from">
                      Shared from {p.profiles.find((o) => o.id === owner)?.name ?? 'another profile'}
                    </span>{' '}
                    <button type="button" className="link" onClick={() => p.onSave(setShared(item, p.profileId, false))}>
                      Remove from this profile
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3>Session history</h3>
      <label className="check">
        <input type="checkbox" checked={p.persist} onChange={(e) => p.onPersist(e.target.checked)} />
        Save transcripts and answers on this device when I press Stop (off by default; audio is never saved)
      </label>
      {p.persist && (
        <label>
          Keep for{' '}
          <select value={p.retentionDays} onChange={(e) => p.onRetention(e.target.value as RetentionDays)}>
            {RETENTION_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      )}
      {p.sessions.length > 0 && (
        <ul className="kb-list" data-testid="session-list">
          {p.sessions.map((s) => (
            <li key={s.id}>
              {new Date(s.startedAt).toLocaleString()} · {s.mode} · {s.answers.length} answers
              {(() => {
                const incomplete = s.answers.filter((a) => a.status !== 'done').length;
                return incomplete ? ` (${incomplete} incomplete)` : '';
              })()}
              {s.transcriptComplete === false && ' · last part of the transcript may be missing'} · expires{' '}
              {new Date(s.expiresAt).toLocaleDateString()}{' '}
              <button type="button" className="link" onClick={() => p.onDeleteSession(s.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" onClick={p.onExport}>
          Export all (JSON)
        </button>
        <button type="button" className="danger" onClick={p.onDeleteEverything}>
          Delete everything
        </button>
      </div>
    </details>
  );
}

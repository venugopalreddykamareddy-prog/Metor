import { useState } from 'react';
import { ROLES, ROLE_TEMPLATES, newProfile, type Profile, type Role } from '../../../shared/profile.ts';

const list = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);

interface Props {
  profiles: Profile[];
  active: Profile;
  /** Switching is off while recording, so a recording never spans two profiles. */
  locked: boolean;
  onSelect: (id: string) => void;
  onSave: (p: Profile) => void;
  onDelete: (id: string) => void;
}

/** Interview profile picker and editor (Phase 6). Each profile keeps its own data. */
export function ProfileBar({ profiles, active, locked, onSelect, onSave, onDelete }: Props) {
  const [newRole, setNewRole] = useState<Role>('qa_manual');
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState<Profile>(active);
  if (draft.id !== active.id) setDraft(active);

  const create = () => {
    const p = newProfile(newRole, newName, crypto.randomUUID(), Date.now());
    onSave(p);
    onSelect(p.id);
    setNewName('');
  };

  return (
    <div className="profile-bar" data-testid="profile-bar">
      <label>
        Profile
        <select value={active.id} onChange={(e) => onSelect(e.target.value)} disabled={locked} title={locked ? 'Stop recording to switch profile' : undefined}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <details className="profile-edit">
        <summary>Edit profiles</summary>
        <p className="muted">
          Each profile has its own knowledge base, vocabulary, answer preferences, history and cached answers. Items are shared with another
          profile only when you tick "Share with" on them.
        </p>
        <div className="kb-form">
          <label>
            Name <input aria-label="Profile name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <span className="muted">Role: {ROLE_TEMPLATES[draft.role].label}</span>
          <label>
            Level <input aria-label="Level" placeholder="e.g. Senior" value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })} />
          </label>
          <label>
            Topics
            <input aria-label="Topics" value={draft.topics.join(', ')} onChange={(e) => setDraft({ ...draft, topics: list(e.target.value) })} />
          </label>
          <label>
            Vocabulary
            <input
              aria-label="Vocabulary"
              title="Spellings to help transcription; nothing is auto-corrected from them"
              value={draft.vocabulary.join(', ')}
              onChange={(e) => setDraft({ ...draft, vocabulary: list(e.target.value) })}
            />
          </label>
          <fieldset>
            <legend>Answer preferences</legend>
            <label className="check">
              <input type="checkbox" checked={draft.prefs.openers} onChange={(e) => setDraft({ ...draft, prefs: { ...draft.prefs, openers: e.target.checked } })} />
              Natural opening and closing lines
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.prefs.star} onChange={(e) => setDraft({ ...draft, prefs: { ...draft.prefs, star: e.target.checked } })} />
              STAR for behavioral questions (verified experience only)
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.prefs.examples} onChange={(e) => setDraft({ ...draft, prefs: { ...draft.prefs, examples: e.target.checked } })} />
              Practical examples in technical answers
            </label>
          </fieldset>
          <div className="actions">
            <button type="button" onClick={() => onSave(draft)}>
              Save profile
            </button>
            <button
              type="button"
              className="danger"
              disabled={locked || profiles.length <= 1}
              onClick={() => window.confirm(`Delete "${active.name}" and its knowledge base, history, practice questions and corrections?`) && onDelete(active.id)}
            >
              Delete profile
            </button>
          </div>
        </div>
        <div className="kb-form">
          <label>
            New profile
            <select aria-label="New profile role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_TEMPLATES[r].label}
                </option>
              ))}
            </select>
          </label>
          <input aria-label="New profile name" placeholder={newRole === 'custom' ? 'Role title, e.g. Data Engineer' : 'Name (optional)'} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="button" onClick={create} disabled={locked || (newRole === 'custom' && !newName.trim())}>
            Add profile
          </button>
        </div>
      </details>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { login } from '../api.ts';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(passphrase);
      if (result.ok) onLoggedIn();
      else setError(result.error);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
      setPassphrase('');
    }
  };

  return (
    <main className="login">
      <h1>Metor</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="passphrase">Passphrase</label>
        <input
          id="passphrase"
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          required
        />
        <button type="submit" disabled={busy || !passphrase}>
          Log in
        </button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </main>
  );
}

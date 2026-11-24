export interface Me {
  providers: { groq: boolean };
}

/** null when not logged in. */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch('/api/me');
  return res.ok ? ((await res.json()) as Me) : null;
}

interface Window {
  requests: number;
  units: number;
}
interface Metered {
  lastMinute: Window;
  lastHour: Window;
  lastDay: Window;
  limits: { perMinute: Window; perHour: Window; perDay: Window };
  unit: string;
}
export interface Usage {
  groq: { transcription: Metered; answers: Metered } | null;
}

export async function fetchUsage(): Promise<Usage> {
  const res = await fetch('/api/usage');
  if (!res.ok) throw new Error(`usage: HTTP ${res.status}`);
  return (await res.json()) as Usage;
}

export async function login(passphrase: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, error: 'Wrong passphrase.' };
  if (res.status === 429) {
    const minutes = Math.ceil(Number(res.headers.get('retry-after') ?? 900) / 60);
    return { ok: false, error: `Too many attempts. Try again in ${minutes} min.` };
  }
  return { ok: false, error: `Login failed (HTTP ${res.status}).` };
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

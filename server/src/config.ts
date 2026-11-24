export interface ServerConfig {
  host: string;
  port: number;
  production: boolean;
  allowedOrigins: ReadonlySet<string>;
}

const DEV_CLIENT_PORT = 5173;

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

/** Origins allowed to open /ws: local dev and own port, Codespaces forwarded URLs, plus ALLOWED_ORIGINS. */
export function buildAllowedOrigins(env: NodeJS.ProcessEnv, port: number): Set<string> {
  const origins = new Set<string>();
  for (const p of new Set([port, DEV_CLIENT_PORT])) {
    origins.add(`http://localhost:${p}`);
    origins.add(`http://127.0.0.1:${p}`);
  }
  const codespace = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (codespace && domain) {
    for (const p of new Set([port, DEV_CLIENT_PORT])) {
      origins.add(`https://${codespace}-${p}.${domain}`);
    }
  }
  for (const origin of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed.replace(/\/$/, ''));
  }
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = parsePort(env.PORT, 8787);
  return {
    // Loopback only: Codespaces port forwarding still reaches it, nothing else on the network can.
    host: '127.0.0.1',
    port,
    production: env.NODE_ENV === 'production',
    allowedOrigins: buildAllowedOrigins(env, port),
  };
}

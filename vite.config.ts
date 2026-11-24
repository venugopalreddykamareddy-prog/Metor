import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = `127.0.0.1:${process.env.PORT ?? '8787'}`;
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
// In a Codespace the page is served from this forwarded host over HTTPS.
const codespaceHost =
  CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : undefined;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Vite rejects unknown Host headers; allow only this Codespace's forwarded host.
    allowedHosts: codespaceHost ? [codespaceHost] : [],
    hmr: codespaceHost ? { clientPort: 443 } : undefined,
    proxy: {
      '/ws': { target: `ws://${SERVER}`, ws: true },
      '/api': { target: `http://${SERVER}` },
      '/healthz': { target: `http://${SERVER}` },
    },
  },
});

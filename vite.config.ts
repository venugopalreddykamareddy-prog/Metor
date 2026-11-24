import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = `127.0.0.1:${process.env.PORT ?? '8787'}`;
// Inside GitHub Codespaces the page is served from https://<codespace>-5173.<domain>.
const inCodespaces = Boolean(process.env.CODESPACE_NAME);
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;

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
    // Accept the Codespaces forwarded host name (Vite blocks unknown Host headers by default).
    allowedHosts: forwardingDomain ? [`.${forwardingDomain}`] : [],
    // The forwarded URL is HTTPS on 443, so the HMR socket must use that port.
    hmr: inCodespaces ? { clientPort: 443 } : undefined,
    proxy: {
      '/ws': { target: `ws://${SERVER}`, ws: true },
      '/api': { target: `http://${SERVER}` },
      '/healthz': { target: `http://${SERVER}` },
    },
  },
});

// Separate from index.ts so tests can build the app without listening on a port.
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { MAX_PAYLOAD_BYTES } from '../../shared/messages.ts';
import type { ServerConfig } from './config.ts';
import { registerGateway } from './ws/gateway.ts';

interface BuildOptions {
  logger?: boolean;
  /** Where log lines go (default stdout). Tests use it to inspect logs. */
  logStream?: { write(line: string): void };
}

export async function buildApp(config: ServerConfig, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: (opts.logger ?? true)
      ? {
          level: config.production ? 'info' : 'debug',
          // Never log cookies or auth headers (SECURITY_PRIVACY §5).
          redact: ['req.headers.cookie', 'req.headers.authorization'],
          ...(opts.logStream ? { stream: opts.logStream } : {}),
        }
      : false,
    bodyLimit: MAX_PAYLOAD_BYTES,
  });

  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

  app.get('/healthz', async () => ({ status: 'ok' }));

  await registerGateway(app, { allowedOrigins: config.allowedOrigins });

  if (config.production) {
    // Compiled layout: dist/server/src/app.js → dist/client/
    const root = fileURLToPath(new URL('../../client/', import.meta.url));
    await app.register(fastifyStatic, { root });
  }

  return app;
}

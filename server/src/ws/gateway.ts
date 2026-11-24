import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import {
  parseClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '../../../shared/messages.ts';

export interface GatewayOptions {
  allowedOrigins: ReadonlySet<string>;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  send(socket, { type: 'error', id: randomUUID(), ts: Date.now(), code, message, retryable: false });
}

export async function registerGateway(app: FastifyInstance, opts: GatewayOptions): Promise<void> {
  app.get(
    '/ws',
    {
      websocket: true,
      // Browsers always send Origin on WebSocket upgrades, so a missing one is rejected too.
      // This blocks other websites from opening a socket; it is not authentication (Phase 2).
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        if (!origin || !opts.allowedOrigins.has(origin)) {
          request.log.warn({ origin: origin ?? null }, 'ws upgrade rejected: origin not allowed');
          await reply.code(403).send({ error: 'origin not allowed' });
        }
      },
    },
    (socket, request) => {
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          sendError(socket, 'bad_request', 'binary frames are not supported');
          return;
        }
        const parsed = parseClientMessage(data.toString());
        if (!parsed.ok) {
          request.log.debug({ issue: parsed.issue }, 'invalid ws message');
          sendError(socket, 'bad_request', parsed.error.slice(0, 200));
          return;
        }
        const msg = parsed.value;
        switch (msg.type) {
          case 'echo.request':
            send(socket, { type: 'echo', id: msg.id, ts: Date.now(), text: msg.text });
            break;
        }
      });
    },
  );
}

// WebSocket gateway: Origin check on upgrade, schema validation of every frame, echo reply.
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

let counter = 0;
function nextId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  send(socket, { type: 'error', id: nextId(), ts: Date.now(), code, message, retryable: false });
}

export async function registerGateway(app: FastifyInstance, opts: GatewayOptions): Promise<void> {
  app.get(
    '/ws',
    {
      websocket: true,
      // Runs before the upgrade. Browsers always send Origin on WebSocket requests.
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
          // Log only the validation error, never the message content.
          request.log.debug({ error: parsed.error }, 'invalid ws message');
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

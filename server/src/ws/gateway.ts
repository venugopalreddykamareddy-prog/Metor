import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { decodeAudioFrame, parseClientMessage, type ErrorCode } from '../../../shared/messages.ts';
import { readSessionCookie } from '../auth/routes.ts';
import type { AuthSessions } from '../auth/sessions.ts';
import { AnswerSession, type AnswerDeps } from '../answer/engine.ts';
import type { SttFactory } from '../stt/types.ts';
import { send, type Recording, type Recordings } from './recording.ts';

// Real-time audio is 10 frames/s. The burst allows resending a few seconds of buffered audio after a reconnect.
const FRAME_BURST = 60;
const FRAMES_PER_SECOND = 20;

export interface GatewayOptions {
  allowedOrigins: ReadonlySet<string>;
  sessions: AuthSessions;
  recordings: Recordings;
  /** Server-side transcription modes; `groq` is present only when GROQ_API_KEY is set. */
  stt: { simulated: SttFactory; groq?: SttFactory };
  answers: AnswerDeps;
}

function sendError(socket: WebSocket, code: ErrorCode, message: string, retryable = false): void {
  send(socket, { type: 'error', code, message, retryable });
}

/** Token bucket: returns false when the client sends audio faster than real time allows. */
function frameLimiter(): () => boolean {
  let tokens = FRAME_BURST;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(FRAME_BURST, tokens + ((now - last) / 1000) * FRAMES_PER_SECOND);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export async function registerGateway(app: FastifyInstance, opts: GatewayOptions): Promise<void> {
  app.get(
    '/ws',
    {
      websocket: true,
      // Browsers always send Origin on WebSocket upgrades, so a missing one is rejected too.
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        if (!origin || !opts.allowedOrigins.has(origin)) {
          request.log.warn({ origin: origin ?? null }, 'ws upgrade rejected: origin not allowed');
          await reply.code(403).send({ error: 'origin not allowed' });
          return;
        }
        if (!opts.sessions.isValid(readSessionCookie(request))) {
          await reply.code(401).send({ error: 'not logged in' });
        }
      },
    },
    (socket, request) => {
      const authId = readSessionCookie(request);
      if (!opts.sessions.isValid(authId)) {
        socket.close(1008, 'not logged in');
        return;
      }
      opts.sessions.addSocket(authId, socket);
      const allowFrame = frameLimiter();
      let recording: Recording | null = null;
      const answers = new AnswerSession(opts.answers, (body) => send(socket, body));

      socket.on('message', (data, isBinary) => {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        if (isBinary) {
          if (!recording) return sendError(socket, 'no_session', 'send session.start first');
          if (!allowFrame()) {
            sendError(socket, 'rate_limited', 'audio faster than real time');
            socket.close(1008, 'rate limited');
            return;
          }
          const frame = decodeAudioFrame(bytes);
          if (!frame.ok) return sendError(socket, 'bad_request', frame.error);
          recording.handleAudio(frame.seq, frame.samples, bytes.byteLength);
          return;
        }

        const parsed = parseClientMessage(bytes.toString());
        if (!parsed.ok) {
          request.log.debug({ issue: parsed.issue }, 'invalid ws message');
          return sendError(socket, 'bad_request', parsed.error.slice(0, 200));
        }
        const msg = parsed.value;
        switch (msg.type) {
          case 'session.start': {
            const createStt = opts.stt[msg.mode];
            if (!createStt) return sendError(socket, 'provider_unavailable', `${msg.mode} transcription is not configured`);
            if (recording) opts.recordings.remove(recording.id);
            recording = opts.recordings.start(authId, socket, createStt);
            request.log.info({ sessionId: recording.id, mode: msg.mode }, 'recording started');
            send(socket, { type: 'session.started', sessionId: recording.id });
            break;
          }
          case 'session.resume':
            recording = opts.recordings.resume(authId, msg.sessionId, socket, msg.lastFinalSeq) ?? null;
            if (!recording) return sendError(socket, 'session_expired', 'recording session is gone');
            request.log.info({ sessionId: recording.id }, 'recording resumed');
            break;
          case 'answer.request':
            void answers.handle(msg);
            break;
          case 'answer.cancel':
            answers.cancel(msg.questionId);
            break;
          case 'session.stop':
            if (!recording) return;
            recording.stop();
            opts.recordings.remove(recording.id);
            request.log.info({ sessionId: recording.id }, 'recording stopped');
            recording = null;
            break;
        }
      });

      socket.on('close', (code) => {
        answers.close();
        if (!recording) return;
        request.log.info({ sessionId: recording.id, code }, 'recording disconnected');
        opts.recordings.disconnected(recording, socket);
      });
    },
  );
}

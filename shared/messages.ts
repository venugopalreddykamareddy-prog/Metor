// WebSocket message schemas shared by client and server (ARCHITECTURE §6.2).
// Every message is JSON: { type, id, ts, ...payload }. Phase 1 only defines the echo protocol.
import { z } from 'zod';

export const MAX_TEXT_LENGTH = 2000;
/** Max WebSocket frame size accepted by the server, in bytes. */
export const MAX_PAYLOAD_BYTES = 16 * 1024;

const envelope = {
  id: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
};

// Client → server
export const echoRequestSchema = z.strictObject({
  type: z.literal('echo.request'),
  ...envelope,
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export const clientMessageSchema = z.discriminatedUnion('type', [echoRequestSchema]);

// Server → client
export const echoSchema = z.strictObject({
  type: z.literal('echo'),
  ...envelope,
  text: z.string().max(MAX_TEXT_LENGTH),
});

export const errorCodeSchema = z.enum(['bad_request']);

export const errorSchema = z.strictObject({
  type: z.literal('error'),
  ...envelope,
  code: errorCodeSchema,
  message: z.string().max(200),
  retryable: z.boolean(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [echoSchema, errorSchema]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    return { ok: false, error: `${path}: ${issue?.message ?? 'invalid message'}` };
  }
  return { ok: true, value: result.data };
}

/** Parse and validate a raw client→server frame. Never throws. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, raw);
}

/** Parse and validate a raw server→client frame. Never throws. */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWith(serverMessageSchema, raw);
}

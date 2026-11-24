import { describe, expect, it } from 'vitest';
import { MAX_TEXT_LENGTH, parseClientMessage, parseServerMessage } from './messages.ts';

const valid = { type: 'echo.request', id: 'abc', ts: 1, text: 'hello' };

describe('parseClientMessage', () => {
  it('accepts a valid echo.request', () => {
    expect(parseClientMessage(JSON.stringify(valid))).toEqual({ ok: true, value: valid });
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['non-object', '"hello"'],
    ['null', 'null'],
    ['unknown type', JSON.stringify({ ...valid, type: 'session.start' })],
    ['missing id', JSON.stringify({ type: 'echo.request', ts: 1, text: 'x' })],
    ['empty id', JSON.stringify({ ...valid, id: '' })],
    ['negative ts', JSON.stringify({ ...valid, ts: -1 })],
    ['non-integer ts', JSON.stringify({ ...valid, ts: 1.5 })],
    ['empty text', JSON.stringify({ ...valid, text: '' })],
    ['text too long', JSON.stringify({ ...valid, text: 'x'.repeat(MAX_TEXT_LENGTH + 1) })],
    ['extra field', JSON.stringify({ ...valid, admin: true })],
    ['wrong text type', JSON.stringify({ ...valid, text: 42 })],
  ])('rejects %s', (_label, raw) => {
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(false);
  });

  it('reports a readable error with the failing path', () => {
    const result = parseClientMessage(JSON.stringify({ ...valid, text: '' }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('text') });
  });

  it('gives a fixed issue code alongside the error', () => {
    expect(parseClientMessage('{bad')).toMatchObject({ ok: false, issue: 'invalid_json' });
    const extra = parseClientMessage(JSON.stringify({ ...valid, extra: 1 }));
    expect(extra).toMatchObject({ ok: false, issue: 'unrecognized_keys' });
  });

  it('accepts text at the maximum length', () => {
    const raw = JSON.stringify({ ...valid, text: 'x'.repeat(MAX_TEXT_LENGTH) });
    expect(parseClientMessage(raw).ok).toBe(true);
  });
});

describe('parseServerMessage', () => {
  it('accepts echo and error messages', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'echo', id: 'a', ts: 1, text: 'hi' })).ok).toBe(true);
    const err = { type: 'error', id: 'a', ts: 1, code: 'bad_request', message: 'x', retryable: false };
    expect(parseServerMessage(JSON.stringify(err)).ok).toBe(true);
  });

  it('rejects unknown error codes and client-only types', () => {
    const err = { type: 'error', id: 'a', ts: 1, code: 'boom', message: 'x', retryable: false };
    expect(parseServerMessage(JSON.stringify(err)).ok).toBe(false);
    expect(parseServerMessage(JSON.stringify(valid)).ok).toBe(false);
  });
});

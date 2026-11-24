import { describe, expect, it } from 'vitest';
import { hashPassphrase, parsePassphraseHash, verifyPassphrase } from './passphrase.ts';

describe('passphrase hashing', () => {
  it('verifies the right passphrase and rejects others', async () => {
    const hash = parsePassphraseHash(await hashPassphrase('correct horse battery'));
    expect(await verifyPassphrase('correct horse battery', hash)).toBe(true);
    expect(await verifyPassphrase('correct horse batterY', hash)).toBe(false);
    expect(await verifyPassphrase('', hash)).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassphrase('same')).not.toBe(await hashPassphrase('same'));
  });

  it.each(['', 'bcrypt:1:2:3:abc:def', 'scrypt:16384:8:1:c2FsdA==:a2V5', 'scrypt:x:8:1:AAAAAAAAAAAAAAAAAAAAAA==:AAAA'])(
    'rejects malformed hash %j',
    (value) => {
      expect(() => parsePassphraseHash(value)).toThrow(/malformed/);
    },
  );
});

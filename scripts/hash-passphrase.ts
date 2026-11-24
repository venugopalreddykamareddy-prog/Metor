// Usage: read -rs P && printf %s "$P" | pnpm -s hash-passphrase; unset P
import { hashPassphrase } from '../server/src/auth/passphrase.ts';

let input = '';
for await (const chunk of process.stdin) input += String(chunk);
const passphrase = input.replace(/\r?\n$/, '');
if (passphrase.length < 12) {
  console.error('Use a passphrase of at least 12 characters.');
  process.exit(1);
}
console.log(`APP_PASSPHRASE_HASH=${await hashPassphrase(passphrase)}`);

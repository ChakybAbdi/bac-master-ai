// Creates .env from .env.example with a random administrator password.
// Safe to run again: an existing .env is left untouched.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists: nothing changed.');
  process.exit(0);
}
if (!existsSync('.env.example')) {
  console.error('Run this command from the project folder (the one that holds .env.example).');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');
const env = readFileSync('.env.example', 'utf8').replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`);
writeFileSync('.env', env, { mode: 0o600 });

const email = /^ADMIN_EMAIL=(.*)$/m.exec(env)?.[1] ?? '';
console.log('Created .env');
console.log(`Administrator e-mail: ${email}`);
console.log('Administrator password: written to .env (ADMIN_PASSWORD). Keep that file private.');

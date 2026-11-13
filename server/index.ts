import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { scheduleBackups } from './backup.ts';
import { ensureAdmin } from './auth.ts';
import { openDb, run } from './db.ts';
import { monitoringDir } from './monitoring.ts';
import { seed } from './seed.ts';
import { aiStatus } from './tutor.ts';
import { nowIso } from './util.ts';

// An empty value in .env must count as "not set": the Anthropic SDK would
// otherwise treat the empty string as a credential.
for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE']) {
  if (process.env[key]?.trim() === '') delete process.env[key];
}

const dataDir = resolve(process.env.DATA_DIR?.trim() || './data');
const db = openDb(join(dataDir, 'bacmaster.db'));

if (seed(db)) console.log('[setup] database created and seeded');
run(db, 'DELETE FROM sessions WHERE expires_at <= ?', nowIso());

if (process.env.BACKUPS?.trim().toLowerCase() !== 'off') scheduleBackups(db, dataDir);

const admin = await ensureAdmin(db);
if (admin === 'created') console.log(`[setup] administrator account created for ${process.env.ADMIN_EMAIL}`);
if (admin === 'missing-config') {
  console.warn(
    '[setup] no administrator account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (10 characters or more) in .env, or run "npm run setup", then restart.',
  );
}

const app = createApp(db);
const port = Number(process.env.PORT) || 8787;
const hostname = process.env.HOST?.trim() || '127.0.0.1';

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  const ai = aiStatus();
  console.log(`[server] BAC MASTER AI API listening on http://${hostname}:${info.port}`);
  console.log(`[server] web client: ${existsSync(resolve('dist/index.html')) ? `http://${hostname}:${info.port}` : 'not built (use "npm run dev", or "npm run build" then "npm start")'}`);
  console.log(`[server] monitoring folder: ${monitoringDir()}`);
  console.log(
    `[server] AI tutor: ${ai.enabled ? `enabled (${ai.model})` : 'no model configured, answering from the knowledge base only'}`,
  );
});

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

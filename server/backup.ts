import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.ts';
import { todayInAlgiers } from './util.ts';

/**
 * Daily database backups: `VACUUM INTO` writes a consistent copy while the server keeps running.
 * One file per day in <data>/backups, the most recent BACKUP_KEEP_DAYS kept (default 14).
 * Hosted PDFs (data/papers) never change once written, so they are not copied here:
 * back that folder up once and then incrementally.
 */
export function backupNow(db: DB, dataDir: string): string | null {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `bacmaster-${todayInAlgiers()}.db`);
  try {
    statSync(file);
    return null; // today's copy already exists
  } catch {
    // no copy yet today
  }
  db.prepare('VACUUM INTO ?').run(file);
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS) || 14);
  const copies = readdirSync(dir)
    .filter((name) => /^bacmaster-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .reverse();
  for (const old of copies.slice(keep)) rmSync(join(dir, old), { force: true });
  return file;
}

/** Backs up at startup, then checks every hour whether the day has changed. */
export function scheduleBackups(db: DB, dataDir: string): () => void {
  const run = (): void => {
    try {
      const file = backupNow(db, dataDir);
      if (file) console.log(`[backup] database copied to ${file}`);
    } catch (err) {
      console.error('[backup] failed', err);
    }
  };
  run();
  const timer = setInterval(run, 3600_000);
  timer.unref();
  return () => clearInterval(timer);
}

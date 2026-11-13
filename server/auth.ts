import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Role, User } from '../shared/types.ts';
import { all, audit, get, run, type DB } from './db.ts';
import { HttpError, clientIp, nowIso, rateLimit, readBody } from './util.ts';

export type AppEnv = { Variables: { user: User | null } };

const COOKIE = 'bm_session';
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const USER_COLUMNS = 'id, email, name, role, locale, edition_id, stream_id, created_at';

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N, r, p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A fixed hash to compare against when the e-mail is unknown, so that the
// response time does not reveal whether an account exists.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createSession(db: DB, userId: string): { token: string; maxAge: number } {
  const token = randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 86_400;
  run(
    db,
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    hashToken(token),
    userId,
    nowIso(),
    new Date(Date.now() + maxAge * 1000).toISOString(),
  );
  return { token, maxAge };
}

export function userFromToken(db: DB, token: string | undefined): User | null {
  if (!token) return null;
  const row = get<User & { expires_at: string }>(
    db,
    `SELECT u.id, u.email, u.name, u.role, u.locale, u.edition_id, u.stream_id, u.created_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    hashToken(token),
  );
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    run(db, 'DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
    return null;
  }
  const { expires_at: _expires, ...user } = row;
  return user;
}

export function getUser(db: DB, id: string): User | undefined {
  return get<User>(db, `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, id);
}

export function listUsers(db: DB): User[] {
  return all<User>(db, `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC LIMIT 500`);
}

export async function createUser(
  db: DB,
  input: { name: string; email: string; password: string; role: Role; locale: 'fr' | 'ar' },
): Promise<User> {
  const id = randomUUID();
  const active = get<{ id: number }>(db, "SELECT id FROM editions WHERE status = 'ACTIVE' ORDER BY exam_year LIMIT 1");
  run(
    db,
    'INSERT INTO users (id, email, name, password_hash, role, locale, edition_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    input.email,
    input.name,
    await hashPassword(input.password),
    input.role,
    input.locale,
    active?.id ?? null,
    nowIso(),
  );
  return getUser(db, id)!;
}

/** Creates the first administrator from the environment when none exists yet. */
export async function ensureAdmin(db: DB): Promise<'exists' | 'created' | 'missing-config'> {
  const existing = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  if (existing && existing.n > 0) return 'exists';
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email || password.length < 10) return 'missing-config';
  const admin = await createUser(db, {
    name: process.env.ADMIN_NAME?.trim() || 'Administrateur',
    email,
    password,
    role: 'admin',
    locale: 'fr',
  });
  audit(db, null, 'user.create_admin', 'user', admin.id, { email });
  return 'created';
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'Lax' as const,
  path: '/',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge,
});

export const loadUser = (db: DB): MiddlewareHandler<AppEnv> => async (c, next) => {
  c.set('user', userFromToken(db, getCookie(c, COOKIE)));
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  await next();
};

export const requireRole = (...roles: Role[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  if (!roles.includes(user.role)) throw new HttpError(403, 'forbidden', 'Your account cannot do this.');
  await next();
};

/** The signed-in user. Only call behind requireAuth / requireRole. */
export function currentUser(c: { get: (key: 'user') => User | null }): User {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  return user;
}

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  password: z.string().min(8).max(200),
  locale: z.enum(['fr', 'ar']).default('fr'),
});

const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(200) });

const RESET_HOURS = 24;

/**
 * Issues a one-time password reset token for a user. Only its hash is stored; earlier unused
 * links for the same user stop working, so only the latest link handed out is valid.
 */
export function createPasswordReset(db: DB, userId: string, actorId: string | null): { token: string; expires_at: string } {
  const token = randomBytes(32).toString('base64url');
  const expires_at = new Date(Date.now() + RESET_HOURS * 3600_000).toISOString();
  run(db, 'DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', userId);
  run(
    db,
    'INSERT INTO password_resets (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    hashToken(token),
    userId,
    actorId,
    nowIso(),
    expires_at,
  );
  return { token, expires_at };
}

export function authRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/register', async (c) => {
    rateLimit(`register:${clientIp(c)}`, 10, 10 * 60_000);
    const input = await readBody(c, registerSchema);
    if (get(db, 'SELECT 1 FROM users WHERE email = ?', input.email)) {
      throw new HttpError(409, 'email_taken', 'An account already uses this e-mail address.');
    }
    const user = await createUser(db, { ...input, role: 'student' });
    const session = createSession(db, user.id);
    setCookie(c, COOKIE, session.token, cookieOptions(session.maxAge));
    audit(db, user, 'user.register', 'user', user.id);
    return c.json({ user }, 201);
  });

  app.post('/login', async (c) => {
    const input = await readBody(c, loginSchema);
    rateLimit(`login:${clientIp(c)}:${input.email}`, 10, 5 * 60_000);
    const row = get<{ id: string; password_hash: string }>(
      db,
      'SELECT id, password_hash FROM users WHERE email = ?',
      input.email,
    );
    const ok = await verifyPassword(input.password, row?.password_hash ?? (await DUMMY_HASH));
    if (!row || !ok) throw new HttpError(401, 'invalid_credentials', 'Wrong e-mail address or password.');
    const session = createSession(db, row.id);
    setCookie(c, COOKIE, session.token, cookieOptions(session.maxAge));
    return c.json({ user: getUser(db, row.id) });
  });

  // Sets a new password from a one-time link. Every existing session of the account is closed.
  app.post('/reset', async (c) => {
    rateLimit(`reset:${clientIp(c)}`, 10, 10 * 60_000);
    const input = await readBody(c, resetSchema);
    const row = get<{ user_id: string }>(
      db,
      'SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
      hashToken(input.token),
      nowIso(),
    );
    if (!row) throw new HttpError(400, 'reset_invalid', 'This link is invalid, already used or expired.');
    const hash = await hashPassword(input.password);
    run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', hash, row.user_id);
    run(db, 'UPDATE password_resets SET used_at = ? WHERE token_hash = ?', nowIso(), hashToken(input.token));
    run(db, 'DELETE FROM sessions WHERE user_id = ?', row.user_id);
    const user = getUser(db, row.user_id);
    audit(db, user ?? null, 'user.password_reset', 'user', row.user_id);
    const session = createSession(db, row.user_id);
    setCookie(c, COOKIE, session.token, cookieOptions(session.maxAge));
    return c.json({ user });
  });

  app.post('/logout', (c) => {
    const token = getCookie(c, COOKIE);
    if (token) run(db, 'DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', (c) => c.json({ user: c.get('user') }));

  return app;
}

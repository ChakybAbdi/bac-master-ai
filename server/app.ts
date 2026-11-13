import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Edition, Meta, Stream, Subject } from '../shared/types.ts';
import { authRoutes, loadUser, type AppEnv } from './auth.ts';
import { all, type DB } from './db.ts';
import { lastCheck } from './monitoring.ts';
import { adminRoutes } from './routes/admin.ts';
import { studentRoutes } from './routes/student.ts';
import { aiStatus } from './tutor.ts';
import { HttpError } from './util.ts';

export function createApp(db: DB, distDir = resolve('dist')): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // KaTeX positions glyphs with inline style attributes.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    }),
  );

  // Session cookies are SameSite=Lax; this refuses state-changing requests sent from another site.
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          // An unparsable Origin never matches.
        }
        const hosts = [c.req.header('host'), c.req.header('x-forwarded-host')];
        if (!hosts.includes(originHost)) throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
      }
    }
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.use('/api/*', loadUser(db));

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/meta', (c) => {
    const meta: Meta = {
      editions: all<Edition>(db, 'SELECT id, exam_year, school_year, status, note_fr, note_ar FROM editions ORDER BY exam_year'),
      streams: all<Stream>(db, 'SELECT id, code, name_fr, name_ar, sort, verification, note_fr, note_ar FROM streams ORDER BY sort'),
      subjects: all<Subject>(db, 'SELECT id, code, name_fr, name_ar, sort FROM subjects ORDER BY sort'),
      ai: aiStatus(),
      last_check: lastCheck(db),
    };
    return c.json(meta);
  });

  // Public and staff routes are registered before the student routes, whose
  // authentication guard covers everything else under /api.
  app.route('/api/auth', authRoutes(db));
  app.route('/api/admin', adminRoutes(db));
  app.route('/api', studentRoutes(db));
  app.all('/api/*', () => {
    throw new HttpError(404, 'not_found', 'Unknown API route.');
  });

  // Production: serve the built web client and fall back to index.html for client-side routes.
  const indexFile = join(distDir, 'index.html');
  if (existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, 'utf8');
    app.use(
      '/*',
      serveStatic({
        root: relative(process.cwd(), distDir) || '.',
        onFound: (path, c) => {
          c.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache');
      return c.html(indexHtml);
    });
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as ContentfulStatusCode,
      );
    }
    console.error('[server] unhandled error', err);
    return c.json({ error: { code: 'internal', message: 'Unexpected server error.' } }, 500);
  });

  return app;
}

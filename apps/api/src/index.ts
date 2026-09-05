import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

import { allowedOrigins, isDevelopment, type AppBindings } from './env.js';
import { ApiError } from './lib/http.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { mediaRoutes } from './routes/media.js';
import { projectRoutes } from './routes/projects.js';
import { publicRoutes } from './routes/public.js';

const app = new Hono<AppBindings>();

app.use('*', async (c, next) => {
  const origins = allowedOrigins(c.env);
  const handler = cors({
    origin: (origin) => {
      if (!origin) return origins[0] ?? '*';
      return origins.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  });
  return handler(c, next);
});

app.get('/', (c) =>
  c.json({
    name: 'crea-api',
    status: 'ok',
    environment: c.env.ENVIRONMENT,
  }),
);

app.get('/api/health', async (c) => {
  const checks: Record<string, boolean> = {
    d1: false,
    r2: Boolean(c.env.MEDIA_BUCKET),
    anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
    session: Boolean(c.env.SESSION_SECRET),
  };
  try {
    await c.env.DB.prepare('SELECT 1').first();
    checks['d1'] = true;
  } catch {
    checks['d1'] = false;
  }
  return c.json({ ok: Object.values(checks).every(Boolean), checks });
});

// Sites publies : seule surface sans authentification.
app.route('/p', publicRoutes);

app.route('/api/auth', authRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/ai', aiRoutes);

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route inconnue.' } }, 404));

/** Format d erreur unique pour tout le client : { error: { code, message, details? } }. */
app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      error.status,
    );
  }

  if (error instanceof HTTPException) {
    return c.json({ error: { code: 'http_error', message: error.message } }, error.status);
  }

  console.error('unhandled_error', error);
  return c.json(
    {
      error: {
        code: 'server_error',
        message: 'Erreur interne.',
        ...(isDevelopment(c.env) ? { details: String(error) } : {}),
      },
    },
    500,
  );
});

export default app;

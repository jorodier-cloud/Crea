/** Bindings et variables du Worker (voir wrangler.toml et .dev.vars). */
export interface Env {
  // Bindings
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;

  // Variables publiques
  ENVIRONMENT: string;
  APP_ORIGINS: string;
  R2_PUBLIC_BASE_URL: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  ANTHROPIC_MODEL: string;
  SIGNUP_IA_POINTS: string;
  MAIL_FROM: string;

  // Secrets
  SESSION_SECRET: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  /** Chiffre les cles Stripe de chaque projet au repos. Sans elle, paiements indisponibles. */
  PAYMENTS_ENCRYPTION_KEY?: string;
}

export interface SessionUser {
  id: string;
  email: string;
}

/** Typage partage par toutes les routes Hono. */
export interface AppBindings {
  Bindings: Env;
  Variables: {
    user: SessionUser;
  };
}

export function isDevelopment(env: Env): boolean {
  return env.ENVIRONMENT !== 'production';
}

export function allowedOrigins(env: Env): string[] {
  return (env.APP_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

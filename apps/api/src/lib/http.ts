import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Erreur applicative portant un code HTTP et un code metier stable. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Authentification requise.'): ApiError =>
  new ApiError(401, 'unauthorized', message);

export const paymentRequired = (message: string, details?: unknown): ApiError =>
  new ApiError(402, 'insufficient_points', message, details);

export const forbidden = (message = 'Acces refuse.'): ApiError =>
  new ApiError(403, 'forbidden', message);

export const notFound = (message = 'Ressource introuvable.'): ApiError =>
  new ApiError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown): ApiError =>
  new ApiError(409, 'conflict', message, details);

export const tooManyRequests = (message: string): ApiError =>
  new ApiError(429, 'rate_limited', message);

export const serverError = (message: string, details?: unknown): ApiError =>
  new ApiError(500, 'server_error', message, details);

/** Un service tiers a repondu, mais mal : la panne n est pas la notre. */
export const badGateway = (message: string): ApiError =>
  new ApiError(502, 'upstream_error', message);

export const notConfigured = (message: string): ApiError =>
  new ApiError(503, 'not_configured', message);

/** Lit et valide un corps JSON. */
export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw badRequest('Content-Type application/json attendu.');
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw badRequest('Corps de requete JSON invalide.');
  }
}

export function requireString(
  value: unknown,
  field: string,
  { max = 5000, min = 1 }: { max?: number; min?: number } = {},
): string {
  if (typeof value !== 'string') throw badRequest(`Champ "${field}" manquant ou invalide.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`Champ "${field}" trop court.`);
  if (trimmed.length > max) throw badRequest(`Champ "${field}" trop long (max ${max}).`);
  return trimmed;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireEmail(value: unknown): string {
  const email = requireString(value, 'email', { max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw badRequest('Adresse email invalide.');
  return email;
}

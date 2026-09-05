import { createId } from '@crea/schema';

import type { Env } from '../env.js';
import { serverError } from '../lib/http.js';

export interface UserRow {
  id: string;
  email: string;
  magic_link_token: string | null;
  magic_link_expires_at: number | null;
  ia_points_balance: number;
  created_at: number;
}

export interface PublicUser {
  id: string;
  email: string;
  iaPointsBalance: number;
  createdAt: number;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    iaPointsBalance: row.ia_points_balance,
    createdAt: row.created_at,
  };
}

export async function findUserById(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM Users WHERE id = ?1').bind(id).first<UserRow>();
}

export async function findUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM Users WHERE lower(email) = lower(?1)')
    .bind(email)
    .first<UserRow>();
}

export async function findUserByMagicToken(env: Env, tokenHash: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM Users WHERE magic_link_token = ?1')
    .bind(tokenHash)
    .first<UserRow>();
}

/** Cree le compte s il n existe pas. L inscription est implicite au premier magic link. */
export async function findOrCreateUser(env: Env, email: string): Promise<UserRow> {
  const existing = await findUserByEmail(env, email);
  if (existing) return existing;

  const id = createId('usr');
  const points = Number.parseInt(env.SIGNUP_IA_POINTS ?? '1000', 10);
  await env.DB.prepare(
    'INSERT INTO Users (id, email, ia_points_balance) VALUES (?1, ?2, ?3)',
  )
    .bind(id, email, Number.isFinite(points) ? points : 1000)
    .run();

  const created = await findUserById(env, id);
  if (!created) throw serverError('Creation du compte impossible.');
  return created;
}

export async function setMagicLink(
  env: Env,
  userId: string,
  tokenHash: string,
  expiresAt: number,
): Promise<void> {
  await env.DB.prepare(
    'UPDATE Users SET magic_link_token = ?1, magic_link_expires_at = ?2 WHERE id = ?3',
  )
    .bind(tokenHash, expiresAt, userId)
    .run();
}

/**
 * Consomme le magic link de facon atomique : la clause `WHERE magic_link_token = ?`
 * garantit qu un jeton ne peut servir qu une fois, meme en cas d appels concurrents.
 */
export async function consumeMagicLink(env: Env, tokenHash: string): Promise<UserRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `UPDATE Users
        SET magic_link_token = NULL, magic_link_expires_at = NULL
      WHERE magic_link_token = ?1
        AND magic_link_expires_at IS NOT NULL
        AND magic_link_expires_at > ?2
      RETURNING *`,
  )
    .bind(tokenHash, now)
    .first<UserRow>();

  return result ?? null;
}

/**
 * Debite le solde de points IA.
 * La condition `ia_points_balance >= ?` rend l operation atomique : deux requetes
 * simultanees ne peuvent pas faire passer le solde sous zero.
 */
export async function deductPoints(
  env: Env,
  userId: string,
  amount: number,
): Promise<{ ok: boolean; balance: number }> {
  if (amount <= 0) {
    const current = await findUserById(env, userId);
    return { ok: true, balance: current?.ia_points_balance ?? 0 };
  }

  const updated = await env.DB.prepare(
    `UPDATE Users
        SET ia_points_balance = ia_points_balance - ?1
      WHERE id = ?2 AND ia_points_balance >= ?1
      RETURNING ia_points_balance`,
  )
    .bind(amount, userId)
    .first<{ ia_points_balance: number }>();

  if (updated) return { ok: true, balance: updated.ia_points_balance };

  const current = await findUserById(env, userId);
  return { ok: false, balance: current?.ia_points_balance ?? 0 };
}

export async function creditPoints(env: Env, userId: string, amount: number): Promise<number> {
  const updated = await env.DB.prepare(
    'UPDATE Users SET ia_points_balance = ia_points_balance + ?1 WHERE id = ?2 RETURNING ia_points_balance',
  )
    .bind(Math.max(0, amount), userId)
    .first<{ ia_points_balance: number }>();
  return updated?.ia_points_balance ?? 0;
}

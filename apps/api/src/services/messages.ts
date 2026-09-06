import { createId } from '@crea/schema';

import type { Env } from '../env.js';
import { sha256Hex } from '../lib/crypto.js';
import { notFound, tooManyRequests } from '../lib/http.js';

/**
 * Demandes recues par les formulaires des sites publies.
 *
 * Le message est ecrit en base avant tout envoi d email : une demande de
 * reservation perdue parce que le service d envoi a hoquete coute une nuitee.
 * L email notifie, la base garde la trace.
 */

/** Au-dela, c est un robot ou un acharnement : dans les deux cas on refuse. */
export const MAX_PER_IP_PER_HOUR = 5;
const HOUR_SECONDS = 3600;

export interface ContactTarget {
  projectId: string;
  slug: string;
  title: string;
  ownerEmail: string;
}

/**
 * Retrouve le projet publie derriere une adresse, et l email de son
 * proprietaire — c est lui qui recevra la demande.
 */
export async function findContactTarget(env: Env, slug: string): Promise<ContactTarget> {
  const row = await env.DB.prepare(
    `SELECT p.id AS project_id, p.title AS title, u.email AS owner_email
       FROM Projects p
       JOIN Users u ON u.id = p.user_id
      WHERE p.slug = ?1 AND p.published_at IS NOT NULL`,
  )
    .bind(slug)
    .first<{ project_id: string; title: string; owner_email: string }>();

  if (!row) throw notFound('Aucun site publie a cette adresse.');

  return {
    projectId: row.project_id,
    slug,
    title: row.title,
    ownerEmail: row.owner_email,
  };
}

/**
 * Empreinte de l adresse IP.
 *
 * `SESSION_SECRET` sert de sel : sans lui, la table entiere serait un
 * dictionnaire d adresses IP a portee de quiconque lirait la base, l espace des
 * IPv4 etant assez petit pour etre epuise par force brute.
 */
export async function hashIp(env: Env, ip: string): Promise<string> {
  return sha256Hex(`${env.SESSION_SECRET ?? ''}:${ip}`);
}

/** Leve si l adresse a deja depose trop de demandes dans l heure. */
export async function assertUnderRateLimit(env: Env, ipHash: string, now: number): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM Messages WHERE ip_hash = ?1 AND created_at > ?2',
  )
    .bind(ipHash, now - HOUR_SECONDS)
    .first<{ total: number }>();

  if ((row?.total ?? 0) >= MAX_PER_IP_PER_HOUR) {
    throw tooManyRequests('Trop de demandes envoyees. Reessayez dans une heure.');
  }
}

export interface StoredMessage {
  id: string;
  senderName: string | null;
  senderEmail: string | null;
  fields: Array<{ label: string; value: string }>;
}

export async function storeMessage(
  env: Env,
  target: ContactTarget,
  message: StoredMessage & { ipHash: string; createdAt: number },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO Messages (id, project_id, slug, payload, sender_name, sender_email, ip_hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      message.id,
      target.projectId,
      target.slug,
      JSON.stringify(message.fields),
      message.senderName,
      message.senderEmail,
      message.ipHash,
      message.createdAt,
    )
    .run();
}

/** Marque la demande comme notifiee. Un echec ici n annule pas la reception. */
export async function markNotified(env: Env, id: string): Promise<void> {
  await env.DB.prepare('UPDATE Messages SET notified = 1 WHERE id = ?1').bind(id).run();
}

export function newMessageId(): string {
  return createId('msg');
}

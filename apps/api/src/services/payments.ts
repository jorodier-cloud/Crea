import { createId } from '@crea/schema';

import type { Env } from '../env.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { notConfigured, notFound } from '../lib/http.js';

/**
 * Paiement natif : chaque proprietaire de site connecte SON PROPRE compte
 * Stripe (cles collees dans le builder). L argent va directement chez lui —
 * Crea ne le detient jamais, n a donc pas besoin d agrement de plateforme de
 * paiement (Stripe Connect) prealable, et le paiement reste operationnel des
 * que le proprietaire a colle ses deux cles.
 */

/**
 * `PAYMENTS_ENCRYPTION_KEY` chiffre les cles Stripe au repos (voir
 * lib/crypto.ts). Sans elle, ni lecture ni ecriture ne peuvent avoir lieu :
 * le dire clairement plutot que stocker en clair ou echouer silencieusement.
 */
function requireEncryptionKey(env: Env): string {
  const key = env.PAYMENTS_ENCRYPTION_KEY;
  if (!key) throw notConfigured('Paiements indisponibles : cle de chiffrement absente cote serveur.');
  return key;
}

export interface PaymentSettings {
  configured: boolean;
  publicKey: string | null;
}

export async function getPaymentSettings(
  env: Env,
  userId: string,
  projectId: string,
): Promise<PaymentSettings> {
  const row = await env.DB.prepare(
    'SELECT stripe_public_key, stripe_secret_key_enc FROM Projects WHERE id = ?1 AND user_id = ?2',
  )
    .bind(projectId, userId)
    .first<{ stripe_public_key: string | null; stripe_secret_key_enc: string | null }>();
  if (!row) throw notFound('Projet introuvable.');

  return {
    configured: Boolean(row.stripe_public_key && row.stripe_secret_key_enc),
    publicKey: row.stripe_public_key,
  };
}

export interface SavePaymentSettingsInput {
  publicKey: string;
  secretKey: string;
  webhookSecret: string;
}

export async function savePaymentSettings(
  env: Env,
  userId: string,
  projectId: string,
  input: SavePaymentSettingsInput,
): Promise<PaymentSettings> {
  const existing = await env.DB.prepare('SELECT id FROM Projects WHERE id = ?1 AND user_id = ?2')
    .bind(projectId, userId)
    .first<{ id: string }>();
  if (!existing) throw notFound('Projet introuvable.');

  const key = requireEncryptionKey(env);
  const secretEnc = await encryptSecret(key, input.secretKey);
  const webhookEnc = await encryptSecret(key, input.webhookSecret);

  await env.DB.prepare(
    `UPDATE Projects
        SET stripe_public_key = ?1, stripe_secret_key_enc = ?2, stripe_webhook_secret_enc = ?3
      WHERE id = ?4 AND user_id = ?5`,
  )
    .bind(input.publicKey, secretEnc, webhookEnc, projectId, userId)
    .run();

  return { configured: true, publicKey: input.publicKey };
}

export async function clearPaymentSettings(env: Env, userId: string, projectId: string): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE Projects
        SET stripe_public_key = NULL, stripe_secret_key_enc = NULL, stripe_webhook_secret_enc = NULL
      WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(projectId, userId)
    .run();
  if (result.meta.changes === 0) throw notFound('Projet introuvable.');
}

export interface StripeCredentials {
  projectId: string;
  secretKey: string;
}

/** Cles Stripe d un site publie, pour la route publique d achat. `null` si non configure. */
export async function getStripeSecretForSlug(env: Env, slug: string): Promise<StripeCredentials | null> {
  const row = await env.DB.prepare(
    `SELECT id, stripe_secret_key_enc
       FROM Projects
      WHERE slug = ?1 AND published_at IS NOT NULL`,
  )
    .bind(slug)
    .first<{ id: string; stripe_secret_key_enc: string | null }>();
  if (!row?.stripe_secret_key_enc) return null;

  const key = requireEncryptionKey(env);
  const secretKey = await decryptSecret(key, row.stripe_secret_key_enc);
  if (!secretKey) return null;
  return { projectId: row.id, secretKey };
}

/** Secret de webhook d un projet, pour verifier les evenements Stripe recus. */
export async function getWebhookSecret(env: Env, projectId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT stripe_webhook_secret_enc FROM Projects WHERE id = ?1')
    .bind(projectId)
    .first<{ stripe_webhook_secret_enc: string | null }>();
  if (!row?.stripe_webhook_secret_enc) return null;

  const key = requireEncryptionKey(env);
  return decryptSecret(key, row.stripe_webhook_secret_enc);
}

export interface ProjectOwnerContact {
  ownerEmail: string;
  title: string;
}

export async function getProjectOwnerContact(env: Env, projectId: string): Promise<ProjectOwnerContact | null> {
  const row = await env.DB.prepare(
    `SELECT p.title AS title, u.email AS owner_email
       FROM Projects p
       JOIN Users u ON u.id = p.user_id
      WHERE p.id = ?1`,
  )
    .bind(projectId)
    .first<{ title: string; owner_email: string }>();
  return row ? { ownerEmail: row.owner_email, title: row.title } : null;
}

/* -------------------------------------------------------------------------- */
/* Commandes                                                                  */
/* -------------------------------------------------------------------------- */

export interface NewOrderInput {
  projectId: string;
  slug: string;
  productNodeId: string;
  productName: string;
  unitAmount: number;
  currency: string;
  stripeSessionId: string;
  createdAt: number;
}

/** Ecrite AVANT la redirection vers Stripe : une commande existe des la tentative d achat. */
export async function createOrder(env: Env, input: NewOrderInput): Promise<string> {
  const id = createId('ord');
  await env.DB.prepare(
    `INSERT INTO Orders
       (id, project_id, slug, product_node_id, product_name, unit_amount, currency, stripe_session_id, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9)`,
  )
    .bind(
      id,
      input.projectId,
      input.slug,
      input.productNodeId,
      input.productName,
      input.unitAmount,
      input.currency,
      input.stripeSessionId,
      input.createdAt,
    )
    .run();
  return id;
}

export interface MarkOrderPaidInput {
  paymentIntent: string | null;
  customerEmail: string | null;
  customerName: string | null;
  paidAt: number;
}

export interface PaidOrder {
  id: string;
  projectId: string;
  slug: string;
  productName: string;
  unitAmount: number;
  currency: string;
}

/**
 * Confirme une commande a reception du webhook. `status = 'pending'` dans le
 * `WHERE` rend l operation idempotente : un evenement Stripe livre deux fois
 * (chose documentee, attendue) ne renvoie une commande a notifier qu une fois.
 */
export async function markOrderPaid(
  env: Env,
  stripeSessionId: string,
  info: MarkOrderPaidInput,
): Promise<PaidOrder | null> {
  const result = await env.DB.prepare(
    `UPDATE Orders
        SET status = 'paid', stripe_payment_intent = ?1, customer_email = ?2, customer_name = ?3, paid_at = ?4
      WHERE stripe_session_id = ?5 AND status = 'pending'`,
  )
    .bind(info.paymentIntent, info.customerEmail, info.customerName, info.paidAt, stripeSessionId)
    .run();

  if (result.meta.changes === 0) return null;

  const row = await env.DB.prepare(
    'SELECT id, project_id, slug, product_name, unit_amount, currency FROM Orders WHERE stripe_session_id = ?1',
  )
    .bind(stripeSessionId)
    .first<{ id: string; project_id: string; slug: string; product_name: string; unit_amount: number; currency: string }>();
  if (!row) return null;

  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    productName: row.product_name,
    unitAmount: row.unit_amount,
    currency: row.currency,
  };
}

export interface OrderSummary {
  id: string;
  productName: string;
  unitAmount: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  status: string;
  createdAt: number;
  paidAt: number | null;
}

export async function listOrders(env: Env, userId: string, projectId: string): Promise<OrderSummary[]> {
  const owner = await env.DB.prepare('SELECT id FROM Projects WHERE id = ?1 AND user_id = ?2')
    .bind(projectId, userId)
    .first<{ id: string }>();
  if (!owner) throw notFound('Projet introuvable.');

  const { results } = await env.DB.prepare(
    `SELECT id, product_name, unit_amount, currency, customer_email, customer_name, status, created_at, paid_at
       FROM Orders WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(projectId)
    .all<{
      id: string;
      product_name: string;
      unit_amount: number;
      currency: string;
      customer_email: string | null;
      customer_name: string | null;
      status: string;
      created_at: number;
      paid_at: number | null;
    }>();

  return (results ?? []).map((row) => ({
    id: row.id,
    productName: row.product_name,
    unitAmount: row.unit_amount,
    currency: row.currency,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));
}

import { hmacSha256, timingSafeEqual, toHex } from './crypto.js';

/**
 * Client Stripe minimal, en appels REST directs (comme mailer.ts pour
 * Resend) : pas de SDK a embarquer dans le Worker pour deux operations.
 *
 * Chaque projet utilise SA PROPRE cle secrete Stripe (voir services/
 * payments.ts) — l argent va directement sur le compte Stripe du
 * proprietaire du site, jamais via un compte Crea. C est ce choix qui rend
 * le paiement operationnel sans agrement de plateforme de paiement
 * (Stripe Connect) prealable.
 */

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2024-06-20';

export class StripeError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
  }
}

/**
 * Encode un objet en corps `application/x-www-form-urlencoded`, avec la
 * notation a crochets que l API Stripe attend pour les structures
 * imbriquees (ex. `line_items[0][price_data][unit_amount]`).
 */
function encodeForm(value: unknown, prefix = ''): string[] {
  const parts: string[] = [];
  if (value === undefined || value === null) return parts;

  if (Array.isArray(value)) {
    value.forEach((item, index) => parts.push(...encodeForm(item, `${prefix}[${index}]`)));
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      parts.push(...encodeForm(item, prefix ? `${prefix}[${key}]` : key));
    }
  } else {
    parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
  return parts;
}

async function stripeRequest<T>(secretKey: string, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION,
    },
    body: encodeForm(body).join('&'),
  });

  const text = await response.text();
  if (!response.ok) {
    let message = `Stripe a repondu ${response.status}.`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* corps non JSON : on garde le message generique. */
    }
    throw new StripeError(message, response.status);
  }

  return JSON.parse(text) as T;
}

export interface CreateCheckoutSessionInput {
  successUrl: string;
  cancelUrl: string;
  productName: string;
  description?: string;
  /** Plus petite unite de la devise (centimes). */
  unitAmount: number;
  currency: string;
  customerEmail?: string | null;
  metadata: Record<string, string>;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
}

/** Cree une session Stripe Checkout hebergee : Crea ne touche jamais la carte du visiteur. */
export async function createCheckoutSession(
  secretKey: string,
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>(secretKey, '/checkout/sessions', {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    metadata: input.metadata,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency,
          unit_amount: input.unitAmount,
          product_data: {
            name: input.productName,
            ...(input.description ? { description: input.description.slice(0, 500) } : {}),
          },
        },
      },
    ],
  });
}

/** Evenement Stripe apres verification — seuls les champs utilises par le webhook. */
export interface StripeCheckoutCompletedEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      payment_intent: string | null;
      payment_status: string;
      amount_total: number | null;
      currency: string | null;
      customer_details: { email: string | null; name: string | null } | null;
      metadata: Record<string, string> | null;
    };
  };
}

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifie la signature `Stripe-Signature` d un webhook.
 *
 * Stripe signe `${timestamp}.${payload}` en HMAC-SHA256 avec le secret de
 * webhook propre a l endpoint. Sans cette verification, n importe qui
 * connaissant l URL du webhook pourrait fabriquer de fausses confirmations
 * de paiement et faire passer des commandes pour payees.
 */
export async function verifyWebhookSignature(
  payload: string,
  header: string | undefined,
  webhookSecret: string,
): Promise<StripeCheckoutCompletedEvent | null> {
  if (!header) return null;

  let timestamp: string | null = null;
  let signature: string | null = null;
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value ?? null;
    if (key === 'v1') signature = value ?? null;
  }
  if (!timestamp || !signature) return null;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return null;

  const expected = toHex(await hmacSha256(webhookSecret, `${timestamp}.${payload}`));
  if (!timingSafeEqual(expected, signature)) return null;

  try {
    return JSON.parse(payload) as StripeCheckoutCompletedEvent;
  } catch {
    return null;
  }
}

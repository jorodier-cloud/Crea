import { Hono } from 'hono';

import type { AppBindings } from '../env.js';
import { badRequest, notFound } from '../lib/http.js';
import {
  buildOrderConfirmationEmail,
  buildOrderNotificationEmail,
  isMailerConfigured,
  sendEmail,
} from '../lib/mailer.js';
import { verifyWebhookSignature } from '../lib/stripe.js';
import { getProjectOwnerContact, getWebhookSecret, markOrderPaid } from '../services/payments.js';

export const webhookRoutes = new Hono<AppBindings>();

/**
 * Un point de webhook par projet (pas un seul pour toute la plateforme) :
 * chaque site utilise sa propre cle Stripe, donc son propre secret de
 * signature — impossible de verifier un evenement sans savoir d avance a
 * quel projet il appartient. L URL est communiquee au proprietaire dans le
 * panneau Boutique du builder, a coller dans son tableau de bord Stripe.
 */
webhookRoutes.post('/stripe/:projectId', async (c) => {
  const projectId = c.req.param('projectId');
  // Le corps brut, octet pour octet, sert de base a la signature : le
  // reserialiser depuis un objet parse la casserait.
  const payload = await c.req.text();

  const webhookSecret = await getWebhookSecret(c.env, projectId);
  if (!webhookSecret) throw notFound('Projet introuvable ou paiement non configure.');

  const event = await verifyWebhookSignature(payload, c.req.header('stripe-signature'), webhookSecret);
  if (!event) throw badRequest('Signature Stripe invalide.');

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.payment_status === 'paid') {
      const order = await markOrderPaid(c.env, session.id, {
        paymentIntent: session.payment_intent,
        customerEmail: session.customer_details?.email ?? null,
        customerName: session.customer_details?.name ?? null,
        paidAt: Math.floor(Date.now() / 1000),
      });

      // `order` est `null` quand la commande est deja "paid" : Stripe livre
      // parfois deux fois le meme evenement, cette relance ne doit pas
      // renvoyer une seconde paire d emails.
      if (order && isMailerConfigured(c.env)) {
        const contact = await getProjectOwnerContact(c.env, order.projectId);
        if (contact) {
          const customerEmail = session.customer_details?.email ?? null;
          const notifications = [
            sendEmail(c.env, {
              to: contact.ownerEmail,
              ...buildOrderNotificationEmail({
                siteTitle: contact.title,
                productName: order.productName,
                unitAmount: order.unitAmount,
                currency: order.currency,
                customerEmail,
                customerName: session.customer_details?.name ?? null,
              }),
            }),
            ...(customerEmail
              ? [
                  sendEmail(c.env, {
                    to: customerEmail,
                    ...buildOrderConfirmationEmail({
                      siteTitle: contact.title,
                      productName: order.productName,
                      unitAmount: order.unitAmount,
                      currency: order.currency,
                    }),
                  }),
                ]
              : []),
          ];

          const results = await Promise.allSettled(notifications);
          for (const result of results) {
            if (result.status === 'rejected') {
              // La vente est enregistree quoi qu il arrive : l echec de
              // notification se repare, la perdre non.
              console.error(
                JSON.stringify({
                  event: 'order_notify_failed',
                  orderId: order.id,
                  reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
                }),
              );
            }
          }
        }
      }
    }
  }

  // Stripe attend un 2xx sans condition sur le contenu : tout autre code
  // declenche des reessais automatiques.
  return c.json({ received: true });
});

-- Migration 0004 — paiement natif (produits, Stripe, commandes).
--
-- Chaque proprietaire connecte son PROPRE compte Stripe (cles collees dans le
-- builder) : l argent va directement chez lui, Crea ne le detient jamais et
-- n a donc pas besoin d agrement de plateforme de paiement. Les cles sont
-- chiffrees avant stockage (voir lib/crypto.ts, AES-GCM) — jamais en clair
-- en base, au meme titre qu un mot de passe.

ALTER TABLE Projects ADD COLUMN stripe_public_key TEXT;
ALTER TABLE Projects ADD COLUMN stripe_secret_key_enc TEXT;
ALTER TABLE Projects ADD COLUMN stripe_webhook_secret_enc TEXT;

-- ---------------------------------------------------------------------------
-- Orders
--   Une ligne par tentative d achat, creee AVANT la redirection vers Stripe
--   (statut "pending") puis confirmee par le webhook (statut "paid"). Meme
--   principe que Messages : la trace existe des le depart, la confirmation
--   ne fait que la completer — un webhook qui se perd ne doit pas effacer la
--   commande, seulement la laisser "pending".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Orders (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES Projects (id) ON DELETE CASCADE,
  -- Le slug au moment de l achat : le projet peut etre renomme ensuite.
  slug                   TEXT NOT NULL,
  product_node_id        TEXT NOT NULL,
  -- Copie du produit au moment de l achat : le bloc peut changer ensuite
  -- sans que l historique des commandes ne se reecrive.
  product_name           TEXT NOT NULL,
  unit_amount            INTEGER NOT NULL, -- plus petite unite de la devise (centimes).
  currency               TEXT NOT NULL,
  customer_email         TEXT,
  customer_name          TEXT,
  stripe_session_id      TEXT NOT NULL,
  stripe_payment_intent  TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | expired
  created_at             INTEGER NOT NULL,
  paid_at                INTEGER,
  CHECK (status IN ('pending', 'paid', 'failed', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_session ON Orders (stripe_session_id);

-- Liste des commandes d un projet, la plus recente en tete.
CREATE INDEX IF NOT EXISTS idx_orders_project ON Orders (project_id, created_at DESC);

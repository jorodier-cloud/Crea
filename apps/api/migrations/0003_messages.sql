-- Migration 0003 — demandes recues par les formulaires des sites publies.
--
-- Le message est ecrit en base AVANT d etre envoye par email. Une demande de
-- reservation qui se perd parce que le service d envoi a hoquete coute une
-- nuitee : l email est une notification, la base est la trace.
--
-- La table sert aussi de compteur pour la limite par heure et par adresse,
-- ce qui evite d ajouter un stockage supplementaire juste pour cela.

CREATE TABLE IF NOT EXISTS Messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Projects (id) ON DELETE CASCADE,
  -- Le slug au moment de la reception : le projet peut etre renomme ensuite.
  slug TEXT NOT NULL,
  -- Champs du formulaire, tels que soumis, en JSON.
  payload TEXT NOT NULL,
  -- Extraits pour l affichage et les reponses, quand le formulaire les porte.
  sender_name TEXT,
  sender_email TEXT,
  -- Empreinte de l adresse IP, jamais l adresse : suffit a compter, ne permet
  -- pas de remonter au visiteur.
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 1 des que l email de notification est parti.
  notified INTEGER NOT NULL DEFAULT 0
);

-- Liste des demandes d un projet, la plus recente en tete.
CREATE INDEX IF NOT EXISTS idx_messages_project ON Messages (project_id, created_at DESC);

-- Sert la limite par heure sans balayer la table.
CREATE INDEX IF NOT EXISTS idx_messages_ip ON Messages (ip_hash, created_at);

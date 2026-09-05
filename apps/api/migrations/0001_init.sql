-- Migration 0001 — schema initial Crea (Cloudflare D1 / SQLite).
-- Applique : npm run db:migrate:local  |  npm run db:migrate:remote

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Users
--   magic_link_token stocke le SHA-256 du jeton, jamais le jeton en clair.
--   ia_points_balance : solde de points IA, credite a 1000 a l inscription.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Users (
  id                       TEXT PRIMARY KEY,
  email                    TEXT NOT NULL,
  magic_link_token         TEXT,
  magic_link_expires_at    INTEGER,
  ia_points_balance        INTEGER NOT NULL DEFAULT 1000,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (ia_points_balance >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON Users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_magic_link_token ON Users (magic_link_token);

-- ---------------------------------------------------------------------------
-- Projects
--   json_tree : l AST complet de la page, source de verite unique.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  json_tree   TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES Users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON Projects (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Medias
--   r2_key : cle de l objet dans le bucket R2.
--   r2_public_url : URL publique servie au navigateur.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Medias (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  original_name  TEXT NOT NULL,
  r2_key         TEXT NOT NULL,
  r2_public_url  TEXT NOT NULL,
  content_type   TEXT,
  size_bytes     INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES Users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_medias_r2_key ON Medias (r2_key);
CREATE INDEX IF NOT EXISTS idx_medias_user_created ON Medias (user_id, created_at DESC);

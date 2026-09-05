-- Migration 0002 — publication publique d un projet.
--
-- Le site en ligne est un INSTANTANE (`published_tree`), distinct de l arbre de
-- travail (`json_tree`) : on continue d editer sans toucher a ce que voient les
-- visiteurs, jusqu a la publication suivante.

ALTER TABLE Projects ADD COLUMN slug TEXT;
ALTER TABLE Projects ADD COLUMN published_tree TEXT;
ALTER TABLE Projects ADD COLUMN published_at INTEGER;

-- Un slug libre par projet. SQLite autorise plusieurs NULL dans un index unique :
-- les projets jamais publies restent donc sans slug.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON Projects (slug);

-- Sert la route publique /p/:slug sans balayer la table.
CREATE INDEX IF NOT EXISTS idx_projects_published ON Projects (slug, published_at);

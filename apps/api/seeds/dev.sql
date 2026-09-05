-- Jeu de donnees de developpement.
-- Applique : npm run db:seed:local
-- Cree un compte de test ; le magic link reste la voie normale de connexion.

INSERT OR IGNORE INTO Users (id, email, ia_points_balance)
VALUES ('usr_demo0001', 'demo@crea.local', 1000);

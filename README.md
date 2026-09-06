# Crea — Hybrid Website Builder

Constructeur de site web hybride : **IA generative + editeur visuel manuel**.

> **Regle architecturale absolue**
> La source de verite n'est jamais du HTML. C'est un **AST au format JSON**.
> Le moteur IA et l'editeur ne font que lire et modifier cet arbre.
> Le HTML final n'est qu'une projection, recalculee a la demande.

---

## Sommaire

| Section | Contenu |
| --- | --- |
| [Architecture](#architecture) | Flux de donnees, monorepo |
| [Demarrage](#demarrage-rapide) | Installation locale en 5 commandes |
| [Base de donnees](#base-de-donnees-d1) | Schemas des 3 tables |
| [AST](#last-le-dictionnaire-de-donnees) | Types, blocs, operations |
| [API](#api-cloudflare-workers) | Tous les endpoints |
| [Points IA](#points-ia) | Bareme et debit |
| [Builder](#builder-astro--react) | Les 3 zones de l'interface |
| [Tests](#tests) | Ce qui est couvert |
| [Deploiement](#deploiement) | Script d installation et mise en production |

---

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │  AST JSON  (Projects.json_tree)      │
                    │  source de verite unique             │
                    └───────┬──────────────────┬───────────┘
                            │                  │
              lecture/ecriture                 lecture/ecriture
                            │                  │
        ┌───────────────────▼──┐        ┌──────▼────────────────┐
        │  Moteur IA           │        │  Editeur visuel        │
        │  Claude -> operations│        │  Zustand + React       │
        └───────────────────┬──┘        └──────┬────────────────┘
                            │                  │
                            └────────┬─────────┘
                                     │
                          ┌──────────▼───────────┐
                          │  renderTreeToHtml()  │
                          │  projection HTML     │
                          └──────────────────────┘
```

Le modele **ne produit jamais de HTML** : il renvoie une liste d'operations
(`insert`, `update`, `remove`, `move`, `duplicate`, `setTheme`…) que le serveur
valide puis applique. Une reponse aberrante ne peut donc pas corrompre le projet.

### Monorepo

| Espace | Role | Stack |
| --- | --- | --- |
| `packages/schema` | Dictionnaire de donnees, validation, operations, rendu HTML | TypeScript pur, zero dependance |
| `apps/api` | API serverless | Cloudflare Workers, Hono, D1, R2, SDK Anthropic |
| `apps/web` | Builder | Astro, React 19, Tailwind 4, Zustand |

`@crea/schema` est partage par le Worker **et** le navigateur : une seule
definition de l'AST, une seule fonction de rendu, aucune derive possible.

---

## Demarrage rapide

```bash
# 1. Dependances (construit aussi @crea/schema)
npm install

# 2. Secrets locaux du Worker
cp apps/api/.dev.vars.example apps/api/.dev.vars
#    -> renseigner SESSION_SECRET, et ANTHROPIC_API_KEY pour activer l IA

# 3. Base D1 locale
npm run db:migrate:local

# 4. API sur http://localhost:8787
npm run dev:api

# 5. Builder sur http://localhost:4321  (autre terminal)
npm run dev:web
```

Puis : `http://localhost:4321/login` → saisir un email → en developpement le
magic link s'affiche directement dans la page.

### Variables

| Fichier | Cle | Role |
| --- | --- | --- |
| `apps/api/wrangler.toml` | `APP_ORIGINS` | Origines autorisees par le CORS |
| | `R2_PUBLIC_BASE_URL` | Base publique des medias |
| | `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` | Cible des URL presignees |
| | `ANTHROPIC_MODEL` | `claude-sonnet-5` par defaut — 60% moins cher qu Opus, suffisant pour une sortie JSON stricte |
| | `SIGNUP_IA_POINTS` | Credit offert a l'inscription |
| | `MAIL_FROM` | Expediteur des liens de connexion |
| `apps/api/.dev.vars` | `SESSION_SECRET` | Cle HMAC des sessions |
| | `ANTHROPIC_API_KEY` | Cle du moteur IA |
| | `RESEND_API_KEY` | Cle d'envoi des emails |
| | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Jeton S3 de R2 |
| `apps/web/.env` | `PUBLIC_API_URL` | URL de l'API |

Sans cles S3, l'upload bascule automatiquement sur `/api/media/upload`
(transit par le Worker) : le mode developpement fonctionne sans configurer R2.

---

## Base de donnees (D1)

Migrations : `apps/api/migrations/` — `0001_init.sql` (schema initial),
`0002_publish.sql` (publication), `0003_messages.sql` (demandes de contact).

### `Users`

| Colonne | Type | Note |
| --- | --- | --- |
| `id` | TEXT PK | `usr_…` |
| `email` | TEXT | unique, insensible a la casse |
| `magic_link_token` | TEXT | **SHA-256** du jeton, jamais le jeton en clair |
| `magic_link_expires_at` | INTEGER | expiration (15 min) |
| `ia_points_balance` | INTEGER | defaut **1000**, `CHECK >= 0` |
| `created_at` | INTEGER | unixepoch |

### `Projects`

| Colonne | Type | Note |
| --- | --- | --- |
| `id` | TEXT PK | `prj_…` |
| `user_id` | TEXT FK | cascade a la suppression du compte |
| `title` | TEXT | |
| `json_tree` | TEXT | **l'AST complet**, arbre de travail |
| `slug` | TEXT | adresse publique, unique, `NULL` tant que jamais publie |
| `published_tree` | TEXT | instantane servi par `/p/:slug` |
| `published_at` | INTEGER | `NULL` = hors ligne |
| `created_at` / `updated_at` | INTEGER | |

### `Medias`

| Colonne | Type | Note |
| --- | --- | --- |
| `id` | TEXT PK | `med_…` |
| `user_id` | TEXT FK | |
| `original_name` | TEXT | nom d'origine |
| `r2_key` | TEXT | unique, prefixe `u/<user_id>/` |
| `r2_public_url` | TEXT | URL servie au navigateur |
| `content_type`, `size_bytes` | | verifies via `HEAD` sur R2 |
| `created_at` | INTEGER | |

---

## L'AST : le dictionnaire de donnees

`packages/schema/src/types/schema.ts`.

### Structure universelle d'un noeud

```ts
{ id, type, content, styles, actions, children[] }
```

### Blocs autorises

| Type | Enfants | Contenu |
| --- | --- | --- |
| `container` | oui | `tag`, `anchor` |
| `text` | non | `text`, `tag` (h1…h6, p, span, blockquote) |
| `media` | non | `kind`, `src`, `alt`, `objectFit` |
| `button` | non | `label`, `variant`, `size` |
| `calendar` | non | `mode`, `icalUrls`, `monthsVisible`, `minNights`, `blockedDates` |
| `form` | oui | `fields[]`, `submitLabel`, `endpoint`, `successMessage` |

### Styles

Regroupes par famille — `layout`, `size`, `spacing`, `typography`,
`background`, `border`, `effects`, plus `custom` comme echappatoire.
Ce decoupage pilote directement l'inspecteur de droite.

### Operations

| Operation | Effet |
| --- | --- |
| `insert` | ajoute un noeud sous un parent |
| `update` | modifie `content`, `styles` (fusion par famille), `actions`, `name` |
| `remove` | supprime un noeud |
| `move` | deplace (refus si la cible est un descendant) |
| `duplicate` | copie avec nouveaux identifiants |
| `setMeta` / `setTheme` | metadonnees et jetons de theme |
| `replaceRoot` | refonte complete |

`applyOperations` est **transactionnel par operation** : une operation invalide
est annulee et signalee, les autres passent. L'arbre d'entree n'est jamais mute.

---

## API (Cloudflare Workers)

Format d'erreur unique : `{ "error": { "code", "message", "details"? } }`.

### Authentification — magic link

| Methode | Route | Effet |
| --- | --- | --- |
| `POST` | `/api/auth/magic-link` | Emet un lien et l'envoie par email. Reponse identique que le compte existe ou non (pas d'enumeration). En dev, renvoie `devLink` au lieu d'envoyer. `503` si l'envoi n'est pas configure, `502` s'il echoue. |
| `POST` | `/api/auth/verify` | Consomme le jeton (usage unique, atomique) et emet une session JWT HS256 — cookie **et** `Bearer`. |
| `GET` | `/api/auth/me` | Compte + solde de points. |
| `POST` | `/api/auth/logout` | Efface le cookie. |

### Projets

| Methode | Route | Effet |
| --- | --- | --- |
| `GET` | `/api/projects` | Liste (sans les AST). |
| `POST` | `/api/projects` | Cree avec un arbre de demarrage. |
| `GET` | `/api/projects/:id` | Projet + AST. |
| `PUT` | `/api/projects/:id` | Sauvegarde `title` et/ou `tree`. **Tout arbre entrant est normalise.** |
| `DELETE` | `/api/projects/:id` | Supprime. |
| `GET` | `/api/projects/:id/html` | Projection HTML du brouillon. |
| `POST` | `/api/projects/:id/publish` | Met le site en ligne. `slug` optionnel, sinon derive du titre. |
| `POST` | `/api/projects/:id/unpublish` | Retire le site. L'adresse reste reservee. |

### Publication — la seule route sans authentification

| Methode | Route | Effet |
| --- | --- | --- |
| `GET` | `/p/:slug` | Sert le site publie. Aucun compte requis. |

Le site en ligne est un **instantane** (`published_tree`), distinct de l'arbre de
travail (`json_tree`) : on continue d'editer sans rien changer pour les
visiteurs, jusqu'a la publication suivante.

- Slug derive du titre, suffixe automatiquement s'il est deja pris ; un slug
  demande explicitement et deja occupe renvoie `409`.
- Retirer le site conserve l'adresse, pour pouvoir republier a la meme URL.
- Reponse mise en cache 60 s avec revalidation en arriere-plan.
- L'URL publique est derivee de l'origine de la requete : un domaine
  personnalise route vers le Worker fonctionne sans configuration.

### Medias

| Methode | Route | Effet |
| --- | --- | --- |
| `POST` | `/api/media/presigned-url` | URL PUT signee (SigV4, 15 min) — **navigateur → R2 en direct**. |
| `PUT` | `/api/media/upload?key=` | Repli developpement via le binding R2. |
| `POST` | `/api/media/sync` | Verifie l'objet (`HEAD`) puis insere en D1. |
| `GET` | `/api/media` | Bibliotheque de l'utilisateur. |
| `DELETE` | `/api/media/:id` | Supprime en R2 et en D1. |
| `GET` | `/api/media/file/*` | Service public des objets (dev). |

Garde-fous : types MIME sur liste blanche, 25 Mo maximum, cles cloisonnees par
`u/<user_id>/` — une cle hors de son espace est refusee.

### IA

| Methode | Route | Effet |
| --- | --- | --- |
| `POST` | `/api/ai/prompt` | Cycle complet, voir ci-dessous. |
| `GET` | `/api/ai/pricing` | Bareme public. |

```
etat JSON + prompt
        │
        ├─ verification du solde ......... 402 si epuise
        ├─ appel Claude (prompt systeme strict, cache_control)
        ├─ parsing defensif de la reponse . operations inconnues ecartees
        ├─ calcul des tokens -> points .... debit atomique en D1
        ├─ applyOperations + normalizeTree  arbre toujours conforme
        └─ sauvegarde du nouvel AST
```

Reponse : `{ message, tree, operations, applied, errors, usage, points }`.

---

## Points IA

`apps/api/src/services/points.ts`.

| Poste | Cout |
| --- | --- |
| Entree | **1 pt / 1000 tokens** |
| Ecriture de cache | 1,25 pt / 1000 tokens |
| Lecture de cache | 0,1 pt / 1000 tokens |
| Sortie | **5 pts / 1000 tokens** |
| Plancher | 1 pt par requete |

Le debit s'appuie sur `UPDATE … WHERE ia_points_balance >= ?` : deux requetes
simultanees ne peuvent pas faire passer le solde sous zero. Si le cout depasse
le reliquat, le compte est solde a zero plutot que de jeter un travail deja
facture par le fournisseur (`points.overdrawn: true`).

---

## Builder (Astro + React)

`http://localhost:4321/builder?id=<projectId>` — trois zones.

| Zone | Composant | Contenu |
| --- | --- | --- |
| **Gauche** | `LeftPanel` | Chat IA, jauge de Points IA, palette de blocs, arborescence de l'AST |
| **Centre** | `Canvas` | WYSIWYG mappe sur le JSON via Zustand, selection, glisser-deposer, edition inline du texte (double-clic) |
| **Droite** | `RightInspector` | Contenu / Style / Actions du bloc selectionne — marges, couleurs, typographie, sans passer par l'IA |

Details :

- **Selection** — surbrillance doree, `id` du bloc affiche dans l'inspecteur.
- **Glisser-deposer** — depot avant / apres / a l'interieur selon la position du
  pointeur ; les blocs feuilles n'acceptent pas d'enfants.
- **Historique** — annuler / retablir (60 pas), `Ctrl+Z` / `Ctrl+Maj+Z`.
- **Autosave** — 2,5 s apres la derniere modification ; `Ctrl+S` pour forcer.
- **Apercu** — `/preview?id=…` projette le HTML avec la meme fonction que l'API,
  et permet de telecharger le fichier.
- **Publication** — bouton "Publier" : choix de l'adresse, lien public copiable,
  pastille doree quand des modifications ne sont pas encore en ligne.

Toute mutation — manuelle ou IA — passe par `runOperations` : un seul point
d'entree, donc un historique et une validation communs.

---

## Tests

```bash
npm test                          # tous les espaces
npm test --workspace @crea/schema # AST seul
npm test --workspace @crea/api    # SigV4 et slugs
node --test scripts/lib/*.test.mjs # script d installation
```

| Couverture | Verifie |
| --- | --- |
| AST (12 tests) | insertion refusee sur une feuille, fusion des styles par famille, refus du deplacement dans un descendant, duplication avec ids frais, ids dupliques reattribues, type inconnu rejete, parsing IA tolerant, echappement HTML, neutralisation des URL `javascript:`, rendu deterministe |
| SigV4 (3 tests) | **vecteur de test officiel AWS reproduit a l'identique**, encodage des cles, borne des 7 jours |
| Deploiement (18 tests) | `SESSION_SECRET` genere une seule fois et jamais deux fois identique, cle Anthropic reposee a chaque fourniture, recalage des URL calcule au plus juste, variables manquantes toutes signalees d un coup, normalisation du sous-domaine, lecture des reponses de l API Cloudflare (absent / deja pris / illisible) |
| Installation (13 tests) | reecriture de `wrangler.toml` : cle absente ou ambigue refusee, commentaire perime supprime, prefixe voisin epargne, echappement ; lecture des sorties wrangler (URL deployee, identifiant de compte, UUID de base, etat de session) |
| Slug (5 tests) | accents et ponctuation normalises, aucun tiret en bordure, troncature sans tiret final, motif de la route publique toujours respecte |

La CI (`.github/workflows/ci.yml`) rejoue `typecheck`, `test` et `build` sur
chaque pull request et sur `main`, depuis une installation propre.

Verification manuelle effectuee sur `wrangler dev` : magic link a usage unique,
401 sans session, CRUD projets, rejet d'un arbre invalide, pipeline media
complet, refus d'une cle appartenant a un autre compte, 402 sur solde nul.

---

## Deploiement

### Voie automatique

```bash
npx wrangler login          # une fois, dans votre navigateur
npm run setup:cloudflare
```

Le script `scripts/setup-cloudflare.mjs` enchaine tout ce qui suit, en
verifiant a chaque etape si le travail est deja fait — il est donc relancable
sans risque :

| Etape | Detail |
| --- | --- |
| Session | Refuse d aller plus loin sans `wrangler login` |
| D1 | Cree la base `crea` si absente, ecrit le `database_id` dans `wrangler.toml` |
| R2 | Cree le bucket `crea-media`, tolere qu il existe deja |
| Production | Bascule `ENVIRONMENT` et renseigne `R2_ACCOUNT_ID` |
| Secrets | Genere `SESSION_SECRET` (48 octets), demande la cle Anthropic en saisie masquee |
| Migrations | `d1 migrations apply --remote` |
| Deploiement | Deploie, lit l URL du Worker, recale `APP_ORIGINS` et `R2_PUBLIC_BASE_URL`, redeploie |
| Verification | Interroge `/api/health` et affiche chaque controle |

Rien n est modifie avant une confirmation explicite, qui rappelle les actions
menees sur le compte. `--yes` la saute, `--site-url=<url>` ouvre le CORS sur le
domaine du builder une fois celui-ci deploye.

Les fonctions qui reecrivent `wrangler.toml` et decodent les sorties de wrangler
sont isolees dans `scripts/lib/wrangler-config.mjs` et couvertes par 13 tests :
c est la partie ou une erreur silencieuse ferait le plus de degats.

### Voie GitHub — sans terminal, depuis un telephone

Le workflow `.github/workflows/deploy.yml` deploie l API a chaque push sur
`main`, et se declenche aussi a la main depuis l onglet **Actions**. Aucune
machine de developpement n est necessaire : tout se pilote depuis des pages web.

**A faire une fois, au doigt :**

1. **Cloudflare > My Profile > API Tokens** — creer un jeton depuis le modele
   **Edit Cloudflare Workers**, qui inclut deja Workers Scripts, D1 et R2.
   Un jeton assemble a la main doit porter au minimum `Workers Scripts : Edit`,
   `D1 : Edit` et `Workers R2 Storage : Edit`.
2. **GitHub > Settings > Secrets and variables > Actions** — ajouter :

| Secret | Contenu |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | jeton du modele *Edit Cloudflare Workers* |
| `CLOUDFLARE_ACCOUNT_ID` | identifiant de compte Cloudflare |
| `CREA_ANTHROPIC_API_KEY` | cle du moteur IA — optionnelle |

**La base D1 et le bucket R2 sont crees par le workflow s ils manquent** : rien
a preparer dans le tableau de bord Cloudflare. `CREA_D1_DATABASE_ID` reste
accepte comme raccourci si la base existe deja ailleurs.

Deux **variables** facultatives (onglet *Variables*, pas *Secrets*) :
`CREA_SITE_URL` porte le domaine du builder, pour l autoriser dans le CORS ;
`CREA_WORKERS_SUBDOMAIN` choisit le nom `workers.dev` du compte (defaut `crea`).

Un compte Cloudflare neuf n a pas de sous-domaine `workers.dev` : Cloudflare
accepte alors l upload du Worker mais refuse de le publier. Le workflow
l enregistre au premier deploiement. Ce nom est global au compte et durable —
si celui demande est deja pris par quelqu un d autre, le run le dit et invite a
en choisir un autre.

Tant que les deux premiers secrets manquent, le workflow s arrete proprement et
affiche dans son resume **le nom de ceux qui manquent** : un depot neuf n affiche
pas une croix rouge a chaque push, et le diagnostic ne demande pas de lire les
journaux.

**A chaque deploiement, le workflow :** verifie les types, execute les tests,
cree les ressources Cloudflare manquantes (base D1, bucket R2, sous-domaine
`workers.dev`), prepare `wrangler.toml` (identifiant de base, production, compte R2), pose les
secrets du Worker, applique les migrations distantes, deploie l API, **compile et
deploie le builder** avec l URL reelle de celle-ci, puis recale les URL et
redeploie l API si besoin. `SESSION_SECRET` n est genere que s il manque — le
regenerer deconnecterait tous les comptes.

Chaque cle est acceptee sous deux noms — `CREA_ANTHROPIC_API_KEY` ou
`ANTHROPIC_API_KEY`, `CREA_RESEND_API_KEY` ou `RESEND_API_KEY` : le nom exact du
secret ne decide pas si une fonction marche. Ce qui manque est nomme dans le
journal, avec ce que cela empeche. Si le builder ne peut pas etre deploye, le
workflow previent sans echouer — l API reste en ligne.

`wrangler.toml` est modifie dans le poste de travail du workflow uniquement,
jamais recommite : chaque execution repart du depot.

### Voie manuelle

```bash
npx wrangler d1 create crea            # -> reporter database_id dans wrangler.toml
npx wrangler r2 bucket create crea-media

npx wrangler secret put SESSION_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put R2_ACCESS_KEY_ID      # optionnel, voir plus bas
npx wrangler secret put R2_SECRET_ACCESS_KEY  # optionnel

npm run db:migrate:remote
npm run deploy --workspace @crea/api
```

Les cles S3 de R2 restent facultatives : sans elles, l upload passe par le
Worker (`/api/media/upload`) au lieu d une URL presignee.

### Builder

Le builder est un site entierement statique, servi par un second Worker
(`crea-web`, configure dans `apps/web/wrangler.toml`) plutot que par Cloudflare
Pages : le jeton API qui deploie deja `crea-api` suffit tel quel, la ou Pages
demanderait une permission supplementaire.

```bash
PUBLIC_API_URL=https://crea-api.<compte>.workers.dev \
  npm run build --workspace @crea/web
npx wrangler deploy --cwd apps/web
```

`PUBLIC_API_URL` est fige a la compilation par Astro : changer d API impose de
rebatir le site, pas seulement de le redeployer. Le workflow s en charge — il
compile le builder apres avoir deploye l API, avec l URL reelle de celle-ci.

Pour servir le builder ailleurs (domaine personnalise), definir la variable
`CREA_SITE_URL` : elle prime sur l URL `workers.dev` et devient l origine
autorisee par le CORS.

### Formulaires de contact

Un bloc `form` qui ne declare pas d `endpoint` vise `/p/<adresse>/contact`. La
demande est **ecrite en base avant d etre envoyee** : un email en retard ne
coute rien, une demande de reservation perdue coute une nuitee.

| Protection | Regle |
| --- | --- |
| Champ piege | `_crea_hp`, invisible et hors du parcours clavier — rempli, la demande est ignoree en repondant `200` |
| Limite | 5 demandes par heure et par adresse IP, comptees sur `Messages` |
| Champs retenus | uniquement ceux que le formulaire publie declare |
| Taille | 64 Ko par requete, 4 000 caracteres par champ |

L adresse IP n est jamais stockee : seule une empreinte salee par
`SESSION_SECRET` l est, suffisante pour compter, inutilisable pour identifier.

L email part vers le proprietaire du projet, avec l adresse du visiteur en
`reply-to` quand le formulaire comporte un champ `email` valide. Renseigner un
`endpoint` a la main reste possible pour viser un service tiers.

Les demandes s accumulent dans la table `Messages`. Aucun ecran ne les affiche
encore dans le builder — elles se lisent pour l instant en base :

```bash
npx wrangler d1 execute crea --remote --command \
  "SELECT created_at, sender_name, sender_email, payload FROM Messages ORDER BY created_at DESC LIMIT 20"
```

### Envoi des emails

Le lien de connexion part par [Resend](https://resend.com). Un seul secret est
necessaire :

```bash
npx wrangler secret put RESEND_API_KEY   # ou le secret GitHub CREA_RESEND_API_KEY
```

Sans lui, `/api/auth/magic-link` repond **503 `not_configured`** plutot que de
faire croire a un envoi. `/api/health` expose le meme etat sous la cle `mail`.

L expediteur par defaut, `onboarding@resend.dev`, est verifie d office par
Resend mais **n envoie qu a l adresse du compte Resend**. Des que d autres
personnes doivent se connecter, verifier un domaine chez Resend puis definir la
variable `MAIL_FROM` (ou `CREA_MAIL_FROM` cote GitHub) :

```
MAIL_FROM = "Crea <bonjour@mondomaine.fr>"
```

Un echec d envoi renvoie **502 `upstream_error`**. Le lien lui-meme n apparait
jamais dans les journaux : quiconque y aurait acces prendrait la main sur le
compte.

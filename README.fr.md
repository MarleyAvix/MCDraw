<div align="center">

# MCDraw

**Dessinez votre modèle de données. Obtenez votre base.**<br/>
Un outil de diagrammes léger et rapide, dans le navigateur : des modèles conceptuels Merise (MCD) qui deviennent du SQL, du code d'ORM et des données de test — et des schémas de brainstorming simples comme le plan de site et la carte mentale — des descriptions d'API REST qui s'exportent en OpenAPI — et des diagrammes de séquence qui s'exportent en Mermaid et PlantUML.

[🇬🇧 English](README.md) · [🇫🇷 Français](README.fr.md)

![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)
![Tests](https://img.shields.io/badge/tests-Vitest%20%2B%20Playwright-6e9f18?logo=vitest&logoColor=white)
![Licence : MIT](https://img.shields.io/badge/licence-MIT-green)
![Sans compte](https://img.shields.io/badge/sans%20compte-sans%20serveur-indigo)

<img src="docs/screenshots/mcd-light.png" alt="MCDraw — modèle conceptuel et panneau MLD calculé" width="900" />

</div>

## Pourquoi MCDraw ?

- **Léger et rapide** — s'ouvre instantanément, rien à installer, aucun compte à créer. Votre travail est sauvegardé dans le navigateur.
- **Votre modèle est la seule saisie** — normalisation, schéma relationnel, SQL, code d'ORM et jeux de données sont *dérivés* de votre MCD, en direct.
- **Partage sans compte** — tout le diagramme tient dans le lien (`#share=…`) ; rien n'est stocké sur un serveur.
- **Plus d'un type de diagramme** — un seul éditeur commun (annuler/rétablir, recherche, export, partage, thèmes), un onglet par type de diagramme.

## Types de diagrammes

| Type | Ce que vous obtenez |
| --- | --- |
| **Base de données** (Merise) | Éditeur de MCD avec cardinalités, identifiant relatif (CIF), héritage → **MLD** calculé, vues **ERD** (pattes de corbeau) et **UML** (diagramme de classes) |
| **Plan de site** | Saisissez vos pages en liste indentée *ou* dessinez l'arbre — les deux restent synchronisés. Export d'une liste **Markdown** ou d'un **`sitemap.xml`** (sitemaps.org) |
| **Carte mentale** | Jetez vos idées en liste indentée ou faites pousser les branches sur la carte. Mise en page équilibrée autour de l'idée centrale, une couleur par branche, branches repliables. Export **Markdown** ou **OPML** (XMind, MindNode, OmniOutliner…) |
| **Séquence** | Écrivez les échanges entre services en texte (syntaxe proche de Mermaid — collez un diagramme existant) *ou* construisez-les avec des boutons : participants, messages, notes et tous les blocs (`alt`, `opt`, `loop`, `par`, `critical`, `break`), barres d'activation, numérotation. Export **Mermaid** (README, GitLab, Notion) ou **PlantUML** |
| **API REST** | Décrivez ressources et routes (paramètres, en-têtes, corps, réponses, pagination, authentification) en texte ou sur l'arbre des routes ; un linter de conception vérifie les noms et les codes HTTP. Export **OpenAPI 3.1** (YAML / JSON), **client TypeScript** typé, routes **ASP.NET Core**, fichier de requêtes **`.http`** ou documentation **Markdown** — import d'un fichier OpenAPI existant, ou génération du CRUD directement depuis votre MCD |

<table>
  <tr>
    <td><img src="docs/screenshots/mld.png" alt="Vue MLD calculée" /></td>
    <td><img src="docs/screenshots/sitemap.png" alt="Plan de site : texte à gauche, arbre à droite" /></td>
  </tr>
  <tr>
    <td align="center"><sub>MLD : tables, clés primaires et étrangères</sub></td>
    <td align="center"><sub>Plan de site : une page par ligne, l'indentation fait l'arbre</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/api.png" alt="API REST : texte à gauche, arbre des routes à droite" /></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><sub>API REST : routes écrites en texte ou dessinées en arbre, exportées en OpenAPI</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/screenshots/sequence.png" alt="Diagramme de séquence : texte à gauche, diagramme à droite" /></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><sub>Séquence : une ligne par message, alternatives et activations, exportées en Mermaid ou PlantUML</sub></td>
  </tr>
</table>

## Fonctionnalités

### Base de données (Merise)

- **Modélisation fidèle à Merise** — entités, associations (avec propriétés), cardinalités `0,1` `1,1` `0,n` `1,n`, identifiant relatif (CIF, double bordure), associations réflexives et ternaires, **héritage** (une table par classe / une seule table / une table par classe fille).
- **Édition rapide** — double-clic pour éditer sur place, `Tab`/`Entrée` pour enchaîner les attributs, glisser pour réordonner, multi-sélection (rectangle), copier / coller / dupliquer, annuler / rétablir avec regroupement de la saisie, recherche `Ctrl+F`.
- **Saisie textuelle (Text-to-MCD)** — décrivez le modèle en quelques lignes (syntaxe proche de Mocodo), le diagramme et sa mise en page sont générés.
- **Validation en direct** — clé primaire manquante, noms en double, associations orphelines, dépendances cycliques `(1,1)—(1,1)`, pièges des cascades SQL Server.
- **Vues dérivées** — MLD, ERD (pattes de corbeau) et diagramme de classes UML, exportables en PNG / SVG / PDF.
- **Génération de code** — SQL DDL pour **PostgreSQL, MySQL/MariaDB, SQLite, SQL Server** ; **C# / EF Core** (`DbContext` + Fluent API) ; **Prisma** ; **TypeORM** ; blocs **Mermaid** et **PlantUML** pour votre README ou wiki.
- **Données de test** — scripts `INSERT` réalistes (jusqu'à 1 000 lignes par table, dans l'ordre qui respecte les clés étrangères) en SQL, Bogus (C#) ou Faker (JS), générés dans un Web Worker.
- **Import SQL → MCD** — collez des `CREATE TABLE` existants et récupérez un modèle.
- **Thème personnalisable** (entités, associations), modes clair et sombre.

### Plan de site

- Texte ⇄ arbre, en direct et dans les deux sens (les pages gardent leur identité pendant la saisie, les erreurs sont localisées par ligne).
- Mise en page d'arbre déterministe qui respecte l'ordre de vos lignes.
- Sous-page `N`, page de même niveau `S`, boutons **Avant / Après** pour réordonner, renommage direct, adresse et note par page, copier-coller de sous-arbres entiers, recherche.
- Trois modèles de départ.

### Carte mentale

- Même synchronisation texte ⇄ carte en direct que le plan de site, avec une mise en page équilibrée (les branches se répartissent à gauche et à droite de l'idée centrale) et une couleur par branche.
- `Tab` ajoute une sous-idée, `Entrée` une idée au même niveau, `Espace` replie / déplie une branche ; boutons **Monter / Descendre** pour réordonner les sœurs, note par idée, copier-coller de branches entières, recherche.
- Trois modèles de départ ; export **Markdown** ou **OPML**.

### API REST

- Texte ⇄ arbre des routes, en direct et dans les deux sens : des blocs `schema User` puis une liste indentée de chemins et de méthodes (`GET Lister [auth] [paginated] -> 200 User[], 404`), avec corps de requête, paramètres de requête, en-têtes et note par réponse, ainsi que groupes par route (`# users, admin`), description longue (`~ texte`) et drapeau `[deprecated]` (route barrée sur la carte, exportée en `tags` / `description` / `deprecated`).
- Deux vues : l'**arbre des routes** (une carte par chemin, pastilles de méthodes colorées, cadenas pour les routes protégées, boutons **Monter / Descendre** pour réordonner chemins et méthodes) et les **schémas** (cartes reliées par leurs références, avec l'usage de chacun).
- **Linter de conception** (23 règles) : routes en double, schémas inconnus, verbes ou majuscules dans les chemins, collections au singulier, `404` / `400` / `401` manquants, `POST` sans `201`, listes non paginées, routes d'écriture publiques… Un clic sur une remarque mène à la route.
- **Génération depuis le MCD** : une ressource et son schéma d'entrée par entité, les cinq routes CRUD, les listes imbriquées des relations 1–n, les routes de rattachement des associations n–n et les chemins imbriqués des identifiants relatifs (CIF). Annulable.
- **Import d'un fichier OpenAPI 3 existant** (JSON ou YAML) : schémas, `allOf`, types nullables, paramètres, corps, réponses et sécurité sont convertis ; ce qui ne se représente pas (`oneOf`, objets libres, réponses `default`…) est simplifié et listé dans un compte rendu.
- Exports : **OpenAPI 3.1** (YAML et JSON), **client TypeScript** (`api-client.ts` : interfaces et client `fetch` typé sans dépendance, avec authentification, pagination et `ApiError`), routes **ASP.NET Core** (Minimal API : chemins typés, paramètres liés, authentification et réponses déclarées, corps à écrire), fichier **`.http`** (REST Client de VS Code, JetBrains) avec corps d'exemple, documentation **Markdown**. Trois modèles de départ orientés développement (boutique, tâches, authentification).

### Diagramme de séquence

- Texte ⇄ diagramme, en direct et dans les deux sens, dans une syntaxe proche de Mermaid : `Client ->> API: POST /login`, `->>` appel, `-->>` retour, `-)` asynchrone, `-x` perdu, `->>+` / `-->>-` pour ouvrir / fermer une activation, `Note over A, B: …`. Un `sequenceDiagram` Mermaid collé tel quel fonctionne ; un participant cité est créé automatiquement.
- **Tous les blocs** : `alt` / `else`, `opt`, `loop`, `par` / `and`, `critical` / `option`, `break`, imbriqués et fermés par `end`.
- **Des boutons en plus du texte** : ajouter un participant, un message, une note ou un bloc ; le bouton *Bloc* enveloppe les messages sélectionnés ; **Monter / Descendre / Gauche / Droite** réordonnent ; double-clic pour modifier un élément (renommer un participant met à jour ses messages) ; `Suppr` le retire.
- **Depuis votre API** : choisissez une route décrite dans l'onglet API REST et obtenez sa séquence — client, API, authentification si la route est protégée, base de données, puis une section `alt` par réponse déclarée. Annulable.
- Participants de type acteur ou base de données, libellés affichés facultatifs, numérotation des messages, textes sur plusieurs lignes (`<br>`).
- Exports : **Mermaid** (`.mmd`, copie dans le presse-papiers, ou fichier Markdown avec le bloc) et **PlantUML** (`.puml`). Trois modèles de départ (connexion, commande, synchronisation avec reprise).

### Partout

- Export / import du projet en JSON (importer un fichier d'un autre type propose de basculer vers ce type).
- Partage par lien, sans compte ni serveur.
- Sauvegarde automatique dans le navigateur.
- Raccourcis clavier (bouton `?` dans l'en-tête).

## Du MCD au MLD : les règles appliquées

| Motif du MCD | Tables obtenues |
| --- | --- |
| Entité | Une table ; son identifiant devient la clé primaire |
| Association `(x,1)` — `(x,n)` | **Clé étrangère** du côté de la cardinalité `1` ; les propriétés de l'association la suivent |
| Association `(x,1)` — `(x,1)` | Clé étrangère avec contrainte **`UNIQUE`** |
| Association `(x,n)` — `(x,n)` | **Table d'association** : clé primaire composée des deux identifiants, plus les propriétés de l'association |
| Association ternaire (ou plus) | Table d'association avec une clé étrangère par patte ; une patte de cardinalité maximale `1` reste clé étrangère mais n'entre pas dans la clé primaire |
| Association réflexive | Mêmes règles, avec les colonnes de clé préfixées par le **rôle** de la patte pour rester distinctes |
| Identifiant relatif (CIF) | La clé du parent rejoint la **clé primaire composée** de l'enfant |
| Héritage | Selon la stratégie choisie : une table par classe, une seule table, ou une table par classe fille |

## Démarrage

Nécessite [Node.js](https://nodejs.org/) 22+.

```bash
git clone https://github.com/MarleyAvix/MCDraw.git
cd MCDraw
npm install
npm run dev
```

Ouvrez ensuite l'adresse affichée par Vite (en général <http://localhost:5173>).

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification des types et build de production (`dist/`) |
| `npm run preview` | Sert le build de production en local |
| `npm test` | Tests unitaires et de composants (Vitest) |
| `npm run test:e2e` | Tests de bout en bout (Playwright) |

### Avec Docker

```bash
docker build -t mcdraw .
docker run --rm -p 8080:80 mcdraw
```

L'application est alors servie par nginx sur <http://localhost:8080>.

## Pile technique

[Vue 3](https://vuejs.org/) · TypeScript · [Pinia](https://pinia.vuejs.org/) · [Vue Flow](https://vueflow.dev/) · Tailwind CSS v4 · Vite · Vitest · Playwright · icônes [lucide](https://lucide.dev/) · [`@faker-js/faker`](https://fakerjs.dev/) · [`yaml`](https://eemeli.org/yaml/) (chargé uniquement à l'import d'un fichier OpenAPI).

## Architecture : ajouter un type de diagramme

Un *type de document* se décrit par un seul contrat, [`DocumentType`](src/core/documentType.ts) : ses vues, panneaux, actions, raccourcis, exemples et exports. Le shell (en-tête, annuler/rétablir, sauvegarde, partage, export, recherche) est commun.

```
src/
├─ core/          contrat DocumentType, registre, état du shell, outils d'arbre partagés
├─ documents/
│  ├─ mcd/        Base de données (Merise)
│  ├─ sitemap/    Plan de site
│  ├─ mindmap/    Carte mentale
│  ├─ api/        API REST
│  └─ sequence/   Diagramme de séquence
├─ engine/        logique pure : MCD → MLD, SQL, ORM, données de test, liens de partage…
├─ composables/   historique, sauvegarde, outils du canvas, import/export de fichiers…
└─ components/    canvas, panneaux et fenêtres du type base de données
```

Pour ajouter un type (organigramme, diagramme de flux, parcours utilisateur…) : créez un dossier dans `src/documents/`, implémentez `DocumentType`, puis enregistrez-le dans `src/documents/index.ts`. L'historique, la sauvegarde, l'export JSON, le partage par lien et la recherche viennent sans effort.

## Contribuer

MCDraw est un projet open source mené en parallèle d'autres activités, et les contributions sont les bienvenues — signalements de bugs, idées, nouveaux types de diagrammes, traductions. Lancez `npm test` et `npm run build` avant d'ouvrir une pull request. Les commits suivent la convention [Conventional Commits](https://www.conventionalcommits.org/).

## Licence

[MIT](LICENSE) © 2026 Marley Avix

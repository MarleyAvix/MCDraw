import { layoutMcd, parseMcdText } from './textToMcd'
import type { Attribute, InheritanceStrategy, Link, MeriseSchema } from '../types/schema'

/**
 * Modèles de départ « métier » : des schémas complets, écrits dans la syntaxe de saisie textuelle
 * (voir textToMcd.ts) puis complétés par ce que cette syntaxe ne sait pas dire — contraintes de colonne,
 * actions référentielles, stratégie d'héritage. La mise en page est calculée automatiquement.
 */

type ColumnPatch = Partial<Pick<Attribute, 'unique' | 'notNull' | 'defaultValue' | 'check'>>
type LinkPatch = Partial<Pick<Link, 'onDelete' | 'onUpdate'>>

export interface TemplateDef {
  id: string
  label: string
  /** Une phrase : ce que le modèle illustre. */
  description: string
  text: string
  /** `Entité.attribut` → contraintes. */
  columns?: Record<string, ColumnPatch>
  /** `Association>Entité` → actions de la clé étrangère qui référence cette entité. */
  links?: Record<string, LinkPatch>
  /** Entité racine → stratégie de traduction de la hiérarchie. */
  inheritance?: Record<string, InheritanceStrategy>
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const CASCADE: LinkPatch = { onDelete: 'CASCADE' }
const RESTRICT: LinkPatch = { onDelete: 'RESTRICT' }
const UNIQUE: ColumnPatch = { unique: true }

export const TEMPLATE_DEFS: TemplateDef[] = [
  {
    id: 'ecommerce',
    label: 'E-commerce complet',
    description: 'Clients, adresses (entité faible), catalogue à catégories hiérarchiques, commandes, paiements, avis.',
    text: `
Client: #id_client, nom:VARCHAR(100), prenom:VARCHAR(100), email:VARCHAR(255), telephone:VARCHAR(20), date_inscription:DATETIME
Adresse: #no_adresse, rue:VARCHAR(255), code_postal:VARCHAR(10), ville:VARCHAR(100), pays:VARCHAR(60)
Catégorie: #id_categorie, nom:VARCHAR(100)
Produit: #id_produit, sku:VARCHAR(30), libelle:VARCHAR(150), description:TEXT, prix:DECIMAL(10,2), stock:INT
Commande: #id_commande, date_commande:DATETIME, statut:VARCHAR(20)
Paiement: #id_paiement, montant:DECIMAL(10,2), mode:VARCHAR(20), date_paiement:DATETIME

Habiter: Client 0,n -- Adresse 1,1 CIF
Passer: Client 0,n -- Commande 1,1
Livrer: Adresse 0,n -- Commande 1,1
Contenir (quantite:INT, prix_unitaire:DECIMAL(10,2)): Commande 1,n -- Produit 0,n
Classer: Catégorie 0,n -- Produit 1,1
Sous_catégorie: Catégorie 0,n parent -- Catégorie 0,1 enfant
Régler: Commande 0,1 -- Paiement 1,1
Noter (note:INT, commentaire:TEXT, date_avis:DATE): Client 0,n -- Produit 0,n
`,
    columns: {
      'Client.email': { unique: true, notNull: true },
      'Client.date_inscription': { defaultValue: 'CURRENT_TIMESTAMP' },
      'Produit.sku': UNIQUE,
      'Produit.prix': { check: 'prix >= 0' },
      'Produit.stock': { defaultValue: '0', check: 'stock >= 0' },
      'Commande.statut': { defaultValue: 'en_attente' },
      'Contenir.quantite': { check: 'quantite > 0' },
      'Noter.note': { check: 'note BETWEEN 1 AND 5' },
    },
    links: {
      'Habiter>Client': CASCADE,
      'Passer>Client': RESTRICT,
      'Contenir>Commande': CASCADE,
      'Contenir>Produit': RESTRICT,
      'Régler>Commande': CASCADE,
      'Noter>Client': CASCADE,
      'Noter>Produit': CASCADE,
      'Sous_catégorie>Catégorie': RESTRICT,
    },
  },
  {
    id: 'ecole',
    label: 'École / université',
    description: 'Héritage Personne → Étudiant / Enseignant, filières, cours avec prérequis, inscriptions notées, planning des salles.',
    text: `
Personne: #id_personne, nom:VARCHAR(100), prenom:VARCHAR(100), date_naissance:DATE, email:VARCHAR(255)
Étudiant < Personne: numero_etudiant:VARCHAR(12), annee_inscription:INT
Enseignant < Personne: specialite:VARCHAR(100), date_embauche:DATE
Filière: #id_filiere, nom:VARCHAR(100), niveau:VARCHAR(20)
Département: #id_departement, nom:VARCHAR(100)
Cours: #id_cours, code:VARCHAR(10), intitule:VARCHAR(150), credits:INT
Salle: #id_salle, nom:VARCHAR(30), capacite:INT

Suivre: Étudiant 0,n -- Filière 1,1
Rattacher: Enseignant 0,n -- Département 1,1
Enseigner: Enseignant 0,n -- Cours 1,1
Proposer: Filière 1,n -- Cours 0,n
S_inscrire (annee_universitaire:INT, note:DECIMAL(4,2)): Étudiant 0,n -- Cours 0,n
Prérequis: Cours 0,n prerequis -- Cours 0,n suivant
Planifier (jour:VARCHAR(10), heure_debut:VARCHAR(5), heure_fin:VARCHAR(5)): Cours 0,n -- Salle 0,n
`,
    columns: {
      'Personne.email': UNIQUE,
      'Étudiant.numero_etudiant': { unique: true, notNull: true },
      'Cours.code': UNIQUE,
      'Cours.credits': { check: 'credits > 0' },
      'Salle.capacite': { check: 'capacite > 0' },
      'S_inscrire.note': { check: 'note BETWEEN 0 AND 20' },
    },
    links: {
      'Suivre>Filière': RESTRICT,
      'Enseigner>Enseignant': RESTRICT,
      'S_inscrire>Étudiant': CASCADE,
      'S_inscrire>Cours': CASCADE,
      'Prérequis>Cours': RESTRICT,
    },
    inheritance: { Personne: 'class' },
  },
  {
    id: 'hopital',
    label: 'Hôpital',
    description: 'Soignants (médecins, infirmiers), services, chambres identifiées par leur service, admissions, consultations, prescriptions.',
    text: `
Patient: #id_patient, num_secu:VARCHAR(15), nom:VARCHAR(100), prenom:VARCHAR(100), date_naissance:DATE, groupe_sanguin:VARCHAR(3)
Soignant: #id_soignant, matricule:VARCHAR(12), nom:VARCHAR(100), prenom:VARCHAR(100)
Médecin < Soignant: specialite:VARCHAR(100), rpps:VARCHAR(11)
Infirmier < Soignant: grade:VARCHAR(30)
Service: #id_service, nom:VARCHAR(100), etage:INT
Chambre: #no_chambre, nb_lits:INT
Admission: #id_admission, date_entree:DATETIME, date_sortie:DATETIME, motif:VARCHAR(255)
Consultation: #id_consultation, date_consultation:DATETIME, diagnostic:TEXT, tarif:DECIMAL(8,2)
Médicament: #id_medicament, nom:VARCHAR(150), dosage:VARCHAR(30)

Travailler: Soignant 0,n -- Service 1,1
Contenir: Service 0,n -- Chambre 1,1 CIF
Concerner: Patient 0,n -- Admission 1,1
Occuper: Chambre 0,n -- Admission 1,1
Examiner: Patient 0,n -- Consultation 1,1
Réaliser: Médecin 0,n -- Consultation 1,1
Prescrire (posologie:VARCHAR(100), duree_jours:INT): Consultation 0,n -- Médicament 0,n
`,
    columns: {
      'Patient.num_secu': { unique: true, notNull: true },
      'Soignant.matricule': UNIQUE,
      'Médecin.rpps': UNIQUE,
      'Service.nom': UNIQUE,
      'Chambre.nb_lits': { defaultValue: '1', check: 'nb_lits > 0' },
      'Consultation.tarif': { check: 'tarif >= 0' },
      'Prescrire.duree_jours': { check: 'duree_jours > 0' },
    },
    links: {
      'Travailler>Service': RESTRICT,
      'Concerner>Patient': RESTRICT,
      'Examiner>Patient': RESTRICT,
      'Prescrire>Consultation': CASCADE,
      'Prescrire>Médicament': RESTRICT,
    },
    inheritance: { Soignant: 'class' },
  },
  {
    id: 'rh',
    label: 'Ressources humaines',
    description: 'Employés et hiérarchie (association réflexive), départements, postes, projets avec heures, compétences, congés (entité faible).',
    text: `
Employé: #id_employe, matricule:VARCHAR(10), nom:VARCHAR(100), prenom:VARCHAR(100), email:VARCHAR(255), date_embauche:DATE, salaire:DECIMAL(10,2)
Département: #id_departement, nom:VARCHAR(100), budget:DECIMAL(12,2)
Poste: #id_poste, intitule:VARCHAR(100), salaire_min:DECIMAL(10,2), salaire_max:DECIMAL(10,2)
Projet: #id_projet, nom:VARCHAR(150), date_debut:DATE, date_fin:DATE
Congé: #no_conge, date_debut:DATE, date_fin:DATE, type:VARCHAR(30), statut:VARCHAR(20)
Compétence: #id_competence, libelle:VARCHAR(100)

Appartenir: Employé 0,n -- Département 1,1
Occuper: Employé 0,n -- Poste 1,1
Encadrer: Employé 0,n manager -- Employé 0,1 collaborateur
Affecter (role:VARCHAR(60), heures:INT): Employé 0,n -- Projet 1,n
Prendre: Employé 0,n -- Congé 1,1 CIF
Possèder (niveau:INT): Employé 0,n -- Compétence 0,n
`,
    columns: {
      'Employé.matricule': { unique: true, notNull: true },
      'Employé.email': UNIQUE,
      'Employé.salaire': { check: 'salaire > 0' },
      'Département.nom': UNIQUE,
      'Congé.statut': { defaultValue: 'demande' },
      'Affecter.heures': { defaultValue: '0', check: 'heures >= 0' },
      'Compétence.libelle': UNIQUE,
      'Possèder.niveau': { check: 'niveau BETWEEN 1 AND 5' },
    },
    links: {
      'Appartenir>Département': RESTRICT,
      'Occuper>Poste': RESTRICT,
      'Encadrer>Employé': RESTRICT,
      'Affecter>Employé': CASCADE,
      'Affecter>Projet': CASCADE,
      'Prendre>Employé': CASCADE,
      'Possèder>Employé': CASCADE,
      'Possèder>Compétence': CASCADE,
    },
  },
  {
    id: 'hotel',
    label: 'Hôtel / réservations',
    description: 'Hôtels, chambres identifiées par leur hôtel, types de chambre, réservations multi-chambres, services consommés, factures.',
    text: `
Client: #id_client, nom:VARCHAR(100), prenom:VARCHAR(100), email:VARCHAR(255), telephone:VARCHAR(20)
Hôtel: #id_hotel, nom:VARCHAR(150), ville:VARCHAR(100), etoiles:INT
Type_chambre: #id_type, libelle:VARCHAR(60), capacite:INT, prix_nuit:DECIMAL(8,2)
Chambre: #numero, etage:INT
Réservation: #id_reservation, date_arrivee:DATE, date_depart:DATE, nb_personnes:INT, statut:VARCHAR(20)
Service: #id_service, libelle:VARCHAR(100), prix:DECIMAL(8,2)
Facture: #id_facture, date_emission:DATE, montant_total:DECIMAL(10,2)

Situer: Hôtel 0,n -- Chambre 1,1 CIF
Qualifier: Type_chambre 0,n -- Chambre 1,1
Réserver: Client 0,n -- Réservation 1,1
Occuper: Réservation 1,n -- Chambre 0,n
Consommer (quantite:INT, date_conso:DATE): Réservation 0,n -- Service 0,n
Facturer: Réservation 0,1 -- Facture 1,1
`,
    columns: {
      'Client.email': { unique: true, notNull: true },
      'Hôtel.etoiles': { check: 'etoiles BETWEEN 1 AND 5' },
      'Type_chambre.libelle': UNIQUE,
      'Type_chambre.prix_nuit': { check: 'prix_nuit > 0' },
      'Réservation.statut': { defaultValue: 'confirmee' },
      'Réservation.nb_personnes': { check: 'nb_personnes > 0' },
      'Consommer.quantite': { defaultValue: '1', check: 'quantite > 0' },
    },
    links: {
      'Situer>Hôtel': CASCADE,
      'Réserver>Client': RESTRICT,
      'Occuper>Réservation': CASCADE,
      'Consommer>Réservation': CASCADE,
      'Facturer>Réservation': RESTRICT,
    },
  },
  {
    id: 'social',
    label: 'Réseau social',
    description: 'Abonnements (réflexive n-n), publications, commentaires (entité faible), likes, hashtags, groupes, messages privés.',
    text: `
Utilisateur: #id_utilisateur, pseudo:VARCHAR(50), email:VARCHAR(255), bio:TEXT, date_inscription:DATETIME
Publication: #id_publication, contenu:TEXT, date_publication:DATETIME
Commentaire: #no_commentaire, contenu:TEXT, date_commentaire:DATETIME
Hashtag: #id_hashtag, libelle:VARCHAR(60)
Groupe: #id_groupe, nom:VARCHAR(100), description:TEXT
Message: #id_message, contenu:TEXT, date_envoi:DATETIME

Écrire: Utilisateur 0,n -- Publication 1,1
Commenter: Publication 0,n -- Commentaire 1,1 CIF
Rédiger: Utilisateur 0,n -- Commentaire 1,1
Suivre (date_suivi:DATETIME): Utilisateur 0,n suiveur -- Utilisateur 0,n suivi
Aimer (date_like:DATETIME): Utilisateur 0,n -- Publication 0,n
Taguer: Publication 0,n -- Hashtag 0,n
Rejoindre (role:VARCHAR(20)): Utilisateur 0,n -- Groupe 0,n
Expédier: Utilisateur 0,n expediteur -- Message 1,1
Recevoir: Utilisateur 0,n destinataire -- Message 1,1
`,
    columns: {
      'Utilisateur.pseudo': { unique: true, notNull: true },
      'Utilisateur.email': { unique: true, notNull: true },
      'Utilisateur.date_inscription': { defaultValue: 'CURRENT_TIMESTAMP' },
      'Publication.date_publication': { defaultValue: 'CURRENT_TIMESTAMP' },
      'Hashtag.libelle': UNIQUE,
      'Rejoindre.role': { defaultValue: 'membre' },
    },
    links: {
      'Écrire>Utilisateur': CASCADE,
      'Commenter>Publication': CASCADE,
      'Rédiger>Utilisateur': RESTRICT,
      'Suivre>Utilisateur': RESTRICT,
      'Aimer>Utilisateur': RESTRICT,
      'Aimer>Publication': CASCADE,
      'Taguer>Publication': CASCADE,
      'Rejoindre>Groupe': CASCADE,
    },
  },
]

function findOrThrow<T>(list: T[], pred: (x: T) => boolean, what: string): T {
  const found = list.find(pred)
  if (!found) throw new Error(`Modèle de départ : ${what} introuvable`)
  return found
}

/** Construit le schéma d'un modèle : lecture du texte, contraintes, puis mise en page. */
export function buildTemplate(def: TemplateDef, makeId: () => string): MeriseSchema {
  const { schema, errors } = parseMcdText(def.text, makeId)
  if (errors.length) throw new Error(`Modèle « ${def.id} » invalide : ${errors.map((e) => `ligne ${e.line} : ${e.message}`).join(' ; ')}`)

  const owners = [...schema.entities, ...schema.relations]
  for (const [path, patch] of Object.entries(def.columns ?? {})) {
    const [owner, column] = path.split('.')
    const node = findOrThrow(owners, (n) => fold(n.name) === fold(owner), `« ${owner} » (${path})`)
    Object.assign(findOrThrow(node.attributes, (a) => a.name === column, path), patch)
  }
  for (const [path, patch] of Object.entries(def.links ?? {})) {
    const [rel, ent] = path.split('>')
    const relation = findOrThrow(schema.relations, (r) => fold(r.name) === fold(rel), `association « ${rel} » (${path})`)
    const entity = findOrThrow(schema.entities, (e) => fold(e.name) === fold(ent), `entité « ${ent} » (${path})`)
    const legs = schema.links.filter((l) => l.relationId === relation.id && l.entityId === entity.id)
    if (!legs.length) throw new Error(`Modèle de départ : patte ${path} introuvable`)
    // Association réflexive : la clé étrangère référence l'entité côté « n » (le parent, le suivi…).
    const many = legs.filter((l) => l.cardinality.endsWith('n'))
    const targets = legs.length > 1 && many.length ? many : legs
    for (const leg of targets) Object.assign(leg, patch)
  }
  for (const [root, strategy] of Object.entries(def.inheritance ?? {})) {
    findOrThrow(schema.entities, (e) => fold(e.name) === fold(root), `racine « ${root} »`).inheritance = strategy
  }
  return layoutMcd(schema)
}

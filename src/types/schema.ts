export const DATA_TYPES = ['INT', 'VARCHAR', 'TEXT', 'DECIMAL', 'FLOAT', 'BOOLEAN', 'DATE', 'DATETIME'] as const
export type DataType = (typeof DATA_TYPES)[number]

export const CARDINALITIES = ['0,1', '1,1', '0,n', '1,n'] as const
export type Cardinality = (typeof CARDINALITIES)[number]

/** Action référentielle d'une clé étrangère (`ON DELETE` / `ON UPDATE`). */
export const REF_ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'] as const
export type RefAction = (typeof REF_ACTIONS)[number]

export interface Attribute {
  id: string
  name: string
  type: DataType
  /** Taille / précision : VARCHAR(255), DECIMAL(10,2)… */
  size?: string
  isPrimaryKey: boolean
  /** NOT NULL explicite (sans effet sur un identifiant, déjà non nul). */
  notNull?: boolean
  /** Valeur unique : `UNIQUE`. */
  unique?: boolean
  /** Valeur par défaut : littéral (`0`, `actif`) ou fonction SQL (`CURRENT_TIMESTAMP`). */
  defaultValue?: string
  /** Condition `CHECK`, ex : `prix >= 0`. */
  check?: string
}

/** Traduction d'une hiérarchie « est un » : une table par classe, une seule table, une table par classe fille. */
export const INHERITANCE_STRATEGIES = ['class', 'single', 'concrete'] as const
export type InheritanceStrategy = (typeof INHERITANCE_STRATEGIES)[number]

export interface Entity {
  id: string
  name: string
  /** Entité mère (relation « est un ») : cette entité en est une spécialisation. */
  parentId?: string
  /** Stratégie de traduction MLD, lue sur la classe racine de la hiérarchie (défaut : `class`). */
  inheritance?: InheritanceStrategy
  attributes: Attribute[]
  x: number
  y: number
}

export interface Relation {
  id: string
  name: string
  /** Nom personnalisé de la table de jointure dans le MLD (sinon contraction des tables reliées). */
  tableName?: string
  /** Propriétés portées par l'association (ex : quantité). */
  attributes: Attribute[]
  x: number
  y: number
}

/** Patte reliant une association à une entité, porteuse de la cardinalité. */
export interface Link {
  id: string
  relationId: string
  entityId: string
  cardinality: Cardinality
  /** Rôle optionnel (utile pour les associations réflexives). */
  role?: string
  /** Identifiant relatif (CIF) : la clé de l'autre entité fait partie de la clé de l'entité de cette patte (1,1). */
  identifying?: boolean
  /**
   * Actions de la clé étrangère qui référence l'entité de cette patte (celle que l'on supprime / modifie).
   * Non précisées : le SGBD applique son comportement par défaut (NO ACTION).
   */
  onDelete?: RefAction
  onUpdate?: RefAction
  relationHandle?: string
  entityHandle?: string
  /** Tracé courbe (sinon droit). */
  curved?: boolean
  /** Décalage du point de passage par rapport au milieu des deux centres (tracé déplacé à la main). */
  bend?: { x: number; y: number }
}

export interface MeriseSchema {
  entities: Entity[]
  relations: Relation[]
  links: Link[]
}

export interface MldForeignKey {
  columns: string[]
  refTable: string
  refColumns: string[]
  onDelete?: RefAction
  onUpdate?: RefAction
  /** Patte du MCD à l'origine de la clé (absente pour un héritage). */
  linkId?: string
  /** Association 1–1 : les colonnes de la clé, prises ensemble, sont uniques. */
  unique?: boolean
}

export interface MldColumn {
  name: string
  /** Type SQL complet, ex : VARCHAR(255). */
  sqlType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  nullable: boolean
  unique?: boolean
  defaultValue?: string
  check?: string
  /** Type de données d'origine (sert à formater la valeur par défaut). */
  dataType?: DataType
}

export interface MldTable {
  name: string
  origin: 'entity' | 'association'
  sourceId: string
  columns: MldColumn[]
  primaryKey: string[]
  foreignKeys: MldForeignKey[]
}

export interface MldResult {
  tables: MldTable[]
  warnings: string[]
}

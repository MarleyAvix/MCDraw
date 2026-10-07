export const DATA_TYPES = ['INT', 'VARCHAR', 'TEXT', 'DECIMAL', 'FLOAT', 'BOOLEAN', 'DATE', 'DATETIME'] as const
export type DataType = (typeof DATA_TYPES)[number]

export const CARDINALITIES = ['0,1', '1,1', '0,n', '1,n'] as const
export type Cardinality = (typeof CARDINALITIES)[number]

export interface Attribute {
  id: string
  name: string
  type: DataType
  /** Taille / précision : VARCHAR(255), DECIMAL(10,2)… */
  size?: string
  isPrimaryKey: boolean
}

export interface Entity {
  id: string
  name: string
  attributes: Attribute[]
  x: number
  y: number
}

export interface Relation {
  id: string
  name: string
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
  relationHandle?: string
  entityHandle?: string
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
}

export interface MldColumn {
  name: string
  /** Type SQL complet, ex : VARCHAR(255). */
  sqlType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  nullable: boolean
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

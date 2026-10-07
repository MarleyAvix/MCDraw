import type {
  Attribute,
  Cardinality,
  Entity,
  Link,
  MeriseSchema,
  MldResult,
  MldTable,
  Relation,
} from '../types/schema'

/** Transforme un libellé libre en identifiant SQL (snake_case, sans accents). */
export function slug(label: string, fallback = 'sans_nom'): string {
  let s = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  if (!s) s = fallback
  if (/^\d/.test(s)) s = `_${s}`
  return s
}

export function sqlTypeOf(attr: Pick<Attribute, 'type' | 'size'>): string {
  const size = attr.size?.trim()
  switch (attr.type) {
    case 'VARCHAR':
      return `VARCHAR(${size || 255})`
    case 'DECIMAL':
      return `DECIMAL(${size || '10,2'})`
    default:
      return attr.type
  }
}

const maxIsOne = (c: Cardinality) => c.endsWith('1')
const minIsZero = (c: Cardinality) => c.startsWith('0')

function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  let i = 2
  while (set.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

const colNames = (t: MldTable) => t.columns.map((c) => c.name)

/** Ajoute à `host` les colonnes de clé étrangère référençant la clé primaire de `target`. */
function addForeignKey(host: MldTable, target: MldTable, opts: { nullable: boolean; prefix: string; forcePrefix?: boolean }): string[] {
  const created: string[] = []
  for (const pkName of target.primaryKey) {
    const pk = target.columns.find((c) => c.name === pkName)!
    let name = pk.name
    if (opts.forcePrefix || colNames(host).includes(name)) name = `${opts.prefix}_${pk.name}`
    name = uniqueName(name, colNames(host))
    host.columns.push({
      name,
      sqlType: pk.sqlType,
      isPrimaryKey: false,
      isForeignKey: true,
      nullable: opts.nullable,
    })
    created.push(name)
  }
  host.foreignKeys.push({ columns: created, refTable: target.name, refColumns: [...target.primaryKey] })
  return created
}

function addAttributes(table: MldTable, attrs: Attribute[], pkAllowed: boolean) {
  for (const a of attrs) {
    const name = uniqueName(slug(a.name, 'propriete'), colNames(table))
    const isPk = pkAllowed && a.isPrimaryKey
    table.columns.push({
      name,
      sqlType: sqlTypeOf(a),
      isPrimaryKey: isPk,
      isForeignKey: false,
      nullable: !isPk,
    })
    if (isPk) table.primaryKey.push(name)
  }
}

/**
 * Règles Merise MCD → MLD :
 *  - toute entité devient une table dont la clé primaire est son identifiant ;
 *  - association binaire avec une patte de cardinalité max 1 : la clé de l'autre entité migre
 *    en clé étrangère dans la table de l'entité « 1 » (propriétés de l'association incluses) ;
 *  - association binaire 1,1 – 1,1 (ou 0,1) : migration du côté de la patte 1,1 ;
 *  - association binaire n–n et associations n-aires : table dédiée, clé primaire composée des
 *    clés étrangères (hors pattes de cardinalité max 1 pour les associations n-aires).
 */
export function meriseToMld(schema: MeriseSchema): MldResult {
  const warnings: string[] = []
  const tables: MldTable[] = []
  const tableByEntity = new Map<string, MldTable>()
  const entityById = new Map<string, Entity>(schema.entities.map((e) => [e.id, e]))

  for (const entity of schema.entities) {
    const table: MldTable = {
      name: uniqueName(slug(entity.name, 'entite'), tables.map((t) => t.name)),
      origin: 'entity',
      sourceId: entity.id,
      columns: [],
      primaryKey: [],
      foreignKeys: [],
    }
    addAttributes(table, entity.attributes, true)
    if (!table.primaryKey.length) {
      warnings.push(`L'entité « ${entity.name || '(sans nom)'} » n'a pas d'identifiant : définissez une clé primaire.`)
    }
    tables.push(table)
    tableByEntity.set(entity.id, table)
  }

  const linksOf = (r: Relation): Link[] =>
    schema.links.filter((l) => l.relationId === r.id && entityById.has(l.entityId))

  for (const relation of schema.relations) {
    const links = linksOf(relation)
    const label = relation.name || '(sans nom)'
    if (links.length < 2) {
      warnings.push(`L'association « ${label} » doit avoir au moins deux pattes pour produire une table ou une clé étrangère.`)
      continue
    }
    if (links.some((l) => !tableByEntity.get(l.entityId)!.primaryKey.length)) {
      warnings.push(`L'association « ${label} » est ignorée : une des entités reliées n'a pas de clé primaire.`)
      continue
    }

    const prefixFor = (l: Link) => slug(l.role || relation.name, 'ref')

    if (links.length === 2 && links.some((l) => maxIsOne(l.cardinality))) {
      const [a, b] = links
      let host: Link
      if (maxIsOne(a.cardinality) && !maxIsOne(b.cardinality)) host = a
      else if (maxIsOne(b.cardinality) && !maxIsOne(a.cardinality)) host = b
      else host = b.cardinality === '1,1' && a.cardinality !== '1,1' ? b : a
      const target = host === a ? b : a
      const hostTable = tableByEntity.get(host.entityId)!
      addForeignKey(hostTable, tableByEntity.get(target.entityId)!, {
        nullable: minIsZero(host.cardinality),
        prefix: prefixFor(target),
      })
      addAttributes(hostTable, relation.attributes, false)
      continue
    }

    // Table d'association
    const table: MldTable = {
      name: uniqueName(slug(relation.name, 'association'), tables.map((t) => t.name)),
      origin: 'association',
      sourceId: relation.id,
      columns: [],
      primaryKey: [],
      foreignKeys: [],
    }
    const multi = links.filter((l) => !maxIsOne(l.cardinality))
    const inPk = links.length > 2 && multi.length ? multi : links
    for (const link of links) {
      const cols = addForeignKey(table, tableByEntity.get(link.entityId)!, {
        nullable: false,
        prefix: prefixFor(link),
        // une entité reliée plusieurs fois : toutes ses clés étrangères portent le rôle
        forcePrefix: links.filter((l) => l.entityId === link.entityId).length > 1,
      })
      if (inPk.includes(link)) table.primaryKey.push(...cols)
    }
    addAttributes(table, relation.attributes, true)
    tables.push(table)
  }

  // Synchronise les drapeaux PK / FK des colonnes
  for (const t of tables) {
    const fkCols = new Set(t.foreignKeys.flatMap((f) => f.columns))
    for (const c of t.columns) {
      c.isForeignKey = fkCols.has(c.name)
      c.isPrimaryKey = t.primaryKey.includes(c.name)
    }
  }

  return { tables, warnings }
}

import { resolveInheritance } from './inheritance'
import { slug, uniqueName } from './naming'
import type {
  Attribute,
  Cardinality,
  Entity,
  Link,
  MeriseSchema,
  MldColumn,
  MldResult,
  MldTable,
  Relation,
} from '../types/schema'

export { slug }

export interface FkGroup {
  refTable: string
  columns: MldColumn[]
  /** Clé étrangère unique (association 1–1). */
  unique: boolean
}

/**
 * Découpe une table en blocs : clé primaire (dans l'ordre de la clé), une clé étrangère par groupe
 * (hors colonnes déjà dans la clé primaire) et colonnes ordinaires.
 */
export function splitColumns(t: MldTable): { pk: MldColumn[]; fks: FkGroup[]; others: MldColumn[] } {
  const byName = new Map(t.columns.map((c) => [c.name, c]))
  const pk = t.primaryKey.map((n) => byName.get(n)!).filter(Boolean)
  const fks: FkGroup[] = t.foreignKeys
    .map((fk) => ({
      refTable: fk.refTable,
      columns: fk.columns.filter((n) => !t.primaryKey.includes(n)).map((n) => byName.get(n)!),
      unique: !!fk.unique,
    }))
    .filter((g) => g.columns.length)
  const grouped = new Set([...t.primaryKey, ...fks.flatMap((g) => g.columns.map((c) => c.name))])
  return { pk, fks, others: t.columns.filter((c) => !grouped.has(c.name)) }
}

/**
 * Taille saisie, normalisée (`10, 2` → `10,2`) : `''` si absente ou sans objet pour le type,
 * `null` si elle est invalide (le type retombe alors sur sa taille par défaut).
 */
export function normalizeSize(attr: Pick<Attribute, 'type' | 'size'>): string | null {
  const size = attr.size?.trim() ?? ''
  if (!size) return ''
  if (attr.type === 'VARCHAR') return /^\d+$/.test(size) && +size > 0 ? String(+size) : null
  if (attr.type === 'DECIMAL') {
    const m = /^(\d+)\s*(?:,\s*(\d+))?$/.exec(size)
    if (!m || +m[1] === 0 || (m[2] !== undefined && +m[2] > +m[1])) return null
    return m[2] !== undefined ? `${+m[1]},${+m[2]}` : String(+m[1])
  }
  return ''
}

export function sqlTypeOf(attr: Pick<Attribute, 'type' | 'size'>): string {
  const size = normalizeSize(attr)
  switch (attr.type) {
    case 'VARCHAR':
      return `VARCHAR(${size || 255})`
    case 'DECIMAL':
      return `DECIMAL(${size || '10,2'})`
    default:
      return attr.type
  }
}

/** Pastilles des contraintes d'une colonne, pour l'affichage (` · UNIQUE · = 0 · CHECK`). */
export function constraintTags(c: Pick<MldColumn, 'unique' | 'defaultValue' | 'check'>): string {
  return [c.unique ? 'UNIQUE' : '', c.defaultValue ? `= ${c.defaultValue}` : '', c.check ? 'CHECK' : '']
    .filter(Boolean)
    .map((t) => ` · ${t}`)
    .join('')
}

const maxIsOne = (c: Cardinality) => c.endsWith('1')
const minIsZero = (c: Cardinality) => c.startsWith('0')

const colNames = (t: MldTable) => t.columns.map((c) => c.name)

/**
 * Ajoute à `host` les colonnes de clé étrangère référençant la clé primaire de `target`.
 * `unique` (association 1–1) : une valeur référencée ne peut apparaître qu'une fois.
 */
function addForeignKey(
  host: MldTable,
  target: MldTable,
  opts: { nullable: boolean; prefix: string; forcePrefix?: boolean; leg?: Link; unique?: boolean },
): string[] {
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
      // clé simple : UNIQUE sur la colonne ; clé composée : contrainte de table (voir `MldForeignKey.unique`)
      ...(opts.unique && target.primaryKey.length === 1 ? { unique: true } : {}),
    })
    created.push(name)
  }
  const leg = opts.leg
  host.foreignKeys.push({
    columns: created,
    refTable: target.name,
    refColumns: [...target.primaryKey],
    ...(leg?.onDelete ? { onDelete: leg.onDelete } : {}),
    ...(leg?.onUpdate ? { onUpdate: leg.onUpdate } : {}),
    ...(leg ? { linkId: leg.id.split('#')[0] } : {}),
    ...(opts.unique ? { unique: true } : {}),
  })
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
      nullable: !isPk && !a.notNull,
      ...(a.unique && !isPk ? { unique: true } : {}),
      ...(a.defaultValue?.trim() ? { defaultValue: a.defaultValue.trim() } : {}),
      ...(a.check?.trim() ? { check: a.check.trim() } : {}),
      dataType: a.type,
    })
    if (isPk) table.primaryKey.push(name)
  }
}

/**
 * Règles Merise MCD → MLD :
 *  - toute entité devient une table dont la clé primaire est son identifiant ;
 *  - association binaire avec une patte de cardinalité max 1 : la clé de l'autre entité migre
 *    en clé étrangère dans la table de l'entité « 1 » (propriétés de l'association incluses) ;
 *  - association binaire 1,1 – 1,1 (ou 0,1) : migration du côté de la patte 1,1, clé étrangère UNIQUE
 *    (sans quoi la relation deviendrait 1–n) ;
 *  - identifiant relatif (CIF, patte 1,1) : la clé du parent migre dans l'entité faible ET entre dans sa
 *    clé primaire (clé composée), avec propagation en chaîne ;
 *  - héritage (« est un ») : voir `resolveInheritance`, appliqué avant les règles ci-dessus ;
 *  - association binaire n–n et associations n-aires : table dédiée (nommée par contraction des tables
 *    reliées), clé primaire composée des
 *    clés étrangères (hors pattes de cardinalité max 1 pour les associations n-aires).
 */
export function meriseToMld(input: MeriseSchema): MldResult {
  const { schema, relationOrigin, warnings } = resolveInheritance(input)
  const tables: MldTable[] = []
  const tableByEntity = new Map<string, MldTable>()
  const entityById = new Map<string, Entity>(schema.entities.map((e) => [e.id, e]))

  const linksOf = (r: Relation): Link[] =>
    schema.links.filter((l) => l.relationId === r.id && entityById.has(l.entityId))

  /** Patte « identifiant relatif » (CIF) d'une association binaire : l'entité de cette patte est faible. */
  const identifyingLeg = (links: Link[]): Link | undefined =>
    links.length === 2 && links[0].entityId !== links[1].entityId
      ? links.find((l) => l.identifying && l.cardinality === '1,1')
      : undefined

  const weak = new Set<string>()
  const weakRelation = new Map<string, string>() // entité faible → association qui l'identifie
  for (const r of schema.relations) {
    const leg = identifyingLeg(linksOf(r))
    if (leg) {
      weak.add(leg.entityId)
      if (!weakRelation.has(leg.entityId)) weakRelation.set(leg.entityId, r.id)
    }
  }

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
    if (!table.primaryKey.length && !weak.has(entity.id)) {
      warnings.push(`L'entité « ${entity.name || '(sans nom)'} » n'a pas d'identifiant : soulignez un attribut comme identifiant.`)
    }
    tables.push(table)
    tableByEntity.set(entity.id, table)
  }

  const prefixOf = (relation: Relation, l: Link) => slug(l.role || relation.name, 'ref')

  // 1) Identifiants relatifs (CIF), du parent vers l'entité faible, avec propagation en chaîne.
  const processed = new Set<string>()
  let pending = schema.relations.filter((r) => identifyingLeg(linksOf(r)))
  for (let progress = true; progress && pending.length; ) {
    progress = false
    for (const relation of [...pending]) {
      const links = linksOf(relation)
      const leg = identifyingLeg(links)!
      const parent = links.find((l) => l !== leg)!
      const parentTable = tableByEntity.get(parent.entityId)!
      // le parent doit avoir sa clé complète (y compris la sienne s'il est lui-même faible)
      if (!parentTable.primaryKey.length) continue
      if (weak.has(parent.entityId) && !processed.has(weakRelation.get(parent.entityId)!)) continue
      const hostTable = tableByEntity.get(leg.entityId)!
      const cols = addForeignKey(hostTable, parentTable, { nullable: false, prefix: prefixOf(relation, parent), leg: parent })
      hostTable.primaryKey = [...cols, ...hostTable.primaryKey]
      addAttributes(hostTable, relation.attributes, false)
      processed.add(relation.id)
      pending = pending.filter((r) => r !== relation)
      progress = true
    }
  }
  for (const r of pending) {
    warnings.push(`L'identifiant relatif de l'association « ${r.name || '(sans nom)'} » est ignoré : l'entité parente n'a pas d'identifiant (ou dépendance circulaire).`)
  }

  // 2) Autres associations
  for (const relation of schema.relations) {
    if (processed.has(relation.id)) continue
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

    const prefixFor = (l: Link) => prefixOf(relation, l)

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
        leg: target,
        unique: maxIsOne(a.cardinality) && maxIsOne(b.cardinality),
      })
      addAttributes(hostTable, relation.attributes, false)
      continue
    }

    // Table d'association
    const table: MldTable = {
      // Table de jointure nommée par contraction des tables reliées (ex. commande_produit), pas par le verbe.
      name: uniqueName(
        relation.tableName?.trim()
          ? slug(relation.tableName, 'association')
          : links.map((l) => tableByEntity.get(l.entityId)!.name).join('_'),
        tables.map((t) => t.name),
      ),
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
        leg: link,
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

  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (fk.onDelete !== 'SET NULL' && fk.onUpdate !== 'SET NULL') continue
      if (fk.columns.every((n) => !t.columns.find((c) => c.name === n)!.nullable)) {
        warnings.push(`ON DELETE / ON UPDATE SET NULL est impossible sur ${t.name}(${fk.columns.join(', ')}) : la clé étrangère est obligatoire (NOT NULL ou dans la clé primaire).`)
      }
    }
  }
  for (const t of tables) if (t.origin === 'association') t.sourceId = relationOrigin.get(t.sourceId) ?? t.sourceId
  return { tables, warnings }
}

const PROPAGATING = new Set(['CASCADE', 'SET NULL', 'SET DEFAULT'])

/**
 * SQL Server refuse de créer une clé étrangère dont les actions référentielles pourraient former un cycle
 * ou atteindre une même table par plusieurs chemins (« may cause cycles or multiple cascade paths »).
 * Propre à ce dialecte : à n'afficher que lorsque SQL Server est la cible.
 */
export function sqlServerCascadeWarnings(tables: MldTable[]): string[] {
  type Edge = { from: string; to: string; fk: MldTable['foreignKeys'][number] }
  const edges: Edge[] = tables.flatMap((t) =>
    t.foreignKeys
      .filter((fk) => PROPAGATING.has(fk.onDelete ?? '') || PROPAGATING.has(fk.onUpdate ?? ''))
      .map((fk) => ({ from: fk.refTable, to: t.name, fk })),
  )
  const flagged = new Map<Edge, string>()
  const label = (e: Edge) => `${e.to}(${e.fk.columns.join(', ')})`
  for (const e of edges) {
    if (e.from === e.to) flagged.set(e, `SQL Server refusera ${label(e)} : une table qui se référence elle-même ne peut pas avoir d'action CASCADE / SET NULL (utilisez RESTRICT ou un déclencheur).`)
  }
  const out = edges.filter((e) => e.from !== e.to)
  for (const start of new Set(out.map((e) => e.from))) {
    const arrivals = new Map<string, number>()
    const walk = (node: string, stack: string[]) => {
      for (const e of out.filter((x) => x.from === node)) {
        if (stack.includes(e.to)) {
          if (!flagged.has(e)) flagged.set(e, `SQL Server refusera ${label(e)} : les actions en cascade forment un cycle (${[...stack, e.to].join(' → ')}).`)
          continue
        }
        const n = (arrivals.get(e.to) ?? 0) + 1
        arrivals.set(e.to, n)
        if (n > 1) {
          if (!flagged.has(e)) flagged.set(e, `SQL Server refusera ${label(e)} : « ${e.to} » est atteinte par plusieurs chemins de cascade depuis « ${start} » (utilisez RESTRICT sur l'un d'eux).`)
          continue // déjà explorée depuis ce départ : la redescendre rendrait le parcours exponentiel
        }
        walk(e.to, [...stack, e.to])
      }
    }
    walk(start, [start])
  }
  return [...flagged.values()]
}

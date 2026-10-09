import {
  CARDINALITIES,
  DATA_TYPES,
  INHERITANCE_STRATEGIES,
  REF_ACTIONS,
  type Attribute,
  type Entity,
  type Link,
  type MeriseSchema,
  type Relation,
} from '../types/schema'

type Raw = Record<string, unknown>

const HANDLES = ['t', 'r', 'b', 'l'] as const

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const coord = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined

/**
 * Valide et normalise un schéma venu de l'extérieur (fichier importé, sauvegarde locale d'une ancienne version) :
 * champs manquants complétés, valeurs inconnues remplacées, identifiants manquants ou en double régénérés,
 * références cassées (pattes, entité mère) retirées. Lève une Error si la structure est inutilisable.
 */
export function sanitizeSchema(raw: unknown, makeId: () => string): MeriseSchema {
  if (!isObject(raw) || !Array.isArray(raw.entities) || !Array.isArray(raw.relations) || !Array.isArray(raw.links)) {
    throw new Error('Fichier invalide : entités, associations ou pattes manquantes.')
  }

  // Un espace d'identifiants par sorte d'objet : nœuds (entités + associations), attributs, pattes.
  const idPool = () => {
    const used = new Set<string>()
    return (v: unknown) => {
      let id = typeof v === 'string' && v && !used.has(v) ? v : makeId()
      while (used.has(id)) id = makeId()
      used.add(id)
      return id
    }
  }
  const nodeId = idPool()
  const attributeId = idPool()
  const linkId = idPool()

  const attributes = (list: unknown): Attribute[] =>
    (Array.isArray(list) ? list : []).filter(isObject).map((a) => {
      const out: Attribute = {
        id: attributeId(a.id),
        name: text(a.name),
        type: oneOf(DATA_TYPES, a.type) ?? 'VARCHAR',
        isPrimaryKey: a.isPrimaryKey === true,
      }
      if (text(a.size)) out.size = text(a.size)
      if (a.notNull === true) out.notNull = true
      if (a.unique === true) out.unique = true
      if (text(a.defaultValue)) out.defaultValue = text(a.defaultValue)
      if (text(a.check)) out.check = text(a.check)
      return out
    })

  const rawEntities = raw.entities.filter(isObject)
  const entities: Entity[] = rawEntities.map((e) => {
    const out: Entity = { id: nodeId(e.id), name: text(e.name), attributes: attributes(e.attributes), x: coord(e.x), y: coord(e.y) }
    const inheritance = oneOf(INHERITANCE_STRATEGIES, e.inheritance)
    if (inheritance) out.inheritance = inheritance
    return out
  })
  const entityIds = new Set(entities.map((e) => e.id))
  rawEntities.forEach((e, i) => {
    const parentId = text(e.parentId)
    if (parentId && parentId !== entities[i].id && entityIds.has(parentId)) entities[i].parentId = parentId
  })

  const relations: Relation[] = raw.relations.filter(isObject).map((r) => {
    const out: Relation = { id: nodeId(r.id), name: text(r.name), attributes: attributes(r.attributes), x: coord(r.x), y: coord(r.y) }
    if (text(r.tableName).trim()) out.tableName = text(r.tableName)
    return out
  })
  const relationIds = new Set(relations.map((r) => r.id))

  const links: Link[] = raw.links
    .filter(isObject)
    .filter((l) => relationIds.has(text(l.relationId)) && entityIds.has(text(l.entityId)))
    .map((l) => {
      const out: Link = {
        id: linkId(l.id),
        relationId: text(l.relationId),
        entityId: text(l.entityId),
        cardinality: oneOf(CARDINALITIES, l.cardinality) ?? '0,n',
      }
      if (text(l.role)) out.role = text(l.role)
      if (l.identifying === true && out.cardinality === '1,1') out.identifying = true
      const onDelete = oneOf(REF_ACTIONS, l.onDelete)
      const onUpdate = oneOf(REF_ACTIONS, l.onUpdate)
      if (onDelete) out.onDelete = onDelete
      if (onUpdate) out.onUpdate = onUpdate
      const relationHandle = oneOf(HANDLES, l.relationHandle)
      const entityHandle = oneOf(HANDLES, l.entityHandle)
      if (relationHandle) out.relationHandle = relationHandle
      if (entityHandle) out.entityHandle = entityHandle
      if (l.curved === true) out.curved = true
      const bend = l.bend
      if (isObject(bend) && Number.isFinite(bend.x) && Number.isFinite(bend.y)) out.bend = { x: Number(bend.x), y: Number(bend.y) }
      return out
    })

  return { entities, relations, links }
}

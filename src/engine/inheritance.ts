import { slug } from './naming'
import type { Attribute, Entity, InheritanceStrategy, Link, MeriseSchema, Relation } from '../types/schema'

export interface FlattenResult {
  schema: MeriseSchema
  /** Identifiant d'une association dupliquée → identifiant de l'association d'origine. */
  relationOrigin: Map<string, string>
  warnings: string[]
}

const slugish = (s: string) => slug(s, 'entite')

/** Racine de la hiérarchie d'une entité (elle-même si elle n'a pas de parent valide). Détecte les cycles. */
export function rootOf(id: string, byId: Map<string, Entity>): string | null {
  const seen = new Set<string>()
  let cur = byId.get(id)
  while (cur?.parentId && byId.has(cur.parentId)) {
    if (seen.has(cur.id)) return null
    seen.add(cur.id)
    cur = byId.get(cur.parentId)
  }
  return cur && !seen.has(cur.id) ? cur.id : null
}

/** Cardinalité dont le minimum est relâché (0) : une patte sur une sous-classe ne concerne qu'une partie des lignes. */
const relax = (c: Link['cardinality']): Link['cardinality'] => (c === '1,1' ? '0,1' : c === '1,n' ? '0,n' : c)

/**
 * Traduit les liens « est un » en un schéma Merise sans héritage, selon la stratégie choisie sur la classe racine :
 *  - `class`    : une table par classe — la fille est identifiée relativement à sa mère (clé primaire = clé étrangère) ;
 *  - `single`   : une seule table — les filles sont absorbées par la racine (colonnes nullables + discriminant) ;
 *  - `concrete` : une table par classe fille — seules les feuilles existent et recopient les attributs hérités.
 */
export function resolveInheritance(input: MeriseSchema): FlattenResult {
  const relationOrigin = new Map<string, string>()
  const warnings: string[] = []
  if (!input.entities.some((e) => e.parentId)) return { schema: input, relationOrigin, warnings }

  const byId = new Map(input.entities.map((e) => [e.id, e]))
  const label = (e: Entity) => `« ${e.name || '(sans nom)'} »`

  // Liens parent valides (parent existant, pas de cycle, pas d'auto-référence).
  const parentOf = new Map<string, string>()
  for (const e of input.entities) {
    if (!e.parentId) continue
    if (!byId.has(e.parentId) || e.parentId === e.id) continue
    if (rootOf(e.id, byId) === null) {
      warnings.push(`L'héritage de ${label(e)} est ignoré : dépendance circulaire.`)
      continue
    }
    parentOf.set(e.id, e.parentId)
  }
  const childrenOf = new Map<string, string[]>()
  for (const [c, p] of parentOf) childrenOf.set(p, [...(childrenOf.get(p) ?? []), c])
  const root = (id: string): string => {
    let cur = id
    while (parentOf.has(cur)) cur = parentOf.get(cur)!
    return cur
  }
  const strategyOf = (id: string): InheritanceStrategy => byId.get(root(id))!.inheritance ?? 'class'
  const descendants = (id: string): string[] =>
    (childrenOf.get(id) ?? []).flatMap((c) => [c, ...descendants(c)])
  const ancestorsFromRoot = (id: string): string[] => {
    const chain = [id]
    while (parentOf.has(chain[0])) chain.unshift(parentOf.get(chain[0])!)
    return chain
  }
  const isLeaf = (id: string) => !childrenOf.has(id)

  /** Attributs de plusieurs classes fusionnés dans une même table ; les doublons de nom sont préfixés par la classe. */
  const merge = (parts: { owner: Entity; attrs: Attribute[] }[]): Attribute[] => {
    const used = new Set<string>()
    const out: Attribute[] = []
    for (const { owner, attrs } of parts) {
      for (const a of attrs) {
        let name = a.name
        if (used.has(name.trim().toLowerCase())) name = `${slugish(owner.name)}_${a.name}`
        used.add(name.trim().toLowerCase())
        out.push({ ...a, name })
      }
    }
    return out
  }
  const withoutPk = (attrs: Attribute[]) => attrs.map((a) => ({ ...a, isPrimaryKey: false }))

  // 1) Entités résultantes et correspondance ancienne entité → entités cibles des pattes.
  const entities: Entity[] = []
  const targets = new Map<string, string[]>()
  const absorbed = new Set<string>() // sous-classes absorbées par la table unique de leur racine
  const extraRelations: Relation[] = []
  const extraLinks: Link[] = []

  for (const e of input.entities) {
    const parent = parentOf.get(e.id)
    const hierarchical = parent !== undefined || childrenOf.has(e.id)
    if (!hierarchical) {
      entities.push(e)
      continue
    }
    const strategy = strategyOf(e.id)
    const rootId = root(e.id)

    if (strategy === 'single') {
      targets.set(e.id, [rootId])
      if (e.id !== rootId) {
        absorbed.add(e.id)
        continue
      }
      const parts = [
        { owner: e, attrs: e.attributes },
        {
          owner: e,
          attrs: [{ id: `${e.id}:type`, name: `type_${slugish(e.name)}`, type: 'VARCHAR', size: '50', isPrimaryKey: false } as Attribute],
        },
        ...descendants(e.id).map((d) => ({ owner: byId.get(d)!, attrs: withoutPk(byId.get(d)!.attributes).map((a) => ({ ...a, notNull: false })) })),
      ]
      entities.push({ ...e, attributes: merge(parts), parentId: undefined })
    } else if (strategy === 'concrete') {
      if (!isLeaf(e.id)) {
        targets.set(e.id, descendants(e.id).filter(isLeaf))
        continue
      }
      targets.set(e.id, [e.id])
      const chain = ancestorsFromRoot(e.id).map((id) => byId.get(id)!)
      const parts = chain.map((owner, i) => ({ owner, attrs: i === 0 ? owner.attributes : withoutPk(owner.attributes) }))
      entities.push({ ...e, attributes: merge(parts), parentId: undefined })
    } else {
      targets.set(e.id, [e.id])
      if (!parent) {
        entities.push(e)
        continue
      }
      entities.push({ ...e, attributes: withoutPk(e.attributes), parentId: undefined })
      // Association « est un » : la fille est identifiée relativement à sa mère (clé primaire héritée).
      const rid = `isa:${e.id}`
      extraRelations.push({ id: rid, name: `est_un_${slugish(e.name)}`, attributes: [], x: 0, y: 0 })
      extraLinks.push(
        { id: `${rid}:c`, relationId: rid, entityId: e.id, cardinality: '1,1', identifying: true },
        { id: `${rid}:p`, relationId: rid, entityId: parent, cardinality: '0,1', onDelete: 'CASCADE' },
      )
    }
  }

  // 2) Pattes redirigées ; une association touchant une classe mère « concrète » est dupliquée pour chaque fille.
  const relations: Relation[] = []
  const links: Link[] = []
  for (const r of input.relations) {
    const legs = input.links.filter((l) => l.relationId === r.id)
    const options = legs.map((l) => {
      const t = targets.get(l.entityId)
      if (!t) return [l]
      return t.map((entityId) => ({ ...l, entityId, cardinality: absorbed.has(l.entityId) ? relax(l.cardinality) : l.cardinality }))
    })
    let combos: Link[][] = [[]]
    for (const opts of options) combos = combos.flatMap((c) => opts.map((o) => [...c, o]))
    combos.forEach((combo, i) => {
      const id = i === 0 ? r.id : `${r.id}#${i + 1}`
      if (i > 0) relationOrigin.set(id, r.id)
      relations.push(i === 0 ? r : { ...r, id })
      links.push(...combo.map((l) => ({ ...l, id: i === 0 ? l.id : `${l.id}#${i + 1}`, relationId: id })))
    })
  }

  return {
    schema: {
      entities,
      relations: [...relations, ...extraRelations],
      links: [...links, ...extraLinks],
    },
    relationOrigin,
    warnings,
  }
}

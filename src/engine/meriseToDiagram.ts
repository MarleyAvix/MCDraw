import { sqlTypeOf } from './meriseToMld'
import type { Attribute, Cardinality, MeriseSchema } from '../types/schema'

export type DiagramStyle = 'erd' | 'uml'

export interface DiagramAttribute {
  id: string
  name: string
  /** Type SQL complet, ex : VARCHAR(255). */
  type: string
  isPrimaryKey: boolean
}

export interface DiagramNode {
  id: string
  /**
   * `entity` : entité / classe ; `box` : association réifiée (entité associative ERD, classe d'association UML) ;
   * `diamond` : losange d'une association n-aire UML sans propriété.
   */
  kind: 'entity' | 'box' | 'diamond'
  name: string
  attributes: DiagramAttribute[]
  /** Entité faible (identifiant relatif). */
  weak?: boolean
}

export type EdgeVariant = 'association' | 'leg' | 'inheritance' | 'classLink'

export interface DiagramEdge {
  id: string
  variant: EdgeVariant
  source: string
  target: string
  /** Nom de l'association (au milieu du trait). */
  label?: string
  /** Cardinalité à dessiner à chaque extrémité (absente : rien). */
  sourceEnd?: Cardinality
  targetEnd?: Cardinality
  sourceRole?: string
  targetRole?: string
  /** Rang du trait parmi ceux qui relient la même paire (pour les écarter). */
  index: number
  count: number
  /** `classLink` : les deux entités de l'association à laquelle la classe d'association est accrochée. */
  anchor?: [string, string]
}

export interface Diagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

export const minOf = (c: Cardinality): '0' | '1' => (c[0] === '0' ? '0' : '1')
export const maxOf = (c: Cardinality): '1' | 'n' => (c[2] === 'n' ? 'n' : '1')

/** Multiplicité UML : `0..1`, `1`, `0..*`, `1..*`. */
export function umlMultiplicity(c: Cardinality): string {
  const many = maxOf(c) === 'n'
  if (minOf(c) === '1') return many ? '1..*' : '1'
  return many ? '0..*' : '0..1'
}

/**
 * Vue dérivée du MCD, en notation « pattes de corbeau » (`erd`) ou en diagramme de classes (`uml`).
 *
 * Sur une association binaire, le symbole à l'extrémité d'une entité traduit la cardinalité de la patte
 * *opposée* : un `1,n` côté Commande se lit « un client a de 1 à n commandes », donc le pied de corbeau
 * est dessiné du côté de Commande, à l'extrémité du trait.
 *
 *  - ERD : une association binaire sans propriété devient un trait étiqueté ; sinon (propriétés, ou plus de
 *    deux pattes) elle est réifiée en entité associative reliée à chaque entité (`1,1` côté entité,
 *    cardinalité de la patte côté association).
 *  - UML : une association binaire devient un trait ; ses propriétés forment une classe d'association
 *    accrochée en pointillés. Une association n-aire est un losange (ou une classe si elle a des propriétés)
 *    dont chaque patte porte sa multiplicité.
 *  - L'héritage (« est un ») devient une flèche à pointe creuse de la fille vers la mère.
 */
export function meriseToDiagram(schema: MeriseSchema, style: DiagramStyle): Diagram {
  const nodes: DiagramNode[] = []
  const edges: DiagramEdge[] = []
  const entityIds = new Set(schema.entities.map((e) => e.id))
  const weak = new Set(schema.links.filter((l) => l.identifying && l.cardinality === '1,1').map((l) => l.entityId))
  const attrsOf = (list: Attribute[]): DiagramAttribute[] =>
    list.map((a) => ({ id: a.id, name: a.name, type: sqlTypeOf(a), isPrimaryKey: a.isPrimaryKey }))

  for (const e of schema.entities) {
    nodes.push({ id: e.id, kind: 'entity', name: e.name, attributes: attrsOf(e.attributes), ...(weak.has(e.id) ? { weak: true } : {}) })
  }

  for (const e of schema.entities) {
    if (e.parentId && e.parentId !== e.id && entityIds.has(e.parentId)) {
      edges.push({ id: `isa:${e.id}`, variant: 'inheritance', source: e.id, target: e.parentId, index: 0, count: 1 })
    }
  }

  for (const r of schema.relations) {
    const links = schema.links.filter((l) => l.relationId === r.id && entityIds.has(l.entityId))
    if (links.length < 2) continue // association incomplète : rien à dessiner (signalée dans le MCD)
    const hasAttrs = r.attributes.length > 0
    const binary = links.length === 2

    if (binary && (style === 'uml' || !hasAttrs)) {
      const [a, b] = links
      edges.push({
        id: `rel:${r.id}`,
        variant: 'association',
        source: a.entityId,
        target: b.entityId,
        label: r.name,
        sourceEnd: b.cardinality,
        targetEnd: a.cardinality,
        sourceRole: a.role,
        targetRole: b.role,
        index: 0,
        count: 1,
        // une classe d'association se raccroche au milieu de ce trait
        ...(hasAttrs ? { anchor: [a.entityId, b.entityId] as [string, string] } : {}),
      })
      if (hasAttrs) {
        nodes.push({ id: r.id, kind: 'box', name: r.name, attributes: attrsOf(r.attributes) })
        edges.push({
          id: `cls:${r.id}`,
          variant: 'classLink',
          source: r.id,
          target: a.entityId,
          index: 0,
          count: 1,
          anchor: [a.entityId, b.entityId],
        })
      }
      continue
    }

    // n-aire, ou ERD avec propriétés : l'association devient un nœud relié à chaque entité
    nodes.push({
      id: r.id,
      kind: style === 'uml' && !hasAttrs ? 'diamond' : 'box',
      name: r.name,
      attributes: attrsOf(r.attributes),
    })
    links.forEach((l, i) => {
      edges.push({
        id: `leg:${r.id}:${i}`,
        variant: 'leg',
        source: l.entityId,
        target: r.id,
        ...(style === 'erd' ? { sourceEnd: '1,1' as Cardinality, targetEnd: l.cardinality } : { sourceEnd: l.cardinality }),
        sourceRole: l.role,
        index: 0,
        count: 1,
      })
    })
  }

  // Écarte les traits qui relient la même paire de nœuds (plusieurs associations entre deux entités, boucles).
  const groups = new Map<string, DiagramEdge[]>()
  for (const e of edges) {
    if (e.variant === 'inheritance') continue
    const key = [e.source, e.target].sort().join('|')
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  for (const group of groups.values()) {
    group.forEach((e, i) => {
      e.index = i
      e.count = group.length
    })
  }
  // La classe d'association suit le rang du trait auquel elle est accrochée.
  for (const e of edges) {
    if (e.variant !== 'classLink') continue
    const host = edges.find((x) => x.id === `rel:${e.id.slice(4)}`)
    if (host) {
      e.index = host.index
      e.count = host.count
    }
  }

  return { nodes, edges }
}

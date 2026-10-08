import type { Entity, MeriseSchema } from '../types/schema'

export type LintRule = 'no-pk' | 'same-pk-name' | 'lonely-relation' | 'cyclic-mandatory'

export interface LintIssue {
  id: string
  rule: LintRule
  severity: 'warning' | 'info'
  message: string
  /** Nœuds concernés (entités / associations), le premier sert de cible au clic. */
  nodeIds: string[]
}

const label = (n: { name: string }) => `« ${n.name.trim() || '(sans nom)'} »`
const list = (ns: { name: string }[]) => ns.map(label).join(', ')

/** Audit de conception du MCD : règles de modélisation qui ne bloquent pas l'export mais annoncent un MLD douteux. */
export function lintSchema(schema: MeriseSchema): LintIssue[] {
  const out: LintIssue[] = []
  const entityById = new Map(schema.entities.map((e) => [e.id, e]))
  const legsOf = (relationId: string) => schema.links.filter((l) => l.relationId === relationId && entityById.has(l.entityId))
  const weak = new Set(schema.links.filter((l) => l.identifying && l.cardinality === '1,1').map((l) => l.entityId))

  // 1) Entité sans clé primaire (une classe fille hérite de celle de sa mère, une entité faible de celle de son parent).
  for (const e of schema.entities) {
    const inherited = !!e.parentId && entityById.has(e.parentId)
    if (!e.attributes.some((a) => a.isPrimaryKey) && !inherited && !weak.has(e.id)) {
      out.push({
        id: `no-pk:${e.id}`,
        rule: 'no-pk',
        severity: 'warning',
        message: `L'entité ${label(e)} n'a pas d'identifiant : soulignez un attribut, sinon aucune table ne pourra être référencée.`,
        nodeIds: [e.id],
      })
    }
  }

  // 2) Identifiants de même nom dans des entités sans lien : colonnes ambiguës dans le MLD.
  const ancestors = (e: Entity) => {
    const chain = new Set<string>()
    for (let p = e.parentId ? entityById.get(e.parentId) : undefined; p && !chain.has(p.id); p = p.parentId ? entityById.get(p.parentId) : undefined) chain.add(p.id)
    return chain
  }
  const neighbours = new Map<string, Set<string>>(schema.entities.map((e) => [e.id, new Set(ancestors(e))]))
  for (const e of schema.entities) for (const a of neighbours.get(e.id)!) neighbours.get(a)?.add(e.id)
  for (const r of schema.relations) {
    const ids = legsOf(r.id).map((l) => l.entityId)
    for (const a of ids) for (const b of ids) if (a !== b) neighbours.get(a)!.add(b)
  }
  const byPkName = new Map<string, Entity[]>()
  for (const e of schema.entities) {
    for (const name of new Set(e.attributes.filter((a) => a.isPrimaryKey && a.name.trim()).map((a) => a.name.trim().toLowerCase()))) {
      byPkName.set(name, [...(byPkName.get(name) ?? []), e])
    }
  }
  for (const [name, group] of byPkName) {
    const apart = group.filter((e) => group.some((o) => o !== e && !neighbours.get(e.id)!.has(o.id)))
    if (apart.length < 2) continue
    out.push({
      id: `same-pk-name:${name}`,
      rule: 'same-pk-name',
      severity: 'info',
      message: `Les entités ${list(apart)} ont chacune un identifiant « ${name} » sans être reliées : préférez un nom propre à chaque entité.`,
      nodeIds: apart.map((e) => e.id),
    })
  }

  // 3) Association orpheline, ou ne reliant qu'une seule entité sans réflexivité explicite (un rôle distinct par patte).
  for (const r of schema.relations) {
    const legs = legsOf(r.id)
    const distinct = new Set(legs.map((l) => l.entityId))
    let message = ''
    if (!legs.length) message = `L'association ${label(r)} n'est reliée à aucune entité.`
    else if (legs.length === 1) message = `L'association ${label(r)} ne relie qu'une seule entité : ajoutez une seconde patte.`
    else if (distinct.size === 1) {
      const roles = legs.map((l) => (l.role ?? '').trim().toLowerCase())
      if (roles.some((x) => !x) || new Set(roles).size < roles.length) {
        message = `L'association ${label(r)} relie ${label(entityById.get(legs[0].entityId)!)} à elle-même : donnez un rôle distinct à chaque patte pour qu'elle soit explicitement réflexive.`
      }
    }
    if (message) out.push({ id: `lonely-relation:${r.id}`, rule: 'lonely-relation', severity: 'warning', message, nodeIds: [r.id] })
  }

  // 4) Dépendances cycliques obligatoires : une patte (1,1) impose l'existence de l'autre entité ;
  //    un cycle de telles dépendances (dont (1,1) — (1,1)) interdit d'insérer la première ligne.
  const needs = new Map<string, Set<string>>(schema.entities.map((e) => [e.id, new Set()]))
  const via = new Map<string, string[]>() // « a>b » → associations responsables
  for (const r of schema.relations) {
    const legs = legsOf(r.id)
    if (legs.length !== 2) continue
    for (const [mine, other] of [[legs[0], legs[1]], [legs[1], legs[0]]] as const) {
      if (mine.cardinality !== '1,1') continue
      needs.get(mine.entityId)!.add(other.entityId)
      const k = `${mine.entityId}>${other.entityId}`
      via.set(k, [...(via.get(k) ?? []), r.id])
    }
  }
  // Composantes fortement connexes (Tarjan) : tout groupe de plus d'une entité, ou une entité qui se requiert elle-même, est un cycle.
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  let counter = 0
  const visit = (v: string) => {
    index.set(v, counter)
    low.set(v, counter++)
    stack.push(v)
    onStack.add(v)
    for (const w of needs.get(v)!) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
    if (low.get(v) !== index.get(v)) return
    const comp: string[] = []
    let w: string
    do {
      w = stack.pop()!
      onStack.delete(w)
      comp.push(w)
    } while (w !== v)
    if (comp.length > 1 || needs.get(v)!.has(v)) {
      const members = comp.map((id) => entityById.get(id)!)
      const rels = [...new Set(comp.flatMap((a) => comp.flatMap((b) => via.get(`${a}>${b}`) ?? [])))]
      out.push({
        id: `cyclic-mandatory:${[...comp].sort().join('+')}`,
        rule: 'cyclic-mandatory',
        severity: 'warning',
        message: `Dépendance cyclique obligatoire (1,1) entre ${list(members)} : chacune exige l'existence de l'autre, aucune ligne ne peut être insérée la première. Passez une patte en (0,1) ou (0,n).`,
        nodeIds: [...comp, ...rels],
      })
    }
  }
  for (const e of schema.entities) if (!index.has(e.id)) visit(e.id)

  return out
}

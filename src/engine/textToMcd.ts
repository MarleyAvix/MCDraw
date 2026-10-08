import dagre from '@dagrejs/dagre'
import { DATA_TYPES, type Attribute, type Cardinality, type DataType, type Entity, type Link, type MeriseSchema, type Relation } from '../types/schema'

/**
 * Saisie textuelle du MCD, une ligne par entité ou association (syntaxe proche de Mocodo) :
 *
 *   Client: #id_client, nom, email                      entité ; « # » marque l'identifiant (sinon : le premier attribut)
 *   Produit: #ref:VARCHAR(13), prix:DECIMAL(8,2)         type et taille après « : » (défaut : INT pour l'identifiant, VARCHAR sinon)
 *   Etudiant < Personne: numero                          « est un » : héritage, l'identifiant vient de la classe mère
 *   Passer: Client 0,n -- Commande 1,1                   association : entité, cardinalité, [rôle], séparées par « -- »
 *   Contenir (quantite:INT): Commande 1,n -- Produit 0,n propriétés de l'association entre parenthèses
 *   Diriger: Employe 0,n chef -- Employe 0,1 subordonne  rôle d'une patte (association réflexive)
 *   Ligne: Commande 1,1 CIF -- Produit 0,n               CIF : identifiant relatif (patte 1,1)
 *
 * Cardinalités : 0,1  1,1  0,n  1,n (aussi 0N, 0..n, 1*…). Commentaires : « // » ou « % ».
 */

export interface ParseError {
  line: number
  message: string
}

export interface ParseResult {
  schema: MeriseSchema
  errors: ParseError[]
}

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u
const LEG = /^(\S+)\s+([01])\s*(?:,|\.\.)?\s*([1nN*])(?:\s+(.+))?$/
const ATTR = /^([#*]?)\s*([^\s:#*]+)\s*(?::\s*([A-Za-z]+)\s*(?:\(\s*(\d+(?:\s*,\s*\d+)?)\s*\))?)?$/

/** Découpe sur `sep` en ignorant ce qui est entre parenthèses (DECIMAL(10,2)). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

interface Head {
  name: string
  parent?: string
  attrs?: string
  body: string
}

function splitHead(src: string): Head | null {
  const m = /^([^\s:()<]+)\s*(?:<\s*([^\s:()<]+)\s*)?/.exec(src)
  if (!m) return null
  let rest = src.slice(m[0].length).trimStart()
  let attrs: string | undefined
  if (rest.startsWith('(')) {
    let depth = 0
    let end = -1
    for (let i = 0; i < rest.length && end < 0; i++) {
      if (rest[i] === '(') depth++
      else if (rest[i] === ')' && --depth === 0) end = i
    }
    if (end < 0) return null
    attrs = rest.slice(1, end)
    rest = rest.slice(end + 1).trimStart()
  }
  if (!rest.startsWith(':')) return null
  return { name: m[1], parent: m[2], attrs, body: rest.slice(1).trim() }
}

export function parseMcdText(text: string, makeId: () => string): ParseResult {
  const errors: ParseError[] = []
  const err = (line: number, message: string) => errors.push({ line, message })
  const entities: Entity[] = []
  const relations: Relation[] = []
  const links: Link[] = []
  const byName = new Map<string, Entity>()
  const parents: { entity: Entity; parent: string; line: number }[] = []
  const pending: { head: Head; line: number }[] = []

  /** Attributs d'une liste « a, #b:INT, c:VARCHAR(50) » ; `untyped` reçoit ceux dont le type est à déduire. */
  const parseAttrs = (src: string, line: number, isEntity: boolean, untyped = new Set<Attribute>()): Attribute[] => {
    const out: Attribute[] = []
    for (const token of splitTop(src, ',')) {
      const m = ATTR.exec(token)
      if (!m || !IDENT.test(m[2])) {
        err(line, `Attribut invalide : « ${token} » (nom sans espace, éventuellement suivi de :TYPE).`)
        continue
      }
      if (m[1] && !isEntity) err(line, `« ${m[2]} » : une association n'a pas d'identifiant, retirez le « ${m[1]} ».`)
      let type: DataType | undefined
      if (m[3]) {
        type = DATA_TYPES.find((t) => t === m[3].toUpperCase())
        if (!type) {
          err(line, `Type inconnu « ${m[3]} » pour ${m[2]} (${DATA_TYPES.join(', ')}).`)
          continue
        }
      }
      const attr: Attribute = { id: makeId(), name: m[2], type: type ?? 'VARCHAR', isPrimaryKey: !!m[1] && isEntity }
      if (m[4]) attr.size = m[4].replace(/\s+/g, '')
      if (!type) untyped.add(attr)
      out.push(attr)
    }
    return out
  }

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const src = raw.replace(/\/\/.*$/, '').trim()
    if (!src || src.startsWith('%')) return
    const head = splitHead(src)
    if (!head) return err(line, `Ligne illisible : attendu « Nom: attributs » ou « Nom: Entité 0,n -- Entité 1,1 ».`)
    if (head.body.includes('--')) pending.push({ head, line })
    else {
      if (head.attrs !== undefined) return err(line, 'Les parenthèses d’attributs ne s’emploient que pour une association (avec « -- »).')
      if (byName.has(key(head.name))) return err(line, `Entité « ${head.name} » déjà déclarée.`)
      const untyped = new Set<Attribute>()
      const attributes = parseAttrs(head.body, line, true, untyped)
      if (!head.parent && attributes.length && !attributes.some((a) => a.isPrimaryKey)) attributes[0].isPrimaryKey = true
      // Type omis : INT pour un identifiant, VARCHAR sinon.
      for (const a of attributes) if (untyped.has(a) && a.isPrimaryKey) a.type = 'INT'
      const entity: Entity = { id: makeId(), name: head.name, attributes, x: 0, y: 0 }
      entities.push(entity)
      byName.set(key(head.name), entity)
      if (head.parent) parents.push({ entity, parent: head.parent, line })
    }
  })

  for (const { entity, parent, line } of parents) {
    const p = byName.get(key(parent))
    if (!p) err(line, `Classe mère inconnue : « ${parent} ».`)
    else if (p === entity) err(line, `« ${parent} » ne peut pas hériter d'elle-même.`)
    else entity.parentId = p.id
  }

  // Associations : lues après les entités pour qu'elles puissent être déclarées dans n'importe quel ordre.
  for (const { head, line } of pending) {
    if (head.parent) {
      err(line, 'Une association ne peut pas utiliser « < » (héritage réservé aux entités).')
      continue
    }
    const legSrc = head.body.split(/\s*--\s*/).map((s) => s.trim()).filter(Boolean)
    const relation: Relation = { id: makeId(), name: head.name, attributes: [], x: 0, y: 0 }
    const legs: Link[] = []
    let ok = true
    for (const part of legSrc) {
      const m = LEG.exec(part)
      if (!m) {
        err(line, `Patte invalide : « ${part} » (attendu : Entité 0,n [rôle]).`)
        ok = false
        continue
      }
      const entity = byName.get(key(m[1]))
      if (!entity) {
        err(line, `Entité inconnue « ${m[1]} » dans l'association « ${head.name} ».`)
        ok = false
        continue
      }
      const cardinality = `${m[2]},${m[3] === '1' ? '1' : 'n'}` as Cardinality
      const link: Link = { id: makeId(), relationId: relation.id, entityId: entity.id, cardinality }
      for (const word of (m[4] ?? '').split(/\s+/).filter(Boolean)) {
        if (/^\(?CIF\)?$/i.test(word)) {
          if (cardinality === '1,1') link.identifying = true
          else err(line, `CIF (identifiant relatif) exige une patte 1,1, pas ${cardinality}.`)
        } else link.role = link.role ? `${link.role} ${word}` : word
      }
      legs.push(link)
    }
    if (ok && legs.length < 2) {
      err(line, `L'association « ${head.name} » doit relier au moins deux pattes.`)
      ok = false
    }
    if (head.attrs) relation.attributes = parseAttrs(head.attrs, line, false)
    if (!ok) continue
    relations.push(relation)
    links.push(...legs)
  }

  errors.sort((x, y) => x.line - y.line)
  return { schema: { entities, relations, links }, errors }
}

// --- Mise en page --------------------------------------------------------

const sideToward = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'r' : 'l') : dy >= 0 ? 'b' : 't'
}

const sizeOfEntity = (e: Entity) => ({ w: 200, h: 73 + 24 * Math.max(e.attributes.length, 1) })
const sizeOfRelation = (r: Relation) => ({ w: 130, h: 90 + 12 * r.attributes.length })

/** Dispose les nœuds avec dagre (entité → association → entité sur des rangs successifs), orientation au plus proche d'un écran 16:10. */
export function layoutMcd(schema: MeriseSchema, origin = { x: 0, y: 0 }): MeriseSchema {
  const size = new Map<string, { w: number; h: number }>([
    ...schema.entities.map((e) => [e.id, sizeOfEntity(e)] as const),
    ...schema.relations.map((r) => [r.id, sizeOfRelation(r)] as const),
  ])
  const run = (rankdir: 'LR' | 'TB') => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir, nodesep: 60, ranksep: 90, marginx: 20, marginy: 20 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const [id, s] of size) g.setNode(id, { width: s.w, height: s.h })
    for (const r of schema.relations) {
      schema.links.filter((l) => l.relationId === r.id).forEach((l, i) => (i === 0 ? g.setEdge(l.entityId, r.id) : g.setEdge(r.id, l.entityId)))
    }
    for (const e of schema.entities) if (e.parentId && size.has(e.parentId)) g.setEdge(e.parentId, e.id)
    dagre.layout(g)
    const { width = 1, height = 1 } = g.graph()
    return { g, ratio: width / height }
  }
  const lr = run('LR')
  const tb = run('TB')
  const target = 1.6
  const best = Math.abs(Math.log(tb.ratio / target)) < Math.abs(Math.log(lr.ratio / target)) ? tb : lr

  const pos = (id: string) => {
    const p = best.g.node(id)
    const s = size.get(id)!
    return { x: origin.x + p.x - s.w / 2, y: origin.y + p.y - s.h / 2 }
  }
  const entities = schema.entities.map((e) => ({ ...e, ...pos(e.id) }))
  const relations = schema.relations.map((r) => ({ ...r, ...pos(r.id) }))
  const center = new Map([...entities, ...relations].map((n) => [n.id, { x: n.x + size.get(n.id)!.w / 2, y: n.y + size.get(n.id)!.h / 2 }]))
  const links = schema.links.map((l) => {
    const e = center.get(l.entityId)!
    const r = center.get(l.relationId)!
    return { ...l, entityHandle: sideToward(e, r), relationHandle: sideToward(r, e) }
  })
  return { entities, relations, links }
}

// --- MCD → texte ---------------------------------------------------------

const word = (s: string) => s.trim().replace(/\s+/g, '_') || 'sans_nom'

/** Écrit le MCD dans la syntaxe de saisie (point de départ pour modifier un schéma existant au clavier). */
export function mcdToText(schema: MeriseSchema): string {
  const byId = new Map(schema.entities.map((e) => [e.id, e]))
  const attr = (a: Attribute, isEntity: boolean) => {
    const def: DataType = a.isPrimaryKey ? 'INT' : 'VARCHAR'
    const type = a.type !== def || a.size ? `:${a.type}${a.size ? `(${a.size})` : ''}` : ''
    return `${isEntity && a.isPrimaryKey ? '#' : ''}${word(a.name)}${type}`
  }
  const lines: string[] = []
  for (const e of schema.entities) {
    const parent = e.parentId ? byId.get(e.parentId) : undefined
    lines.push(`${word(e.name)}${parent ? ` < ${word(parent.name)}` : ''}: ${e.attributes.map((a) => attr(a, true)).join(', ')}`)
  }
  if (schema.entities.length && schema.relations.length) lines.push('')
  for (const r of schema.relations) {
    const legs = schema.links.filter((l) => l.relationId === r.id && byId.has(l.entityId))
    if (legs.length < 2) {
      lines.push(`// Association « ${r.name} » ignorée : moins de deux pattes.`)
      continue
    }
    const props = r.attributes.length ? ` (${r.attributes.map((a) => attr(a, false)).join(', ')})` : ''
    const parts = legs.map((l) => `${word(byId.get(l.entityId)!.name)} ${l.cardinality}${l.role ? ` ${word(l.role)}` : ''}${l.identifying ? ' CIF' : ''}`)
    lines.push(`${word(r.name)}${props}: ${parts.join(' -- ')}`)
  }
  return lines.join('\n') + (lines.length ? '\n' : '')
}

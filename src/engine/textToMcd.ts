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
  const declared: { entity: Entity; untyped: Set<Attribute>; child: boolean }[] = []

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
      const entity: Entity = { id: makeId(), name: head.name, attributes, x: 0, y: 0 }
      entities.push(entity)
      byName.set(key(head.name), entity)
      declared.push({ entity, untyped, child: !!head.parent })
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

  // Identifiant implicite (le premier attribut), sauf pour une classe fille (il est hérité) et pour une entité faible
  // qui n'a que l'identifiant de son parent : « Détail: quantite:INT » identifiée par « … -- Détail 1,1 CIF ».
  const weak = new Set(links.filter((l) => l.identifying).map((l) => l.entityId))
  for (const { entity, untyped, child } of declared) {
    const attrs = entity.attributes
    if (!child && !weak.has(entity.id) && attrs.length && !attrs.some((a) => a.isPrimaryKey)) attrs[0].isPrimaryKey = true
    // Type omis : INT pour un identifiant, VARCHAR sinon.
    for (const a of attrs) if (untyped.has(a) && a.isPrimaryKey) a.type = 'INT'
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

const sizeOfEntity = (e: { attributes: unknown[] }) => ({ w: 200, h: 73 + 24 * Math.max(e.attributes.length, 1) })
const sizeOfRelation = (r: { attributes: unknown[] }) => ({ w: 130, h: 90 + 12 * r.attributes.length })

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

/** Nom réduit à un mot que l'analyseur sait relire (lettres, chiffres, « _ ») ; `mergeMcd` retrouve le nom d'origine. */
const word = (s: string) => {
  const w = s.trim().replace(/[^\p{L}\p{N}_]+/gu, '_')
  return !w ? 'sans_nom' : /^\p{N}/u.test(w) ? `_${w}` : w
}

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

// --- Texte appliqué au MCD existant -----------------------------------------

/**
 * Applique au MCD existant un schéma relu depuis le texte (bouton « Générer »). Un élément retrouvé sous le même nom
 * garde son identifiant, sa position et ce que la syntaxe texte ne décrit pas : contraintes de colonne (NOT NULL,
 * UNIQUE, défaut, CHECK), stratégie d'héritage, nom de table, actions ON DELETE / ON UPDATE, points d'accroche.
 * Les nouveaux éléments sont placés à droite de l'existant ; une nouvelle association entre entités existantes, entre elles.
 */
export function mergeMcd(previous: MeriseSchema, parsed: MeriseSchema): MeriseSchema {
  const norm = (s: string) => key(word(s))
  /** Appariement par nom normalisé ; des homonymes sont appariés dans l'ordre. */
  const matcher = <T>(items: T[], name: (x: T) => string) => {
    const queues = new Map<string, T[]>()
    for (const x of items) queues.set(name(x), [...(queues.get(name(x)) ?? []), x])
    return (n: string) => queues.get(n)?.shift()
  }
  /** Le texte n'écrit que des mots : un nom inchangé une fois réduit à un mot garde sa forme d'origine (espaces, tirets…). */
  const keepName = (old: string, fresh: string) => (word(old) === fresh ? old : fresh)
  const mergeAttrs = (olds: Attribute[], fresh: Attribute[]): Attribute[] => {
    const take = matcher(olds, (a) => norm(a.name))
    return fresh.map((a) => {
      const o = take(norm(a.name))
      if (!o) return { ...a }
      const out: Attribute = { ...o, name: keepName(o.name, a.name), type: a.type, isPrimaryKey: a.isPrimaryKey }
      if (a.size) out.size = a.size
      else delete out.size
      return out
    })
  }

  const finalId = new Map<string, string>() // identifiant lu dans le texte → identifiant retenu
  const idOf = (id: string) => finalId.get(id) ?? id
  const kept = new Set<string>() // nœuds existants retrouvés : ils gardent leur position

  const takeEntity = matcher(previous.entities, (e) => norm(e.name))
  const entities: Entity[] = parsed.entities.map((e) => {
    const o = takeEntity(norm(e.name))
    if (!o) return { ...e }
    finalId.set(e.id, o.id)
    kept.add(o.id)
    return { ...o, name: keepName(o.name, e.name), attributes: mergeAttrs(o.attributes, e.attributes) }
  })
  // La hiérarchie « est un » vient du texte.
  parsed.entities.forEach((e, i) => {
    if (e.parentId) entities[i].parentId = idOf(e.parentId)
    else delete entities[i].parentId
  })

  const takeRelation = matcher(previous.relations, (r) => norm(r.name))
  const relations: Relation[] = parsed.relations.map((r) => {
    const o = takeRelation(norm(r.name))
    if (!o) return { ...r }
    finalId.set(r.id, o.id)
    kept.add(o.id)
    return { ...o, name: keepName(o.name, r.name), attributes: mergeAttrs(o.attributes, r.attributes) }
  })

  // Une patte est retrouvée par son association, son entité et son rôle.
  const oldName = new Map([...previous.entities, ...previous.relations].map((n) => [n.id, n.name]))
  const newName = new Map([...parsed.entities, ...parsed.relations].map((n) => [n.id, n.name]))
  const legKey = (names: Map<string, string>, l: Link) =>
    [names.get(l.relationId) ?? '', names.get(l.entityId) ?? '', l.role ?? ''].map(norm).join('|')
  const takeLink = matcher(previous.links, (l) => legKey(oldName, l))
  const added = new Set<Link>()
  const links: Link[] = parsed.links.map((l) => {
    const out: Link = { ...l, relationId: idOf(l.relationId), entityId: idOf(l.entityId) }
    const o = takeLink(legKey(newName, l))
    if (!o) {
      added.add(out)
      return out
    }
    out.id = o.id
    if (o.role && l.role) out.role = keepName(o.role, l.role)
    if (o.onDelete) out.onDelete = o.onDelete
    if (o.onUpdate) out.onUpdate = o.onUpdate
    if (o.relationHandle) out.relationHandle = o.relationHandle
    if (o.entityHandle) out.entityHandle = o.entityHandle
    return out
  })

  if (!kept.size) return layoutMcd({ entities, relations, links }) // rien en commun : nouvelle mise en page

  const relIds = new Set(relations.map((r) => r.id))
  const sizeOf = (n: Entity | Relation) => (relIds.has(n.id) ? sizeOfRelation(n) : sizeOfEntity(n))
  const center = (n: Entity | Relation) => ({ x: n.x + sizeOf(n).w / 2, y: n.y + sizeOf(n).h / 2 })
  const byId = new Map<string, Entity | Relation>([...entities, ...relations].map((n) => [n.id, n]))
  const placed = new Set(kept)

  // Nouvelle association entre entités existantes : au milieu d'elles (à droite de l'entité pour une réflexive).
  for (const r of relations) {
    if (placed.has(r.id)) continue
    const ends = [...new Set(links.filter((l) => l.relationId === r.id).map((l) => l.entityId))]
    if (!ends.length || !ends.every((id) => kept.has(id))) continue
    const cs = ends.map((id) => center(byId.get(id)!))
    const c = { x: cs.reduce((s, p) => s + p.x, 0) / cs.length, y: cs.reduce((s, p) => s + p.y, 0) / cs.length }
    if (ends.length === 1) c.x += sizeOf(byId.get(ends[0])!).w / 2 + 120
    r.x = c.x - sizeOf(r).w / 2
    r.y = c.y - sizeOf(r).h / 2
    placed.add(r.id)
  }

  // Autres nouveautés : mise en page d'ensemble, décalée à droite des éléments existants.
  const rest = [...entities, ...relations].filter((n) => !placed.has(n.id))
  if (rest.length) {
    const laid = layoutMcd({ entities, relations, links })
    const at = new Map([...laid.entities, ...laid.relations].map((n) => [n.id, n]))
    const keptNodes = [...entities, ...relations].filter((n) => kept.has(n.id))
    const right = Math.max(...keptNodes.map((n) => n.x + sizeOf(n).w))
    const top = Math.min(...keptNodes.map((n) => n.y))
    const minX = Math.min(...rest.map((n) => at.get(n.id)!.x))
    const minY = Math.min(...rest.map((n) => at.get(n.id)!.y))
    for (const n of rest) {
      n.x = at.get(n.id)!.x - minX + right + 80
      n.y = at.get(n.id)!.y - minY + top
    }
  }

  // Points d'accroche des nouvelles pattes ; les pattes retrouvées gardent les leurs.
  for (const l of added) {
    const e = center(byId.get(l.entityId)!)
    const r = center(byId.get(l.relationId)!)
    l.entityHandle ??= sideToward(e, r)
    l.relationHandle ??= sideToward(r, e)
  }
  return { entities, relations, links }
}

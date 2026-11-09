/**
 * Mise en page d'un diagramme de classes : pure, sans Vue ni DOM. Les parents (héritage, réalisation, « tout » d'une
 * composition ou agrégation) sont placés au-dessus de leurs enfants ; le reste se range en lignes régulières.
 */
import { KIND_STEREOTYPE, classKey, relationKeys, type ClassBox, type ClassDocument, type ClassKind, type RelType } from './model'

export const CHAR_W = 7
export const ROW_H = 18
export const PAD = 10
export const HEAD_H = 34
export const STEREO_H = 14
export const MIN_W = 120
const GAP_X = 56
const GAP_Y = 84
const MAX_ROW_W = 1500
const MARGIN = 40

export interface LClass {
  key: string
  name: string
  kind: ClassKind
  stereotype?: string
  x: number
  y: number
  w: number
  h: number
  /** Hauteur de l'en-tête (nom + stéréotype). */
  headH: number
  attributes: string[]
  methods: string[]
  /** Ordonnée (absolue) du filet qui sépare attributs et méthodes. */
  methodsY: number
}

export interface LMarker {
  d: string
  /** `hollow` : fond du canvas ; `solid` : couleur du trait ; `none` : tracé seul (flèche ouverte). */
  fill: 'hollow' | 'solid' | 'none'
}

export interface LText {
  x: number
  y: number
  text: string
  anchor: 'start' | 'middle' | 'end'
}

export interface LRelation {
  key: string
  type: RelType
  from: string
  to: string
  d: string
  dashed: boolean
  marker: LMarker | null
  label?: LText
  fromMult?: LText
  toMult?: LText
  /** Milieu du trait : sert à y recentrer la vue. */
  mid: { x: number; y: number }
}

export interface ClassLayout {
  title?: { x: number; y: number; text: string }
  classes: LClass[]
  relations: LRelation[]
  width: number
  height: number
}

const widest = (lines: string[]) => Math.max(0, ...lines.map((l) => l.length)) * CHAR_W

function sizeOf(c: ClassBox): Pick<LClass, 'w' | 'h' | 'headH' | 'stereotype'> {
  const stereotype = KIND_STEREOTYPE[c.kind]
  const headH = HEAD_H + (stereotype ? STEREO_H : 0)
  const w = Math.max(MIN_W, widest([c.name, ...c.attributes, ...c.methods]) + PAD * 2, (stereotype ? stereotype.length + 4 : 0) * CHAR_W + PAD * 2)
  const section = (n: number) => (n ? n * ROW_H + PAD : PAD)
  return { w: Math.ceil(w), h: headH + section(c.attributes.length) + section(c.methods.length), headH, stereotype: stereotype && `«${stereotype}»` }
}

/** Rang de chaque classe : 0 pour les racines, un de plus que le « parent » le plus bas. Les cycles sont tolérés (rang borné). */
function rankClasses(doc: ClassDocument): Map<string, number> {
  const rank = new Map(doc.classes.map((c) => [c.name, 0]))
  const ranking = doc.relations.filter((r) => r.from !== r.to && (r.type === 'inheritance' || r.type === 'realization' || r.type === 'composition' || r.type === 'aggregation'))
  const limit = doc.classes.length
  for (let pass = 0; pass <= limit; pass++) {
    let changed = false
    for (const r of ranking) {
      const want = (rank.get(r.to) ?? 0) + 1
      if ((rank.get(r.from) ?? 0) < want && want <= limit) {
        rank.set(r.from, want)
        changed = true
      }
    }
    if (!changed) break
  }
  return rank
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Point où le segment centre → `toward` quitte le rectangle. */
function exitPoint(r: Rect, toward: { x: number; y: number }) {
  const c = center(r)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy))
  return { x: c.x + dx * s, y: c.y + dy * s }
}

const f = (n: number) => Math.round(n * 10) / 10

/** Symbole de fin de relation, pointe en `p`, le trait arrivant dans la direction `u` (vecteur unitaire). */
function markerFor(type: RelType, p: { x: number; y: number }, u: { x: number; y: number }): LMarker | null {
  const n = { x: -u.y, y: u.x }
  const at = (back: number, side: number) => `${f(p.x - u.x * back + n.x * side)},${f(p.y - u.y * back + n.y * side)}`
  switch (type) {
    case 'inheritance':
    case 'realization':
      return { d: `M${f(p.x)},${f(p.y)} L${at(14, 7)} L${at(14, -7)} Z`, fill: 'hollow' }
    case 'composition':
    case 'aggregation':
      return { d: `M${f(p.x)},${f(p.y)} L${at(10, 6)} L${at(20, 0)} L${at(10, -6)} Z`, fill: type === 'composition' ? 'solid' : 'hollow' }
    case 'association':
    case 'dependency':
      return { d: `M${at(11, 6)} L${f(p.x)},${f(p.y)} L${at(11, -6)}`, fill: 'none' }
    default:
      return null
  }
}

export function layoutClasses(doc: ClassDocument): ClassLayout {
  const rank = rankClasses(doc)
  const sizes = new Map(doc.classes.map((c) => [c.name, sizeOf(c)]))
  const maxRank = Math.max(0, ...rank.values())
  const parentsOf = new Map<string, string[]>()
  for (const r of doc.relations) {
    if (r.from !== r.to && (r.type === 'inheritance' || r.type === 'realization' || r.type === 'composition' || r.type === 'aggregation')) parentsOf.set(r.from, [...(parentsOf.get(r.from) ?? []), r.to])
  }

  // Lignes : un rang par ligne, coupé en plusieurs lignes quand il est trop large.
  const rows: ClassBox[][] = []
  for (let k = 0; k <= maxRank; k++) {
    const members = doc.classes.filter((c) => rank.get(c.name) === k)
    let row: ClassBox[] = []
    let width = 0
    for (const c of members) {
      const w = sizes.get(c.name)!.w
      if (row.length && width + GAP_X + w > MAX_ROW_W) {
        rows.push(row)
        row = []
        width = 0
      }
      row.push(c)
      width += (row.length > 1 ? GAP_X : 0) + w
    }
    if (row.length) rows.push(row)
  }

  const placed = new Map<string, LClass>()
  /** Centre horizontal que la disposition automatique donne à chaque classe, indépendamment des positions posées à la main. */
  const autoCenter = new Map<string, number>()
  const rowWidth = (row: ClassBox[]) => row.reduce((s, c) => s + sizes.get(c.name)!.w, 0) + GAP_X * Math.max(0, row.length - 1)
  const totalW = Math.max(MIN_W, ...rows.map(rowWidth))
  let y = MARGIN + (doc.title ? 30 : 0)
  for (const row of rows) {
    // Sous leurs parents quand ils sont connus : on ordonne par position moyenne des parents déjà placés.
    const bary = (c: ClassBox) => {
      const xs = (parentsOf.get(c.name) ?? []).map((p) => autoCenter.get(p)).filter((p): p is number => p !== undefined)
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity
    }
    const ordered = row.map((c, i) => ({ c, i, b: bary(c) })).sort((a, b) => (a.b === b.b ? a.i - b.i : a.b - b.b)).map((e) => e.c)
    let x = MARGIN + (totalW - rowWidth(ordered)) / 2
    let rowH = 0
    for (const c of ordered) {
      const s = sizes.get(c.name)!
      // Une position posée à la main l'emporte sur la disposition automatique (qui garde néanmoins la place de la classe).
      const px = c.x ?? x
      const py = c.y ?? y
      const methodsY = py + s.headH + (c.attributes.length ? c.attributes.length * ROW_H + PAD : PAD)
      placed.set(c.name, { key: classKey(c.name), name: c.name, kind: c.kind, stereotype: s.stereotype, x: px, y: py, w: s.w, h: s.h, headH: s.headH, attributes: c.attributes, methods: c.methods, methodsY })
      autoCenter.set(c.name, x + s.w / 2)
      x += s.w + GAP_X
      rowH = Math.max(rowH, s.h)
    }
    y += rowH + GAP_Y
  }

  const keys = relationKeys(doc.relations)
  const relations: LRelation[] = []
  doc.relations.forEach((r, i) => {
    const a = placed.get(r.from)
    const b = placed.get(r.to)
    if (!a || !b) return
    const dashed = r.type === 'realization' || r.type === 'dependency'
    if (a === b) {
      // Relation sur soi-même : une boucle sur le côté droit.
      const x0 = a.x + a.w
      const y0 = a.y + 18
      const y1 = a.y + 18 + 28
      const p = { x: x0, y: y1 }
      const ux = { x: -1, y: 0 }
      relations.push({
        key: keys[i], type: r.type, from: r.from, to: r.to, dashed,
        d: `M${x0},${y0} H${x0 + 34} V${y1} H${x0}`,
        marker: markerFor(r.type, p, ux),
        label: r.label ? { x: x0 + 40, y: (y0 + y1) / 2 + 4, text: r.label, anchor: 'start' } : undefined,
        mid: { x: x0 + 34, y: (y0 + y1) / 2 },
      })
      return
    }
    const ca = center(a)
    const cb = center(b)
    const start = exitPoint(a, cb)
    const end = exitPoint(b, ca)
    const len = Math.hypot(end.x - start.x, end.y - start.y) || 1
    const u = { x: (end.x - start.x) / len, y: (end.y - start.y) / len }
    const n = { x: -u.y, y: u.x }
    const near = (p: { x: number; y: number }, along: number, side: number) => ({ x: p.x + u.x * along + n.x * side, y: p.y + u.y * along + n.y * side })
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const t = (p: { x: number; y: number }, text: string, anchor: LText['anchor'] = 'middle'): LText => ({ x: f(p.x), y: f(p.y), text, anchor })
    relations.push({
      key: keys[i], type: r.type, from: r.from, to: r.to, dashed,
      d: `M${f(start.x)},${f(start.y)} L${f(end.x)},${f(end.y)}`,
      marker: markerFor(r.type, end, u),
      label: r.label ? t(near(mid, 0, -9), r.label) : undefined,
      fromMult: r.fromMult ? t(near(start, 14, 12), r.fromMult) : undefined,
      toMult: r.toMult ? t(near(end, -26, 12), r.toMult) : undefined,
      mid,
    })
  })

  const list = [...placed.values()]
  const width = Math.max(totalW, ...list.map((c) => c.x + c.w - MARGIN)) + MARGIN * 2 + (relations.some((r) => r.from === r.to) ? 120 : 0)
  const height = Math.max(y - GAP_Y, MARGIN, ...list.map((c) => c.y + c.h)) + MARGIN
  return { title: doc.title ? { x: width / 2, y: MARGIN, text: doc.title } : undefined, classes: list, relations, width, height }
}

/** Centre d'une classe (`c:Nom`) ou d'une relation (`r:…`) : sert à y recentrer la vue. */
export function locate(layout: ClassLayout, key: string): { x: number; y: number } | null {
  const c = layout.classes.find((x) => x.key === key)
  if (c) return { x: c.x + c.w / 2, y: c.y + c.h / 2 }
  const r = layout.relations.find((x) => x.key === key)
  return r ? r.mid : null
}

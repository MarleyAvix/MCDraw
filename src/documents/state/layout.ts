/**
 * Mise en page d'un diagramme d'états : chaque conteneur (la racine, puis chaque état composite) est disposé à part par
 * dagre, de l'intérieur vers l'extérieur ; un composite entre ensuite dans son parent comme une boîte de taille fixe.
 * Pur et déterministe (la largeur du texte est estimée au nombre de caractères) : le composant n'a plus qu'à dessiner.
 */
import dagre from '@dagrejs/dagre'
import { PSEUDO, isComposite, stateLabel, transitionLabel, type Container, type Direction, type StateDocument, type StateKind, type StateNode, type Transition } from './model'

export const CHAR_W = 6.6
const NAME_W = 7.4
export const LINE_H = 15
const PAD = 16
const MARGIN = 28
const START_D = 18
const END_D = 24
const CHOICE_D = 30
const BAR = [84, 8] as const
const TITLE_H = 36

const wrap = (text: string, max: number): string[] => {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > max) {
        out.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    out.push(line)
  }
  return out
}

export interface Pt {
  x: number
  y: number
}

/** Un état dessiné : coordonnées absolues dans le diagramme. */
export interface LState {
  /** Identifiant de sélection : `s:` + nom. */
  id: string
  name: string
  kind: StateKind
  composite: boolean
  /** Profondeur d'imbrication (0 = racine). */
  depth: number
  x: number
  y: number
  w: number
  h: number
  /** Lignes du nom (le libellé, coupé s'il est long). */
  title: string[]
  /** Hauteur de l'en-tête (nom) ; l'intérieur d'un composite ou les actions commencent juste dessous. */
  headerH: number
  actions: string[]
  note: string[]
}
export interface LPseudo {
  id: string
  type: 'start' | 'end'
  /** Nom du composite qui contient ce point ; vide à la racine. */
  owner: string
  x: number
  y: number
  w: number
  h: number
}
export interface LEdge {
  id: string
  from: string
  to: string
  /** Tracé lissé et pointe de flèche (points d'un polygone). */
  d: string
  head: string
  lines: string[]
  /** Centre et taille de l'étiquette. */
  lx: number
  ly: number
  lw: number
  lh: number
  self: boolean
}
export interface Layout {
  states: LState[]
  pseudos: LPseudo[]
  edges: LEdge[]
  title?: string
  titleY: number
  width: number
  height: number
}

// --- Dimensions d'un état ----------------------------------------------------------

interface Local {
  w: number
  h: number
  /** Hauteur du bloc du nom. */
  headerH: number
  /** Où commence l'intérieur d'un composite : sous le nom, les actions et la note. */
  innerTop: number
  title: string[]
  actions: string[]
  note: string[]
  inner?: Inner
}

function measure(s: StateNode, dir: Direction): Local {
  if (s.kind === 'choice') return { w: CHOICE_D, h: CHOICE_D, headerH: 0, innerTop: 0, title: [], actions: [], note: [] }
  if (s.kind === 'fork' || s.kind === 'join') return { w: dir === 'LR' ? BAR[1] : BAR[0], h: dir === 'LR' ? BAR[0] : BAR[1], headerH: 0, innerTop: 0, title: [], actions: [], note: [] }
  const title = wrap(stateLabel(s), 26)
  const actions = (s.actions ?? []).flatMap((a) => wrap(a, 34))
  const note = s.note ? wrap(s.note, 34) : []
  const headerH = title.length * LINE_H + 16
  const textW = Math.max(...title.map((l) => l.length * NAME_W + 30), ...actions.map((l) => l.length * CHAR_W + 22), ...note.map((l) => l.length * CHAR_W + 22), 96)
  const actionsH = actions.length ? actions.length * LINE_H + 10 : 0
  const noteH = note.length ? note.length * LINE_H + 10 : 0
  if (!isComposite(s)) return { w: textW, h: headerH + actionsH + noteH, headerH, innerTop: headerH + actionsH + noteH, title, actions, note }
  const inner = layoutContainer(s, dir)
  const body = inner.nodes.length || inner.pseudos.length ? inner : undefined
  const innerW = body ? body.w : 90
  const innerH = body ? body.h : 30
  return { w: Math.max(textW, innerW + 2 * PAD), h: headerH + actionsH + noteH + innerH + 2 * PAD, headerH, innerTop: headerH + actionsH + noteH, title, actions, note, inner: body }
}

// --- Conteneur ---------------------------------------------------------------------

interface CNode {
  state: StateNode
  local: Local
  x: number
  y: number
}
interface CPseudo {
  type: 'start' | 'end'
  x: number
  y: number
  w: number
  h: number
}
interface CEdge {
  t: Transition
  points: Pt[]
  lines: string[]
  lx: number
  ly: number
  lw: number
  lh: number
  self: boolean
}
interface Inner {
  w: number
  h: number
  nodes: CNode[]
  pseudos: CPseudo[]
  edges: CEdge[]
}

const START = '\u0000start'
const END = '\u0000end'

/** Dispose les enfants d'un conteneur ; les coordonnées sont relatives au coin haut-gauche de son contenu. */
function layoutContainer(c: Container, dir: Direction): Inner {
  const nodes: CNode[] = c.states.map((state) => ({ state, local: measure(state, dir), x: 0, y: 0 }))
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: dir, nodesep: 46, ranksep: 58, edgesep: 24, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.state.name, { width: n.local.w, height: n.local.h })
  const usesStart = c.transitions.some((t) => t.from === PSEUDO)
  const usesEnd = c.transitions.some((t) => t.to === PSEUDO)
  if (usesStart) g.setNode(START, { width: START_D, height: START_D })
  if (usesEnd) g.setNode(END, { width: END_D, height: END_D })

  const edges: CEdge[] = c.transitions.map((t) => {
    const lines = wrap(transitionLabel(t), 26)
    const lw = lines.some(Boolean) ? Math.max(...lines.map((l) => l.length)) * CHAR_W + 12 : 0
    const lh = lines.some(Boolean) ? lines.length * LINE_H + 4 : 0
    g.setEdge(t.from === PSEUDO ? START : t.from, t.to === PSEUDO ? END : t.to, { width: lw, height: lh, labelpos: 'c' }, t.id)
    return { t, points: [], lines: lines.some(Boolean) ? lines : [], lx: 0, ly: 0, lw, lh, self: t.from === t.to }
  })
  dagre.layout(g)

  for (const n of nodes) {
    const p = g.node(n.state.name)
    n.x = p.x - n.local.w / 2
    n.y = p.y - n.local.h / 2
  }
  const pseudos: CPseudo[] = []
  if (usesStart) {
    const p = g.node(START)
    pseudos.push({ type: 'start', x: p.x - START_D / 2, y: p.y - START_D / 2, w: START_D, h: START_D })
  }
  if (usesEnd) {
    const p = g.node(END)
    pseudos.push({ type: 'end', x: p.x - END_D / 2, y: p.y - END_D / 2, w: END_D, h: END_D })
  }
  for (const e of edges) {
    const ge = g.edge(e.t.from === PSEUDO ? START : e.t.from, e.t.to === PSEUDO ? END : e.t.to, e.t.id) as { points?: Pt[]; x?: number; y?: number }
    e.points = (ge.points ?? []).map((p) => ({ x: p.x, y: p.y }))
    e.lx = ge.x ?? 0
    e.ly = ge.y ?? 0
  }
  return normalize({ w: 0, h: 0, nodes, pseudos, edges })
}

/** Cadre de la fenêtre : tout ce qui est dessiné (boîtes, tracés, étiquettes), recalé sur l'origine. */
function normalize(inner: Inner): Inner {
  const xs: number[] = []
  const ys: number[] = []
  const box = (x: number, y: number, w: number, h: number) => (xs.push(x, x + w), ys.push(y, y + h))
  for (const n of inner.nodes) box(n.x, n.y, n.local.w, n.local.h)
  for (const p of inner.pseudos) box(p.x, p.y, p.w, p.h)
  for (const e of inner.edges) {
    if (e.self) {
      const n = inner.nodes.find((q) => q.state.name === e.t.from)
      if (n) box(n.x + n.local.w, n.y, 40 + e.lw, n.local.h)
    } else for (const p of e.points) box(p.x, p.y, 0, 0)
    if (e.lw) box(e.lx - e.lw / 2, e.ly - e.lh / 2, e.lw, e.lh)
  }
  const dx = xs.length ? -Math.min(...xs) : 0
  const dy = ys.length ? -Math.min(...ys) : 0
  for (const n of inner.nodes) ((n.x += dx), (n.y += dy))
  for (const p of inner.pseudos) ((p.x += dx), (p.y += dy))
  for (const e of inner.edges) {
    e.points = e.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    e.lx += dx
    e.ly += dy
  }
  return { ...inner, w: xs.length ? Math.max(...xs) + dx : 0, h: ys.length ? Math.max(...ys) + dy : 0 }
}

// --- Tracé des transitions ---------------------------------------------------------

/** Courbe lisse (Catmull-Rom → Bézier) qui passe par tous les points. */
function smooth(pts: Pt[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`
  }
  return d
}

/** Pointe de flèche posée au bout du dernier segment. */
function arrowHead(pts: Pt[]): string {
  const b = pts[pts.length - 1]
  let a = pts[pts.length - 2] ?? b
  // Un dernier segment minuscule donne une direction instable : on remonte au point précédent.
  for (let i = pts.length - 2; i >= 0 && Math.hypot(b.x - pts[i].x, b.y - pts[i].y) < 6; i--) a = pts[i - 1] ?? pts[i]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const bx = b.x - ux * 10
  const by = b.y - uy * 10
  return `${b.x},${b.y} ${bx - uy * 5},${by + ux * 5} ${bx + uy * 5},${by - ux * 5}`
}

// --- Mise à plat -------------------------------------------------------------------

export function layoutState(doc: StateDocument): Layout {
  const dir: Direction = doc.direction ?? 'TB'
  const root = layoutContainer(doc, dir)
  const top = doc.title ? TITLE_H : 0
  const out: Layout = { states: [], pseudos: [], edges: [], ...(doc.title ? { title: doc.title } : {}), titleY: MARGIN + 6, width: 0, height: 0 }

  const place = (inner: Inner, ox: number, oy: number, depth: number, owner: string) => {
    for (const n of inner.nodes) {
      const x = ox + n.x
      const y = oy + n.y
      const s = n.state
      out.states.push({
        id: `s:${s.name}`, name: s.name, kind: s.kind, composite: isComposite(s), depth, x, y, w: n.local.w, h: n.local.h,
        title: n.local.title, headerH: n.local.headerH, actions: n.local.actions, note: n.local.note,
      })
      if (n.local.inner) place(n.local.inner, x + PAD + (n.local.w - 2 * PAD - n.local.inner.w) / 2, y + n.local.innerTop + PAD, depth + 1, s.name)
    }
    inner.pseudos.forEach((p) => out.pseudos.push({ id: `${p.type}:${owner}`, type: p.type, owner, x: ox + p.x, y: oy + p.y, w: p.w, h: p.h }))
    for (const e of inner.edges) {
      let points = e.points.map((p) => ({ x: ox + p.x, y: oy + p.y }))
      let lx = ox + e.lx
      let ly = oy + e.ly
      if (e.self) {
        // Boucle à droite de l'état : ni dagre ni les étiquettes ne la gênent, la place est déjà réservée.
        const n = inner.nodes.find((q) => q.state.name === e.t.from)!
        const cx = ox + n.x + n.local.w
        const cy = oy + n.y + n.local.h / 2
        points = [{ x: cx, y: cy - 9 }, { x: cx + 26, y: cy - 16 }, { x: cx + 26, y: cy + 16 }, { x: cx, y: cy + 9 }]
        lx = cx + 32 + e.lw / 2
        ly = cy
      }
      if (points.length < 2) continue
      out.edges.push({
        id: e.t.id, from: e.t.from, to: e.t.to, d: smooth(points), head: arrowHead(points), lines: e.lines, lx, ly, lw: e.lw, lh: e.lh, self: e.self,
      })
    }
  }
  place(root, MARGIN, MARGIN + top, 0, '')

  // Cadre final : tout ce qui dépasse (étiquettes de boucles, titre) est inclus.
  let maxX = 0
  let maxY = 0
  for (const s of out.states) ((maxX = Math.max(maxX, s.x + s.w)), (maxY = Math.max(maxY, s.y + s.h)))
  for (const p of out.pseudos) ((maxX = Math.max(maxX, p.x + p.w)), (maxY = Math.max(maxY, p.y + p.h)))
  for (const e of out.edges) ((maxX = Math.max(maxX, e.lx + e.lw / 2)), (maxY = Math.max(maxY, e.ly + e.lh / 2)))
  out.width = Math.max(maxX + MARGIN, doc.title ? doc.title.length * 9.6 + 2 * MARGIN : 0)
  out.height = maxY + MARGIN
  if (doc.title) {
    // Le titre est centré sur la largeur ; si le diagramme est plus étroit, tout est centré sous lui.
    const content = maxX + MARGIN
    const shift = (out.width - content) / 2
    if (shift > 0) {
      for (const s of out.states) s.x += shift
      for (const p of out.pseudos) p.x += shift
      for (const e of out.edges) {
        e.d = shiftPath(e.d, shift)
        e.head = e.head.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x: string, y: string) => `${Number(x) + shift},${y}`)
        e.lx += shift
      }
    }
  }
  return out
}

/** Décale horizontalement tous les points d'un tracé `M x,y C x,y x,y x,y …`. */
const shiftPath = (d: string, dx: number) => d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x: string, y: string) => `${Number(x) + dx},${y}`)

/** Centre d'un élément (`s:Nom` ou identifiant de transition) pour y recentrer la vue. */
export function locate(layout: Layout, id: string): Pt | null {
  const s = layout.states.find((q) => q.id === id)
  if (s) return { x: s.x + s.w / 2, y: s.y + s.h / 2 }
  const e = layout.edges.find((q) => q.id === id)
  if (e) return { x: e.lx, y: e.ly }
  return null
}

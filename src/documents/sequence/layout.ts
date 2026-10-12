/**
 * Mise en page d'un diagramme de séquence : position de chaque participant, ligne de chaque message, rectangle des notes
 * et des blocs, barres d'activation. Pur et déterministe (la largeur du texte est estimée au nombre de caractères) :
 * le composant n'a plus qu'à dessiner ce qui est calculé ici.
 */
import { blockLabel, type Arrow, type BlockType, type NotePosition, type ParticipantKind, type SeqDocument, type SeqItem } from './model'

export const CHAR_W = 6.6
export const LINE_H = 14
export const BOX_H = 44
const GAP_MIN = 130
const BLOCK_PAD = 16
const BLOCK_TAB_H = 22

const textLines = (s: string) => (s ? s.split('\n') : [])
/** Largeur estimée d'un texte (sa ligne la plus longue). */
export const textWidth = (s: string) => Math.max(0, ...textLines(s).map((l) => l.length)) * CHAR_W
const noteWidth = (text: string) => Math.max(80, textWidth(text) + 22)

export interface LParticipant {
  /** Identifiant de sélection : `p:` + nom. */
  id: string
  name: string
  label: string
  kind: ParticipantKind
  x: number
  boxW: number
}
export interface LMessage {
  id: string
  arrow: Arrow
  x1: number
  x2: number
  /** Ordonnée de la flèche. */
  y: number
  self: boolean
  lines: string[]
  textX: number
  textY: number
  /** Numéro affiché (diagramme numéroté). */
  number?: number
  /** Rectangle cliquable. */
  hit: { x: number; y: number; w: number; h: number }
}
export interface LNote {
  id: string
  position: NotePosition
  x: number
  y: number
  w: number
  h: number
  lines: string[]
}
export interface LBlockSection {
  id: string
  index: number
  y: number
  label: string
}
export interface LBlock {
  id: string
  type: BlockType
  label: string
  depth: number
  x: number
  y: number
  w: number
  h: number
  /** Largeur de l'étiquette (`alt`) en haut à gauche. */
  tabW: number
  /** Séparateurs entre les sections (la première section n'en a pas). */
  sections: LBlockSection[]
}
export interface LActivation {
  participant: string
  x: number
  y1: number
  y2: number
  level: number
}
export interface Layout {
  width: number
  height: number
  title?: string
  titleY: number
  participants: LParticipant[]
  boxY: number
  lifelineTop: number
  lifelineBottom: number
  bottomBoxY: number
  messages: LMessage[]
  notes: LNote[]
  blocks: LBlock[]
  activations: LActivation[]
}

interface Extent {
  min: number
  max: number
}
const merge = (a: Extent | null, b: Extent | null): Extent | null => (!a ? b : !b ? a : { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) })

export function layoutSequence(doc: SeqDocument): Layout {
  const ps = doc.participants
  const n = ps.length
  const titleH = doc.title ? 34 : 0
  const boxY = 14 + titleH
  const empty: Layout = { width: 0, height: 0, title: doc.title, titleY: 24, participants: [], boxY, lifelineTop: 0, lifelineBottom: 0, bottomBoxY: 0, messages: [], notes: [], blocks: [], activations: [] }
  if (!n) return empty

  const index = new Map(ps.map((p, i) => [p.name, i]))
  const labelOf = (i: number) => ps[i].label ?? ps[i].name
  const boxW = ps.map((p, i) => Math.max(100, labelOf(i).length * CHAR_W + 34 + (p.kind === 'participant' ? 0 : 24)))

  // --- Largeurs : ce dont chaque participant a besoin de part et d'autre, et ce que demandent les messages qui en enjambent plusieurs
  const needLeft = boxW.map((w) => w / 2)
  const needRight = boxW.map((w) => w / 2)
  const spans: { i: number; j: number; need: number }[] = []
  const scan = (items: SeqItem[]) => {
    for (const it of items) {
      if (it.kind === 'message') {
        const a = index.get(it.from)!
        const b = index.get(it.to)!
        const w = textWidth(it.text)
        if (a === b) needRight[a] = Math.max(needRight[a], w + 62)
        else spans.push({ i: Math.min(a, b), j: Math.max(a, b), need: w + 60 })
      } else if (it.kind === 'note') {
        const w = noteWidth(it.text)
        const a = index.get(it.participants[0])!
        if (it.position === 'left') needLeft[a] = Math.max(needLeft[a], w + 16)
        else if (it.position === 'right') needRight[a] = Math.max(needRight[a], w + 16)
        else if (it.participants.length === 2) {
          const b = index.get(it.participants[1])!
          if (a !== b) spans.push({ i: Math.min(a, b), j: Math.max(a, b), need: w - 20 })
          else {
            needLeft[a] = Math.max(needLeft[a], w / 2 + 6)
            needRight[a] = Math.max(needRight[a], w / 2 + 6)
          }
        } else {
          needLeft[a] = Math.max(needLeft[a], w / 2 + 6)
          needRight[a] = Math.max(needRight[a], w / 2 + 6)
        }
      } else for (const s of it.sections) scan(s.items)
    }
  }
  scan(doc.items)

  const gaps = Array.from({ length: n - 1 }, (_, i) => Math.max(GAP_MIN, needRight[i] + needLeft[i + 1] + 8))
  for (const s of spans.sort((p, q) => p.j - p.i - (q.j - q.i))) {
    let sum = 0
    for (let k = s.i; k < s.j; k++) sum += gaps[k]
    if (sum < s.need) for (let k = s.i; k < s.j; k++) gaps[k] += (s.need - sum) / (s.j - s.i)
  }
  const xs: number[] = [30 + needLeft[0]]
  for (let i = 1; i < n; i++) xs.push(xs[i - 1] + gaps[i - 1])
  const xOf = (name: string) => xs[index.get(name)!]

  // --- Lignes ----------------------------------------------------------------------
  const lifelineTop = boxY + BOX_H
  let y = lifelineTop + 24
  let counter = 0
  const messages: LMessage[] = []
  const notes: LNote[] = []
  const blocks: LBlock[] = []
  const activations: LActivation[] = []
  const open = new Map<string, number[]>(ps.map((p) => [p.name, []]))
  const closeBar = (name: string, yEnd: number) => {
    const stack = open.get(name)!
    const y1 = stack.pop()
    if (y1 !== undefined) activations.push({ participant: name, x: xOf(name), y1, y2: yEnd, level: stack.length })
  }

  const place = (items: SeqItem[], depth: number): Extent | null => {
    let ext: Extent | null = null
    for (const it of items) {
      if (it.kind === 'message') {
        const a = xOf(it.from)
        const b = xOf(it.to)
        const self = a === b
        const lines = textLines(it.text)
        const textH = lines.length * LINE_H
        const arrowY = self ? y + 8 : y + (lines.length ? textH + 8 : 14)
        const rowEnd = self ? y + Math.max(textH, 24) + 22 : arrowY + 18
        if (it.deactivate) closeBar(it.from, arrowY)
        if (it.activate) open.get(it.to)!.push(arrowY)
        const number = doc.autonumber ? ++counter : undefined
        const x1 = a
        const x2 = self ? a : b
        const w = textWidth(it.text)
        messages.push({
          id: it.id, arrow: it.arrow, x1, x2, y: arrowY, self, lines,
          textX: self ? a + 52 : (a + b) / 2,
          textY: self ? y + 12 : y + 11,
          ...(number ? { number } : {}),
          hit: self ? { x: a - 8, y: y - 2, w: 60 + w, h: rowEnd - y } : { x: Math.min(a, b) - 6, y: y - 2, w: Math.abs(b - a) + 12, h: rowEnd - y },
        })
        ext = merge(ext, self ? { min: a - 8, max: a + 56 + w } : { min: Math.min(a, b) - 8, max: Math.max(a, b) + 8 })
        y = rowEnd
      } else if (it.kind === 'note') {
        const lines = textLines(it.text)
        const w = noteWidth(it.text)
        const h = Math.max(1, lines.length) * LINE_H + 14
        const a = xOf(it.participants[0])
        let x: number
        let width = w
        if (it.position === 'left') x = a - 10 - w
        else if (it.position === 'right') x = a + 10
        else if (it.participants.length === 2 && xOf(it.participants[1]) !== a) {
          const b = xOf(it.participants[1])
          width = Math.max(w, Math.abs(b - a) + 20)
          x = (a + b) / 2 - width / 2
        } else x = a - w / 2
        notes.push({ id: it.id, position: it.position, x, y, w: width, h, lines })
        ext = merge(ext, { min: x, max: x + width })
        y += h + 12
      } else {
        const start = y
        y += BLOCK_TAB_H + 8
        let inner: Extent | null = null
        const seps: LBlockSection[] = []
        it.sections.forEach((s, k) => {
          if (k > 0) {
            seps.push({ id: s.id, index: k, y, label: s.label ?? '' })
            y += 24
          }
          inner = merge(inner, place(s.items, depth + 1))
          y += 4
        })
        const label = blockLabel(it)
        const tabW = (it.type.length + 1) * CHAR_W + 22
        const dMin = xs[0] - 40
        const dMax = xs[n - 1] + 40
        let x1 = (inner ? (inner as Extent).min : dMin) - BLOCK_PAD
        let x2 = (inner ? (inner as Extent).max : dMax) + BLOCK_PAD
        const need = tabW + (label ? textWidth(label) + 34 : 0) + 20
        if (x2 - x1 < need) x2 = x1 + need
        if (x1 > dMin && !inner) x1 = dMin
        blocks.push({ id: it.id, type: it.type, label, depth, x: x1, y: start, w: x2 - x1, h: y - start, tabW, sections: seps })
        ext = merge(ext, { min: x1, max: x2 })
        y += 12
      }
    }
    return ext
  }
  const whole = place(doc.items, 0)

  const lifelineBottom = y + 6
  for (const p of ps) while (open.get(p.name)!.length) closeBar(p.name, lifelineBottom)
  const bottomBoxY = lifelineBottom
  const height = bottomBoxY + BOX_H + 18

  // --- Cadrage horizontal : tout reste dans l'image, même un bloc imbriqué plus large que la marge --------------
  const minX = Math.min(xs[0] - boxW[0] / 2, whole?.min ?? Infinity, ...blocks.map((b) => b.x), ...notes.map((nt) => nt.x))
  const shift = minX < 14 ? 14 - minX : 0
  const maxX = Math.max(xs[n - 1] + needRight[n - 1], whole?.max ?? 0, ...blocks.map((b) => b.x + b.w), ...notes.map((nt) => nt.x + nt.w))
  const titleW = doc.title ? textWidth(doc.title) * 1.2 + 28 : 0
  const width = Math.max(maxX + shift + 20, titleW)

  const mv = <T extends { x: number }>(o: T): T => ({ ...o, x: o.x + shift })
  return {
    width,
    height,
    title: doc.title,
    titleY: 26,
    participants: ps.map((p, i) => ({ id: `p:${p.name}`, name: p.name, label: labelOf(i), kind: p.kind, x: xs[i] + shift, boxW: boxW[i] })),
    boxY,
    lifelineTop,
    lifelineBottom,
    bottomBoxY,
    messages: messages.map((m) => ({ ...m, x1: m.x1 + shift, x2: m.x2 + shift, textX: m.textX + shift, hit: { ...m.hit, x: m.hit.x + shift } })),
    notes: notes.map(mv),
    blocks: blocks.sort((a, b) => a.depth - b.depth).map(mv),
    activations: activations.map(mv),
  }
}

/** Position (dans le repère du diagramme) d'un élément ou d'un participant, pour le recentrer à l'écran ; `null` s'il n'y est pas. */
export function locate(layout: Layout, id: string): { x: number; y: number } | null {
  const p = layout.participants.find((q) => q.id === id)
  if (p) return { x: p.x, y: layout.boxY + BOX_H / 2 }
  const m = layout.messages.find((q) => q.id === id)
  if (m) return { x: (m.x1 + m.x2) / 2, y: m.y }
  const n = layout.notes.find((q) => q.id === id)
  if (n) return { x: n.x + n.w / 2, y: n.y + n.h / 2 }
  const b = layout.blocks.find((q) => q.id === id)
  if (b) return { x: b.x + b.w / 2, y: b.y + 12 }
  return null
}

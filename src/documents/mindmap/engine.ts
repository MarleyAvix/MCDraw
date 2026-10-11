/**
 * Moteur de la carte mentale : un arbre d'idées. L'ordre du tableau est l'ordre des idées sœurs.
 * Tout ici est pur (pas de Vue, pas de DOM) : saisie texte, mise en page, exports Markdown / OPML, validation.
 */
import { childrenOf, repairTree, rootsOf, subtreeIds, walkTree } from '../../core/tree'

export interface MindNode {
  id: string
  text: string
  /** Idée mère ; absent pour l'idée centrale. */
  parentId?: string
  note?: string
  /** Branche repliée : ses descendants sont masqués. */
  collapsed?: boolean
}

export interface MindmapSchema {
  nodes: MindNode[]
}

export interface ParseError {
  line: number
  message: string
}

export const emptyMindmap = (): MindmapSchema => ({ nodes: [] })

export { childrenOf, rootsOf, subtreeIds }
export const walk = (nodes: MindNode[]) => walkTree(nodes)

/** Idées masquées parce qu'une de leurs ancêtres est repliée (l'idée repliée elle-même reste visible). */
export function hiddenIds(nodes: MindNode[]): Set<string> {
  const hidden = new Set<string>()
  for (const n of nodes) if (n.collapsed) for (const id of subtreeIds(nodes, n.id)) if (id !== n.id) hidden.add(id)
  return hidden
}

// --- Mise en page ------------------------------------------------------------

export type Side = 'left' | 'right' | 'center'

export interface MindLayout {
  pos: Map<string, { x: number; y: number }>
  side: Map<string, Side>
  /** Rang de la branche (enfant de l'idée centrale) dont chaque idée descend ; -1 pour l'idée centrale. */
  branch: Map<string, number>
}

/**
 * Mise en page équilibrée : l'idée centrale est au milieu, ses branches se répartissent à droite puis à gauche
 * (en gardant l'ordre de lecture), chaque idée étant centrée en face de ses enfants. Déterministe.
 * Plusieurs idées centrales sont empilées verticalement.
 */
export function layoutMindmap(nodes: MindNode[], size: { w: number; h: number }, gap: { x: number; y: number }): MindLayout {
  const pos = new Map<string, { x: number; y: number }>()
  const side = new Map<string, Side>()
  const branch = new Map<string, number>()
  const slot = size.h + gap.y
  const step = size.w + gap.x
  const kidsOf = (n: MindNode) => (n.collapsed ? [] : childrenOf(nodes, n.id))

  const leavesMemo = new Map<string, number>()
  const leaves = (n: MindNode, seen = new Set<string>()): number => {
    const known = leavesMemo.get(n.id)
    if (known !== undefined) return known
    if (seen.has(n.id)) return 1 // garde-fou contre un cycle
    seen.add(n.id)
    const kids = kidsOf(n)
    const v = kids.length ? kids.reduce((sum, k) => sum + leaves(k, seen), 0) : 1
    leavesMemo.set(n.id, v)
    return v
  }

  let top = 0
  for (const root of rootsOf(nodes)) {
    const kids = kidsOf(root)
    const total = kids.reduce((sum, k) => sum + leaves(k), 0)
    const groups: Record<'left' | 'right', MindNode[]> = { right: [], left: [] }
    let acc = 0
    for (const k of kids) {
      groups[acc < total / 2 ? 'right' : 'left'].push(k)
      acc += leaves(k)
    }

    // Chaque côté est posé à partir de y = 0, puis décalé pour que ses branches soient centrées sur l'idée centrale.
    const placed = (['right', 'left'] as const).map((s) => {
      const local = new Map<string, { x: number; y: number }>()
      let cursor = 0
      const place = (n: MindNode, depth: number): number => {
        if (local.has(n.id)) return local.get(n.id)!.y // garde-fou contre un cycle
        local.set(n.id, { x: 0, y: 0 })
        const kids = kidsOf(n)
        let y: number
        if (!kids.length) {
          y = cursor
          cursor += slot
        } else {
          const ys = kids.map((k) => place(k, depth + 1))
          y = (ys[0] + ys[ys.length - 1]) / 2
        }
        local.set(n.id, { x: (s === 'right' ? 1 : -1) * depth * step, y })
        return y
      }
      const ys = groups[s].map((k) => place(k, 1))
      return { s, local, height: cursor, mid: ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : 0, used: ys.length > 0 }
    })

    const used = placed.filter((p) => p.used)
    const mid = used.length ? Math.max(...used.map((p) => p.mid)) : 0
    let bottom = 0
    for (const p of used) {
      const shift = mid - p.mid
      for (const [id, v] of p.local) {
        pos.set(id, { x: v.x, y: top + v.y + shift })
        side.set(id, p.s)
      }
      bottom = Math.max(bottom, p.height - gap.y + shift)
    }
    pos.set(root.id, { x: 0, y: top + mid })
    side.set(root.id, 'center')
    branch.set(root.id, -1)
    bottom = Math.max(bottom, mid + size.h)

    const tag = (n: MindNode, b: number) => {
      branch.set(n.id, b)
      for (const c of kidsOf(n)) tag(c, b)
    }
    kids.forEach((k, i) => tag(k, i))

    top += bottom + gap.y * 3
  }
  return { pos, side, branch }
}

// --- Texte indenté -----------------------------------------------------------
//
//   Idée centrale -- une note
//     Branche A
//       Sous-idée
//     Branche B
//
// Une idée par ligne ; l'indentation donne la hiérarchie. Après le texte : « -- » puis une note.
// Une puce Markdown (« - », « * ») en début de ligne est ignorée. Commentaires : « // » en début de ligne.

const NOTE_SEP = ' -- '

export function mindmapToText(schema: MindmapSchema): string {
  return walk(schema.nodes)
    .map(({ item, depth }) => `${'  '.repeat(depth)}${item.text}${item.note ? `${NOTE_SEP}${item.note}` : ''}`)
    .join('\n')
}

/** Largeur d'indentation d'une ligne (une tabulation compte pour deux espaces). */
const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, '  ').length

export function parseMindmapText(text: string, makeId: () => string): { schema: MindmapSchema; errors: ParseError[] } {
  const nodes: MindNode[] = []
  const errors: ParseError[] = []
  const stack: { indent: number; id: string }[] = []

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    if (!raw.trim() || raw.trim().startsWith('//')) return
    const indent = indentOf(raw)

    let body = raw.trim().replace(/^[-*+]\s+/, '')
    let note: string | undefined
    const sep = /(^|\s)--(\s|$)/.exec(body)
    if (sep) {
      note = body.slice(sep.index + sep[0].length).trim() || undefined
      body = body.slice(0, sep.index).trim()
    }
    if (!body) {
      errors.push({ line, message: 'Texte manquant avant la note.' })
      return
    }

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (!stack.length && indent > 0 && nodes.length === 0) {
      errors.push({ line, message: 'La première idée ne doit pas être indentée.' })
      return
    }
    const parent = stack[stack.length - 1]
    const id = makeId()
    nodes.push({ id, text: body, ...(parent ? { parentId: parent.id } : {}), ...(note ? { note } : {}) })
    stack.push({ indent, id })
  })

  return { schema: { nodes }, errors }
}

/**
 * Réapplique un texte sur une carte existante : une idée garde son identifiant (donc sa sélection) et son état replié
 * quand son chemin de textes est inchangé. Les textes identiques sous une même mère sont appariés dans l'ordre.
 */
export function mergeMindmap(existing: MindmapSchema, fresh: MindmapSchema): MindmapSchema {
  const keyOf = (nodes: MindNode[]) => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const seen = new Map<string, number>()
    const out = new Map<string, string>()
    const path = (n: MindNode): string => (n.parentId && byId.has(n.parentId) ? `${path(byId.get(n.parentId)!)}/` : '') + n.text
    for (const n of nodes) {
      const base = path(n)
      const k = seen.get(base) ?? 0
      seen.set(base, k + 1)
      out.set(n.id, `${base}#${k}`)
    }
    return out
  }
  const oldByKey = new Map([...keyOf(existing.nodes)].map(([id, k]) => [k, existing.nodes.find((n) => n.id === id)!]))
  const keys = keyOf(fresh.nodes)
  const remap = new Map<string, string>()
  for (const n of fresh.nodes) remap.set(n.id, oldByKey.get(keys.get(n.id)!)?.id ?? n.id)
  return {
    nodes: fresh.nodes.map((n) => {
      const old = oldByKey.get(keys.get(n.id)!)
      return { ...n, id: remap.get(n.id)!, ...(n.parentId ? { parentId: remap.get(n.parentId)! } : {}), ...(old?.collapsed ? { collapsed: true } : {}) }
    }),
  }
}

// --- Exports -----------------------------------------------------------------

/** Liste Markdown imbriquée (idée centrale = première puce), notes après un tiret cadratin. */
export function mindmapToMarkdown(schema: MindmapSchema): string {
  return walk(schema.nodes)
    .map(({ item, depth }) => `${'  '.repeat(depth)}- ${item.text}${item.note ? ` — ${item.note}` : ''}`)
    .join('\n')
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Plan OPML 2.0, lisible par la plupart des outils de cartes mentales et de plans (XMind, MindNode, OmniOutliner…). */
export function mindmapToOpml(schema: MindmapSchema, title = 'Carte mentale'): string {
  const lines: string[] = []
  const emit = (n: MindNode, depth: number) => {
    const pad = '    '.repeat(depth + 1)
    const attrs = `text="${xmlEscape(n.text)}"${n.note ? ` _note="${xmlEscape(n.note)}"` : ''}`
    const kids = childrenOf(schema.nodes, n.id)
    if (!kids.length) lines.push(`${pad}<outline ${attrs}/>`)
    else {
      lines.push(`${pad}<outline ${attrs}>`)
      for (const k of kids) emit(k, depth + 1)
      lines.push(`${pad}</outline>`)
    }
  }
  for (const r of rootsOf(schema.nodes)) emit(r, 0)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${xmlEscape(title)}</title></head>`,
    '  <body>',
    ...lines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n')
}

// --- Validation d'une source externe -------------------------------------------

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/**
 * Valide une carte venue de l'extérieur (fichier, lien, sauvegarde) : champs complétés, identifiants manquants ou en double
 * régénérés, mère inconnue retirée, cycles coupés. Lève une Error si la structure est inutilisable.
 */
export function sanitizeMindmap(raw: unknown, makeId: () => string): MindmapSchema {
  const list = typeof raw === 'object' && raw !== null ? (raw as { nodes?: unknown }).nodes : undefined
  if (!Array.isArray(list)) throw new Error('Fichier invalide : liste d’idées manquante.')

  const used = new Set<string>()
  const nodes: MindNode[] = list
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r))
    .map((r) => {
      let id = typeof r.id === 'string' && r.id && !used.has(r.id) ? r.id : makeId()
      while (used.has(id)) id = makeId()
      used.add(id)
      const note = str(r.note).trim()
      return {
        id,
        text: str(r.text),
        ...(typeof r.parentId === 'string' && r.parentId ? { parentId: r.parentId } : {}),
        ...(note ? { note } : {}),
        ...(r.collapsed === true ? { collapsed: true } : {}),
      }
    })
  repairTree(nodes)
  return { nodes }
}

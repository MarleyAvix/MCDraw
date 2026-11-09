/**
 * Modèle d'un diagramme de classes : des classes (avec attributs et méthodes) reliées par des relations.
 * Tout ici est pur (pas de Vue, pas de DOM). Les classes sont désignées par leur nom (unique) ; les relations n'ont pas
 * d'identifiant propre : leur clé se déduit de leur contenu (`relationKeys`).
 */

export type ClassKind = 'class' | 'abstract' | 'interface' | 'enum'
export const CLASS_KINDS: ClassKind[] = ['class', 'abstract', 'interface', 'enum']
export const KIND_LABEL: Record<ClassKind, string> = { class: 'Classe', abstract: 'Classe abstraite', interface: 'Interface', enum: 'Énumération' }
/** Stéréotype affiché au-dessus du nom ; absent pour une classe ordinaire. */
export const KIND_STEREOTYPE: Partial<Record<ClassKind, string>> = { abstract: 'abstract', interface: 'interface', enum: 'enumeration' }

export interface ClassBox {
  /** Nom unique, sans espace. */
  name: string
  kind: ClassKind
  /** Une ligne par attribut (`+nom: String`) ; pour une énumération, une valeur par ligne. */
  attributes: string[]
  /** Une ligne par méthode (`+calculer(x): int`). */
  methods: string[]
  /** Position posée à la main (coin haut gauche) ; absente : la disposition automatique place la classe. */
  x?: number
  y?: number
}

/**
 * Nature d'une relation. Le symbole se dessine du côté de `to` :
 * héritage / réalisation : `to` est le parent ; composition / agrégation : `to` est le tout ; association / dépendance : flèche vers `to`.
 */
export type RelType = 'inheritance' | 'realization' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'link'
export const REL_TYPES: RelType[] = ['inheritance', 'realization', 'composition', 'aggregation', 'association', 'dependency', 'link']
export const REL_LABEL: Record<RelType, string> = {
  inheritance: 'Héritage (est un)',
  realization: 'Réalisation (implémente)',
  composition: 'Composition (est composé de)',
  aggregation: 'Agrégation (contient)',
  association: 'Association (connaît)',
  dependency: 'Dépendance (utilise)',
  link: 'Lien simple',
}
/** Écriture Mermaid : symbole à gauche (`to` écrit en premier) et, pour les relations orientées, symbole à droite. */
export const REL_TOKEN: Record<RelType, { left: string; right?: string }> = {
  inheritance: { left: '<|--', right: '--|>' },
  realization: { left: '<|..', right: '..|>' },
  composition: { left: '*--', right: '--*' },
  aggregation: { left: 'o--', right: '--o' },
  association: { left: '<--', right: '-->' },
  dependency: { left: '<..', right: '..>' },
  link: { left: '--' },
}

export interface Relation {
  from: string
  to: string
  type: RelType
  label?: string
  /** Multiplicité du côté de `from` / de `to` (`1`, `0..*`). */
  fromMult?: string
  toMult?: string
}

export interface ClassDocument {
  title?: string
  classes: ClassBox[]
  relations: Relation[]
}

export interface ParseError {
  line: number
  message: string
}

export const emptyClasses = (): ClassDocument => ({ classes: [], relations: [] })

// --- Noms et clés ---------------------------------------------------------------------

const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u
/** Mots que la saisie texte réserve. */
export const RESERVED = new Set(['class', 'classdiagram', 'title', 'note', 'direction'])
export const isValidName = (name: string) => NAME.test(name) && !RESERVED.has(name.toLowerCase())

/** Nom valide dérivé d'un libellé libre (`Compte client` → `Compteclient`) ; vide si rien n'est exploitable. */
export function nameFrom(label: string): string {
  const n = label.trim().replace(/[^\p{L}\p{N}_]+/gu, '').replace(/^[^\p{L}_]+/u, '')
  return n && !RESERVED.has(n.toLowerCase()) ? n : ''
}

export const classKey = (name: string) => `c:${name}`
export const isClassKey = (key: string) => key.startsWith('c:')
export const classOfKey = (key: string) => key.slice(2)

/** Clé de chaque relation (même position que `relations`) : `r:De>Vers:type` ou `…:type:2` pour un doublon. */
export function relationKeys(relations: Relation[]): string[] {
  const seen = new Map<string, number>()
  return relations.map((r) => {
    const base = `r:${r.from}>${r.to}:${r.type}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}:${n}`
  })
}

/** Reporte sur `fresh` (issu du texte, qui ne porte pas les positions) celles que `existing` a posées à la main. */
export function keepPositions(existing: ClassDocument, fresh: ClassDocument): ClassDocument {
  const placed = new Map(existing.classes.filter((c) => c.x !== undefined && c.y !== undefined).map((c) => [c.name, c]))
  for (const c of fresh.classes) {
    const p = placed.get(c.name)
    if (p && c.x === undefined) {
      c.x = p.x
      c.y = p.y
    }
  }
  return fresh
}

export const findClass =(doc: ClassDocument, name: string) => doc.classes.find((c) => c.name === name)

/** Texte lisible d'une relation (recherche, messages). */
export const relationLabel = (r: Relation) => `${r.from} → ${r.to}${r.label ? ` : ${r.label}` : ''}`

// --- Validation d'une donnée externe ------------------------------------------------------

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const lines = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/\r?\n/g, ' ').trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 200)
    : []

/** Reconstruit un document sûr à partir d'une donnée JSON quelconque (fichier, lien, sauvegarde). Lève une `Error` si rien n'est exploitable. */
export function sanitizeClasses(raw: unknown): ClassDocument {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as ClassDocument).classes)) throw new Error('Diagramme de classes invalide.')
  const r = raw as Record<string, unknown>
  const out = emptyClasses()
  const title = str(r.title, 120).trim()
  if (title) out.title = title
  const seen = new Set<string>()
  for (const c of (r.classes as unknown[]).slice(0, 500)) {
    if (typeof c !== 'object' || c === null) continue
    const o = c as Record<string, unknown>
    const name = str(o.name, 80).trim()
    if (!isValidName(name) || seen.has(name)) continue
    seen.add(name)
    const box: ClassBox = { name, kind: CLASS_KINDS.includes(o.kind as ClassKind) ? (o.kind as ClassKind) : 'class', attributes: lines(o.attributes), methods: lines(o.methods) }
    if (typeof o.x === 'number' && typeof o.y === 'number' && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      box.x = Math.max(0, Math.min(o.x, 100000))
      box.y = Math.max(0, Math.min(o.y, 100000))
    }
    out.classes.push(box)
  }
  if (Array.isArray(r.relations)) {
    for (const x of (r.relations as unknown[]).slice(0, 2000)) {
      if (typeof x !== 'object' || x === null) continue
      const o = x as Record<string, unknown>
      const from = str(o.from, 80)
      const to = str(o.to, 80)
      if (!seen.has(from) || !seen.has(to) || !REL_TYPES.includes(o.type as RelType)) continue
      const rel: Relation = { from, to, type: o.type as RelType }
      for (const k of ['label', 'fromMult', 'toMult'] as const) {
        const v = str(o[k], 80).trim()
        if (v) rel[k] = v
      }
      out.relations.push(rel)
    }
  }
  return out
}

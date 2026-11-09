/**
 * Modèle d'un diagramme d'états : des états (simples, de choix, fork / join, ou composites qui en contiennent d'autres)
 * et des transitions `événement [garde] / action`. Tout ici est pur (pas de Vue, pas de DOM). Le document est une donnée
 * JSON : historique, sauvegarde, partage et exports s'appuient dessus.
 *
 * Les états sont désignés par leur nom, unique dans tout le document ; les transitions par un identifiant. Une transition
 * vit dans le conteneur (la racine ou un état composite) dont ses deux extrémités sont des enfants directs, ou `[*]` :
 * `[*] --> A` est l'état initial du conteneur, `A --> [*]` son état final.
 */

export type StateKind = 'state' | 'choice' | 'fork' | 'join'
export const STATE_KINDS: StateKind[] = ['state', 'choice', 'fork', 'join']
export const KIND_LABEL: Record<StateKind, string> = { state: 'État', choice: 'Choix (losange)', fork: 'Fork (barre)', join: 'Join (barre)' }

/** Extrémité d'une transition qui désigne l'état initial (côté source) ou final (côté cible) du conteneur. */
export const PSEUDO = '[*]'

export interface Transition {
  id: string
  from: string
  to: string
  event?: string
  guard?: string
  action?: string
}

/** Ce qu'un conteneur — la racine ou un état composite — range : des états et des transitions entre eux. */
export interface Container {
  states: StateNode[]
  transitions: Transition[]
}

export interface StateNode {
  /** Identifiant utilisé dans le texte et par les transitions ; unique, sans espace. */
  name: string
  /** Texte affiché si différent du nom (`Paiement en cours`). */
  label?: string
  kind: StateKind
  /** Lignes affichées sous le nom : `entrée / initialiser`, `do / surveiller`… */
  actions?: string[]
  note?: string
  /** Présents (même vides) : l'état est composite. */
  states?: StateNode[]
  transitions?: Transition[]
}

export type Direction = 'TB' | 'LR'

export interface StateDocument extends Container {
  title?: string
  direction?: Direction
}

export interface ParseError {
  line: number
  message: string
}

export const emptyState = (): StateDocument => ({ states: [], transitions: [] })
export const isComposite = (s: StateNode): s is StateNode & Container => !!s.states

// --- Noms --------------------------------------------------------------------------

/** Mots que la saisie texte réserve : ils ne peuvent pas servir de nom d'état. */
export const RESERVED = new Set(['state', 'note', 'title', 'direction', 'as', 'of', 'left', 'right', 'end', 'classdef', 'class', 'style', 'statediagram', 'statediagram-v2'])
const NAME = /^[\p{L}_][\p{L}\p{N}_.-]*$/u
export const isValidName = (name: string) => NAME.test(name) && !name.endsWith('-') && !RESERVED.has(name.toLowerCase())

/** Nom valide dérivé d'un libellé libre (`Paiement en cours` → `Paiement_en_cours`) ; vide si rien n'est exploitable. */
export function nameFrom(label: string): string {
  const n = label.trim().replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^[^\p{L}_]+/u, '').replace(/[-_.]+$/g, '')
  return n && !RESERVED.has(n.toLowerCase()) ? n : ''
}

// --- Parcours ----------------------------------------------------------------------

export interface Located {
  state: StateNode
  /** Liste qui contient l'état et sa position. */
  list: StateNode[]
  index: number
  /** Conteneur direct : la racine, ou l'état composite qui le contient. */
  container: Container
  /** Composite parent ; absent à la racine. */
  parent?: StateNode
  depth: number
}

/** Tous les états, dans l'ordre d'affichage, un composite avant son contenu. */
export function walkStates(root: Container, visit: (loc: Located) => void, parent?: StateNode, depth = 0) {
  const container: Container = parent && isComposite(parent) ? parent : root
  container.states.forEach((state, index) => {
    visit({ state, list: container.states, index, container, parent, depth })
    if (isComposite(state)) walkStates(root, visit, state, depth + 1)
  })
}

export function findState(doc: StateDocument, name: string): Located | undefined {
  let found: Located | undefined
  walkStates(doc, (loc) => {
    if (!found && loc.state.name === name) found = loc
  })
  return found
}

export interface LocatedTransition {
  t: Transition
  list: Transition[]
  index: number
  container: Container
  /** Nom du composite qui contient la transition ; absent à la racine. */
  owner?: string
}

/** Toutes les transitions, avec leur conteneur. */
export function walkTransitions(doc: StateDocument, visit: (loc: LocatedTransition) => void) {
  const run = (c: Container, owner?: string) => {
    c.transitions.forEach((t, index) => visit({ t, list: c.transitions, index, container: c, owner }))
    for (const s of c.states) if (isComposite(s)) run(s, s.name)
  }
  run(doc)
}

export function findTransition(doc: StateDocument, id: string): LocatedTransition | undefined {
  let found: LocatedTransition | undefined
  walkTransitions(doc, (loc) => {
    if (!found && loc.t.id === id) found = loc
  })
  return found
}

export const stateLabel = (s: StateNode) => s.label ?? s.name

/** Texte d'une transition : `événement [garde] / action` (chaque partie est facultative). */
export function transitionLabel(t: Pick<Transition, 'event' | 'guard' | 'action'>): string {
  return [t.event, t.guard ? `[${t.guard}]` : '', t.action ? `/ ${t.action}` : ''].filter(Boolean).join(' ')
}

/** Libellé d'une transition pour la recherche et les listes. */
export function transitionTitle(t: Transition): string {
  const end = (n: string) => (n === PSEUDO ? '●' : n)
  const label = transitionLabel(t)
  return `${t.from === PSEUDO ? '●' : t.from} → ${t.to === PSEUDO ? '◉' : end(t.to)}${label ? ` : ${label}` : ''}`
}

// --- Validation d'une source externe -------------------------------------------

const MAX_DEPTH = 8
const MAX_STATES = 2000
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const records = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : [])
const optStr = (v: unknown) => str(v).trim() || undefined

/**
 * Valide un document venu de l'extérieur (fichier, lien, sauvegarde) : noms uniques et bien formés, transitions dont une
 * extrémité est inconnue écartées, identifiants régénérés s'ils manquent ou se répètent.
 * Lève une Error si la structure est inutilisable.
 */
export function sanitizeState(raw: unknown, makeId: () => string): StateDocument {
  if (!isRecord(raw) || !Array.isArray(raw.states) || !Array.isArray(raw.transitions)) throw new Error('Fichier invalide : états ou transitions manquants.')

  const names = new Set<string>()
  const ids = new Set<string>()
  const idOf = (v: unknown) => {
    let id = typeof v === 'string' && v && !ids.has(v) ? v : makeId()
    while (ids.has(id)) id = makeId()
    ids.add(id)
    return id
  }
  let count = 0

  const readContainer = (src: Record<string, unknown>, depth: number): Container => {
    const states: StateNode[] = []
    for (const r of records(src.states)) {
      if (++count > MAX_STATES) break
      const name = str(r.name).trim()
      if (!isValidName(name) || names.has(name.toLowerCase())) continue
      names.add(name.toLowerCase())
      const kind = STATE_KINDS.includes(r.kind as StateKind) ? (r.kind as StateKind) : 'state'
      const actions = (Array.isArray(r.actions) ? r.actions : []).map((a) => str(a).trim()).filter(Boolean)
      const label = optStr(r.label)
      const state: StateNode = { name, ...(label && label !== name ? { label } : {}), kind, ...(actions.length ? { actions } : {}), ...(optStr(r.note) ? { note: optStr(r.note) } : {}) }
      if (kind === 'state' && depth < MAX_DEPTH && (Array.isArray(r.states) || Array.isArray(r.transitions))) {
        const inner = readContainer({ states: r.states, transitions: r.transitions }, depth + 1)
        state.states = inner.states
        state.transitions = inner.transitions
      }
      states.push(state)
    }
    const here = new Set(states.map((s) => s.name))
    const transitions: Transition[] = []
    for (const r of records(src.transitions)) {
      const from = str(r.from).trim()
      const to = str(r.to).trim()
      if (!(from === PSEUDO || here.has(from)) || !(to === PSEUDO || here.has(to)) || (from === PSEUDO && to === PSEUDO)) continue
      transitions.push({ id: idOf(r.id), from, to, ...(optStr(r.event) ? { event: optStr(r.event) } : {}), ...(optStr(r.guard) ? { guard: optStr(r.guard) } : {}), ...(optStr(r.action) ? { action: optStr(r.action) } : {}) })
    }
    return { states, transitions }
  }

  const root = readContainer(raw, 0)
  const direction: Direction | undefined = raw.direction === 'LR' ? 'LR' : undefined
  return { ...(optStr(raw.title) ? { title: optStr(raw.title) } : {}), ...(direction ? { direction } : {}), ...root }
}

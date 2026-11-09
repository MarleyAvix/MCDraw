import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useHistory } from '../../composables/useHistory'
import { usePersistence } from '../../composables/usePersistence'
import { layoutState } from './layout'
import { lintState } from './lint'
import { fireTransition, initialState, optionsFrom, type SimStep } from './sim'
import {
  PSEUDO,
  emptyState,
  findState,
  findTransition,
  isComposite,
  sanitizeState,
  stateLabel,
  transitionLabel,
  transitionTitle,
  walkStates,
  walkTransitions,
  type Container,
  type Direction,
  type StateDocument,
  type StateKind,
  type StateNode,
  type Transition,
} from './model'
import { parseStateText } from './text'

const STORAGE_KEY = 'mcdraw:state:v1'
const uid = () => Math.random().toString(36).slice(2, 10)
/** Copie profonde d'une donnée JSON, y compris un objet réactif (`structuredClone` les refuse). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** Sélection d'un état : son nom précédé de `s:` (les transitions sont désignées par leur identifiant). */
export const stateKey = (name: string) => `s:${name}`
const isStateKey = (k: string) => k.startsWith('s:')

export interface StateExample {
  id: string
  label: string
  description: string
  text: string
}

export const STATE_EXAMPLES: StateExample[] = [
  {
    id: 'commande',
    label: 'Cycle de vie d’une commande',
    description: 'Choix selon le paiement, état composite pour la livraison, annulation.',
    text: `title Cycle de vie d'une commande

state Panier
state "Paiement en cours" as Paiement
state Contrôle <<choice>>
state Livraison {
  state Préparation
  state Expédiée
  [*] --> Préparation
  Préparation --> Expédiée : expédier / imprimer l'étiquette
  Expédiée --> [*] : colis remis
}
state Livrée
state Annulée

Panier : entrée / calculer le total
Paiement : do / interroger la banque

[*] --> Panier
Panier --> Paiement : payer [panier non vide]
Paiement --> Contrôle : réponse de la banque
Contrôle --> Livraison : [paiement accepté] / envoyer la confirmation
Contrôle --> Annulée : [paiement refusé]
Livraison --> Livrée : livraison confirmée
Livraison --> Annulée : annuler [pas encore expédiée] / rembourser
Livrée --> [*]
Annulée --> [*]`,
  },
  {
    id: 'ticket',
    label: 'Ticket de support',
    description: 'Allers-retours entre états, boucle sur un état, réouverture.',
    text: `title Ticket de support
direction LR

state Nouveau
state Assigné
state "En cours" as EnCours
state "En attente du client" as Attente
state Résolu
state Fermé

[*] --> Nouveau
Nouveau --> Assigné : assigner
Assigné --> EnCours : prendre en charge
EnCours --> EnCours : commenter
EnCours --> Attente : demander une précision
Attente --> EnCours : réponse du client
EnCours --> Résolu : corriger / prévenir le client
Résolu --> EnCours : réouvrir
Résolu --> Fermé : confirmer
Résolu --> Fermé : délai de 7 jours dépassé
Fermé --> [*]`,
  },
  {
    id: 'feu',
    label: 'Feu tricolore',
    description: 'Un cycle dans un état composite, et un mode panne qui l’interrompt.',
    text: `title Feu tricolore
direction LR

state Fonctionnement {
  state Rouge
  state Vert
  state Orange
  [*] --> Rouge
  Rouge --> Vert : minuterie 30 s
  Vert --> Orange : minuterie 25 s
  Orange --> Rouge : minuterie 4 s
}
state "Clignotant orange" as Panne

[*] --> Fonctionnement
Fonctionnement --> Panne : panne détectée / alerter la maintenance
Panne --> Fonctionnement : réparation`,
  },
]

interface Clip {
  states: StateNode[]
  transitions: Transition[]
}

export const useStateStore = defineStore('state', () => {
  const doc = ref<StateDocument>(emptyState())
  const selection = ref<string[]>([])
  /** Élément en cours d'édition : `s:Nom`, un identifiant de transition, ou `doc` pour les réglages généraux. */
  const editing = ref<string | null>(null)
  const showTextPanel = ref(typeof window !== 'undefined' && window.innerWidth >= 1024)
  const showTable = ref(false)
  const highlightId = ref<string | null>(null)
  const view = ref('diagram')
  /** Incrémenté quand le document est remplacé en bloc (exemple, import, effacement) : le canvas recadre alors la vue. */
  const fitTick = ref(0)
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let clipboard: Clip | null = null

  const schema = computed<StateDocument>(() => doc.value)
  const layout = computed(() => layoutState(doc.value))
  const issues = computed(() => lintState(doc.value))

  // --- Simulation : état courant et trace, hors du document (ni historique ni sauvegarde) ---------------------
  const sim = ref<{ on: boolean; current: string | null; ended: boolean; trace: SimStep[] }>({ on: false, current: null, ended: false, trace: [] })
  const simOptions = computed(() => (sim.value.on && !sim.value.ended ? optionsFrom(doc.value, sim.value.current) : []))

  function simStart() {
    sim.value = { on: true, current: initialState(doc.value), ended: false, trace: [] }
  }
  const simStop = () => (sim.value = { on: false, current: null, ended: false, trace: [] })
  function simFire(id: string) {
    const option = simOptions.value.find((o) => o.t.id === id)
    if (!option) return
    const from = sim.value.current ?? ''
    const next = fireTransition(doc.value, option.t)
    sim.value = { on: true, current: next, ended: next === null, trace: [...sim.value.trace, { from, to: next, label: transitionLabel(option.t) || 'automatique' }] }
  }
  /** Après une modification du diagramme, l'état courant peut ne plus exister : on repart du début. */
  function simRevalidate() {
    if (sim.value.on && sim.value.current && !findState(doc.value, sim.value.current)) simStart()
  }

  // --- Sélection -----------------------------------------------------------------------------
  const selectedStates = computed(() => selection.value.filter(isStateKey).map((k) => findState(doc.value, k.slice(2))).filter((l) => !!l))
  const selectedState = computed(() => selection.value.find(isStateKey)?.slice(2))
  const selectedTransitions = computed(() => selection.value.filter((k) => !isStateKey(k)).map((id) => findTransition(doc.value, id)).filter((l) => !!l))

  function flash(id: string) {
    clearTimeout(highlightTimer)
    highlightId.value = id
    highlightTimer = setTimeout(() => (highlightId.value = null), 2200)
  }

  /** Où s'ajoute le prochain état : dans le composite sélectionné, sinon à côté de l'élément sélectionné, sinon à la racine. */
  function targetContainer(): Container {
    const s = selectedStates.value.at(-1)
    if (s) return isComposite(s.state) ? s.state : s.container
    return selectedTransitions.value.at(-1)?.container ?? doc.value
  }

  const exists = (name: string) => !!findState(doc.value, name)
  function uniqueName(base: string) {
    const taken = new Set<string>()
    walkStates(doc.value, ({ state }) => taken.add(state.name.toLowerCase()))
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}${n}`
    return name
  }

  // --- États ---------------------------------------------------------------------------------
  function addState(kind: StateKind = 'state'): StateNode {
    const base = kind === 'choice' ? 'Choix' : kind === 'fork' ? 'Fork' : kind === 'join' ? 'Join' : 'État'
    const s: StateNode = { name: uniqueName(base), kind }
    const loc = selectedStates.value.at(-1)
    const container = targetContainer()
    // À côté de l'état sélectionné : juste après lui ; dans un composite : à la fin.
    const at = loc && container === loc.container ? loc.index + 1 : container.states.length
    container.states.splice(at, 0, s)
    selection.value = [stateKey(s.name)]
    editing.value = stateKey(s.name)
    return s
  }

  /** Renomme / modifie un état ; un renommage met à jour les transitions qui le citent. */
  function setState(oldName: string, next: { name: string; label?: string; kind: StateKind; actions?: string[]; note?: string; composite?: boolean }) {
    const loc = findState(doc.value, oldName)
    if (!loc) return
    const s = loc.state
    s.name = next.name
    if (next.label && next.label !== next.name) s.label = next.label
    else delete s.label
    s.kind = next.kind
    if (next.actions?.length) s.actions = next.actions
    else delete s.actions
    if (next.note) s.note = next.note
    else delete s.note
    const wantsComposite = next.composite && next.kind === 'state'
    if (wantsComposite && !s.states) {
      s.states = []
      s.transitions = []
    } else if (!wantsComposite && s.states) {
      delete s.states
      delete s.transitions
    }
    if (oldName !== next.name) {
      for (const t of loc.container.transitions) {
        if (t.from === oldName) t.from = next.name
        if (t.to === oldName) t.to = next.name
      }
      selection.value = selection.value.map((k) => (k === stateKey(oldName) ? stateKey(next.name) : k))
      if (sim.value.current === oldName) sim.value.current = next.name
    }
    // Un état sans contenu composite ne garde pas de sélection sur ses enfants disparus.
    selection.value = selection.value.filter((k) => !isStateKey(k) || exists(k.slice(2)))
    simRevalidate()
  }

  /** Noms de l'état et de tous ses descendants. */
  function subtreeNames(s: StateNode): string[] {
    const out = [s.name]
    if (isComposite(s)) for (const c of s.states) out.push(...subtreeNames(c))
    return out
  }

  /** Éléments qui disparaîtraient avec ces états : leurs descendants et les transitions qui les citent. */
  function usageOf(names: string[]): number {
    const gone = new Set(names.flatMap((n) => { const l = findState(doc.value, n); return l ? subtreeNames(l.state) : [n] }))
    let n = gone.size - names.length
    walkTransitions(doc.value, ({ t }) => {
      if (gone.has(t.from) || gone.has(t.to)) n++
    })
    return n
  }

  function removeStates(names: string[]) {
    const gone = new Set(names.flatMap((n) => { const l = findState(doc.value, n); return l ? subtreeNames(l.state) : [n] }))
    const strip = (c: Container) => {
      c.states = c.states.filter((s) => !gone.has(s.name))
      c.transitions = c.transitions.filter((t) => !gone.has(t.from) && !gone.has(t.to))
      for (const s of c.states) if (isComposite(s)) strip(s)
    }
    // `strip` remplace les tableaux des états composites : on part de la racine, qui garde sa propre identité.
    strip(doc.value)
    selection.value = selection.value.filter((k) => !isStateKey(k) || !gone.has(k.slice(2)))
    if (editing.value && isStateKey(editing.value) && gone.has(editing.value.slice(2))) editing.value = null
    selection.value = selection.value.filter((k) => isStateKey(k) || !!findTransition(doc.value, k))
    simRevalidate()
  }

  function moveStateBy(name: string, dir: -1 | 1): boolean {
    const loc = findState(doc.value, name)
    if (!loc) return false
    const j = loc.index + dir
    if (j < 0 || j >= loc.list.length) return false
    ;[loc.list[loc.index], loc.list[j]] = [loc.list[j], loc.list[loc.index]]
    return true
  }
  const canMoveState = (name: string | undefined, dir: -1 | 1) => {
    const loc = name ? findState(doc.value, name) : undefined
    return !!loc && loc.index + dir >= 0 && loc.index + dir < loc.list.length
  }

  // --- Composites ----------------------------------------------------------------------------
  /**
   * Nouveau composite. Si des états voisins sont sélectionnés, il les enveloppe — les transitions entre eux le suivent à
   * l'intérieur, celles qui arrivent ou partent de l'extérieur sont rattachées au composite — ; sinon il est vide.
   */
  function addComposite(): StateNode {
    const sel = selectedStates.value
    const composite: StateNode = { name: uniqueName('Groupe'), kind: 'state', states: [], transitions: [] }
    const containers = new Set(sel.map((l) => l.container))
    if (sel.length && containers.size === 1) {
      const { container, list } = sel[0]
      const names = new Set(sel.map((l) => l.state.name))
      const first = Math.min(...sel.map((l) => l.index))
      composite.states = [...sel].sort((a, b) => a.index - b.index).map((l) => l.state)
      container.states = list.filter((s) => !names.has(s.name))
      container.states.splice(Math.min(first, container.states.length), 0, composite)
      const inside: Transition[] = []
      const outside: Transition[] = []
      for (const t of container.transitions) {
        const a = names.has(t.from)
        const b = names.has(t.to)
        if (a && b) inside.push(t)
        else if (a) outside.push({ ...t, from: composite.name })
        else if (b) outside.push({ ...t, to: composite.name })
        else outside.push(t)
      }
      composite.transitions = inside
      container.transitions = outside
    } else {
      const container = targetContainer()
      const loc = selectedStates.value.at(-1)
      container.states.splice(loc && container === loc.container ? loc.index + 1 : container.states.length, 0, composite)
    }
    selection.value = [stateKey(composite.name)]
    editing.value = stateKey(composite.name)
    return composite
  }

  /** Nombre de transitions que dissoudre ce composite ferait disparaître (celles qui le touchent et ses points `[*]`). */
  function ungroupLoss(name: string): number {
    const loc = findState(doc.value, name)
    if (!loc || !isComposite(loc.state)) return 0
    return loc.container.transitions.filter((t) => t.from === name || t.to === name).length + loc.state.transitions!.filter((t) => t.from === PSEUDO || t.to === PSEUDO).length
  }

  /** Retire le composite mais garde ses états et les transitions entre eux, à sa place. */
  function ungroup(name: string) {
    const loc = findState(doc.value, name)
    if (!loc || !isComposite(loc.state)) return
    const inner = loc.state
    const keep = inner.transitions!.filter((t) => t.from !== PSEUDO && t.to !== PSEUDO)
    loc.list.splice(loc.index, 1, ...inner.states!)
    loc.container.transitions = loc.container.transitions.filter((t) => t.from !== name && t.to !== name).concat(keep)
    selection.value = selection.value.filter((k) => k !== stateKey(name))
    if (editing.value === stateKey(name)) editing.value = null
    simRevalidate()
  }

  // --- Transitions ---------------------------------------------------------------------------
  function addTransition(): Transition {
    const sel = selectedStates.value.at(-1)
    // Entre des états voisins : dans le conteneur de l'état sélectionné (même un composite), sinon à la racine.
    const container: Container = sel ? sel.container : (selectedTransitions.value.at(-1)?.container ?? doc.value)
    // Une transition en demande deux extrémités : on crée celles qui manquent.
    while (container.states.length < 2) container.states.push({ name: uniqueName('État'), kind: 'state' })
    const names = container.states.map((s) => s.name)
    const from = sel && names.includes(sel.state.name) ? sel.state.name : names[names.length - 2]
    const to = names[(names.indexOf(from) + 1) % names.length]
    const t: Transition = { id: uid(), from, to }
    container.transitions.push(t)
    selection.value = [t.id]
    editing.value = t.id
    return t
  }

  function setTransition(next: Transition) {
    const loc = findTransition(doc.value, next.id)
    if (loc) loc.list[loc.index] = next
  }

  function removeTransitions(ids: string[]) {
    for (const id of ids) {
      const loc = findTransition(doc.value, id)
      if (loc) loc.list.splice(loc.index, 1)
    }
    selection.value = selection.value.filter((k) => !ids.includes(k))
    if (editing.value && !isStateKey(editing.value) && editing.value !== 'doc' && !findTransition(doc.value, editing.value)) editing.value = null
  }

  /** Supprime la sélection : états (avec leurs transitions) et transitions. */
  function removeSelection() {
    const names = selection.value.filter(isStateKey).map((k) => k.slice(2))
    const ids = selection.value.filter((k) => !isStateKey(k))
    if (ids.length) removeTransitions(ids)
    if (names.length) removeStates(names)
  }

  function setMeta(meta: { title?: string; direction?: Direction }) {
    const t = meta.title?.trim()
    if (t) doc.value.title = t
    else delete doc.value.title
    if (meta.direction === 'LR') doc.value.direction = 'LR'
    else delete doc.value.direction
  }

  // --- Copier / coller / dupliquer -----------------------------------------------------------
  /** États sélectionnés dont aucun ancêtre n'est sélectionné. */
  function topStates(): StateNode[] {
    const names = new Set(selection.value.filter(isStateKey).map((k) => k.slice(2)))
    const out: StateNode[] = []
    const visit = (c: Container) => {
      for (const s of c.states) {
        if (names.has(s.name)) out.push(s)
        else if (isComposite(s)) visit(s)
      }
    }
    visit(doc.value)
    return out
  }

  function copy(): boolean {
    const states = topStates()
    if (!states.length) {
      clipboard = null
      return false
    }
    const names = new Set(states.map((s) => s.name))
    const owner = findState(doc.value, states[0].name)!.container
    clipboard = { states: clone(states), transitions: clone(owner.transitions.filter((t) => names.has(t.from) && names.has(t.to))) }
    return true
  }

  /** Insère une copie du presse-papiers dans `container`, avec des noms et des identifiants neufs. */
  function pasteInto(container: Container, clip: Clip, at: number) {
    const rename = new Map<string, string>()
    const taken = new Set<string>()
    walkStates(doc.value, ({ state }) => taken.add(state.name.toLowerCase()))
    const pick = (n: string) => {
      let name = n
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${n}${i}`
      taken.add(name.toLowerCase())
      return name
    }
    const visit = (s: StateNode) => {
      rename.set(s.name, pick(s.name))
      if (isComposite(s)) s.states.forEach(visit)
    }
    const states = clone(clip.states)
    states.forEach(visit)
    const apply = (s: StateNode) => {
      s.name = rename.get(s.name)!
      if (isComposite(s)) {
        s.transitions = s.transitions!.map((t) => ({ ...t, id: uid(), from: rename.get(t.from) ?? t.from, to: rename.get(t.to) ?? t.to }))
        s.states.forEach(apply)
      }
    }
    states.forEach(apply)
    const transitions = clone(clip.transitions).map((t) => ({ ...t, id: uid(), from: rename.get(t.from) ?? t.from, to: rename.get(t.to) ?? t.to }))
    container.states.splice(at, 0, ...states)
    container.transitions.push(...transitions)
    selection.value = states.map((s) => stateKey(s.name))
  }

  function paste(): boolean {
    if (!clipboard) return false
    const container = targetContainer()
    pasteInto(container, clipboard, container.states.length)
    return true
  }

  function duplicate() {
    if (!copy()) return
    const loc = findState(doc.value, topStates().at(-1)!.name)!
    pasteInto(loc.container, clipboard!, loc.index + 1)
  }

  function selectAll() {
    const keys: string[] = []
    walkStates(doc.value, ({ state }) => keys.push(stateKey(state.name)))
    walkTransitions(doc.value, ({ t }) => keys.push(t.id))
    selection.value = keys
  }

  // --- Recherche -----------------------------------------------------------------------------
  function searchIndex() {
    const out: { key: string; nodeId: string; label: string; context: string; kind: 'state' | 'transition' }[] = []
    walkStates(doc.value, ({ state, parent }) => {
      out.push({ key: stateKey(state.name), nodeId: stateKey(state.name), label: stateLabel(state), context: parent ? `Dans « ${parent.name} »` : state.label ? state.name : state.kind === 'state' ? 'État' : state.kind, kind: 'state' })
    })
    walkTransitions(doc.value, ({ t, owner }) => {
      out.push({ key: t.id, nodeId: t.id, label: transitionTitle(t), context: owner ? `Dans « ${owner} »` : 'Transition', kind: 'transition' })
    })
    return out
  }

  // --- Chargement ----------------------------------------------------------------------------
  function load(s: StateDocument) {
    doc.value = s
    const alive = new Set<string>()
    walkStates(s, ({ state }) => alive.add(stateKey(state.name)))
    walkTransitions(s, ({ t }) => alive.add(t.id))
    selection.value = selection.value.filter((k) => alive.has(k))
    if (editing.value && editing.value !== 'doc' && !alive.has(editing.value)) editing.value = null
    simRevalidate()
  }

  const importSchema = (raw: unknown) => {
    load(sanitizeState(raw, uid))
    fitTick.value++
  }
  const reset = () => {
    load(emptyState())
    fitTick.value++
  }
  function loadExample(id: string) {
    const ex = STATE_EXAMPLES.find((e) => e.id === id)
    if (!ex) return
    load(parseStateText(ex.text, uid).doc)
    fitTick.value++
  }

  // --- Sauvegarde locale et historique -------------------------------------------------------
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) load(sanitizeState(JSON.parse(raw), uid))
    else loadExample(STATE_EXAMPLES[0].id)
  } catch {
    loadExample(STATE_EXAMPLES[0].id)
  }
  usePersistence(schema, STORAGE_KEY)
  const { undo, redo, canUndo, canRedo } = useHistory({ state: schema, load })

  return {
    doc, selection, editing, showTextPanel, showTable, highlightId, view, fitTick, sim, simOptions,
    schema, layout, issues, selectedStates, selectedState, selectedTransitions,
    flash, simStart, simStop, simFire,
    addState, setState, usageOf, removeStates, moveStateBy, canMoveState, addComposite, ungroup, ungroupLoss,
    addTransition, setTransition, removeTransitions, removeSelection, setMeta,
    copy, paste, duplicate, selectAll, searchIndex, load, importSchema, reset, loadExample,
    undo, redo, canUndo, canRedo,
  }
})

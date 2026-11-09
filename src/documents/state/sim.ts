/**
 * Simulation d'un diagramme d'états : l'état courant avance de transition en transition. Pur : le store tient l'état courant
 * et la trace, ce module dit où l'on commence, ce qui est possible et où l'on arrive.
 */
import { PSEUDO, findState, findTransition, isComposite, type StateDocument, type Transition } from './model'

export interface SimOption {
  t: Transition
  /** État d'où part la transition : l'état courant, ou un composite qui le contient (on le quitte alors). */
  via: string
}
export interface SimStep {
  from: string
  /** `null` : la simulation s'est terminée sur l'état final. */
  to: string | null
  /** `événement [garde] / action` de la transition empruntée. */
  label: string
}

/** L'état dans lequel on entre : un composite mène à son état initial, de proche en proche. */
export function enterState(doc: StateDocument, name: string, depth = 0): string {
  const loc = findState(doc, name)
  if (!loc || !isComposite(loc.state) || depth > 12) return name
  const start = loc.state.transitions?.find((t) => t.from === PSEUDO && t.to !== PSEUDO)
  return start ? enterState(doc, start.to, depth + 1) : name
}

/** État de départ : la cible de la transition initiale de la racine, ou `null` s'il n'y en a pas. */
export function initialState(doc: StateDocument): string | null {
  const start = doc.transitions.find((t) => t.from === PSEUDO && t.to !== PSEUDO)
  return start ? enterState(doc, start.to) : null
}

/** Transitions possibles depuis l'état courant : les siennes d'abord, puis celles des composites qui le contiennent. */
export function optionsFrom(doc: StateDocument, current: string | null): SimOption[] {
  if (!current) return []
  const out: SimOption[] = []
  let loc = findState(doc, current)
  while (loc) {
    for (const t of loc.container.transitions) if (t.from === loc.state.name) out.push({ t, via: loc.state.name })
    loc = loc.parent ? findState(doc, loc.parent.name) : undefined
  }
  return out
}

/** Suit une transition : `null` si elle mène à l'état final de la racine (la simulation se termine). */
export function fireTransition(doc: StateDocument, t: Transition): string | null {
  if (t.to !== PSEUDO) return enterState(doc, t.to)
  // État final d'un composite : on est « sorti » de lui, qui devient l'état courant (ses transitions sortantes s'offrent).
  return findTransition(doc, t.id)?.owner ?? null
}

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStateStore, stateKey } from '../stateStore'
import { parseStateText, stateToText } from '../text'
import { findState, findTransition, walkStates } from '../model'

const counter = () => {
  let n = 0
  return () => `t${++n}`
}

let s: ReturnType<typeof useStateStore>
/** Remplace le document par ce texte (les identifiants de transition sont prévisibles : t1, t2…). */
const set = (text: string) => {
  s.load(parseStateText(text, counter()).doc)
  s.selection = []
}
const text = () => stateToText(s.schema)
const names = () => {
  const out: string[] = []
  walkStates(s.doc, ({ state }) => out.push(state.name))
  return out
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  s = useStateStore()
})

describe('ajout d’éléments', () => {
  it('un état s’ajoute avec un nom unique et ouvre la fenêtre d’édition', () => {
    s.reset()
    const a = s.addState()
    const b = s.addState()
    expect([a.name, b.name]).toEqual(['État', 'État2'])
    expect(s.editing).toBe(stateKey('État2'))
    expect(s.selection).toEqual([stateKey('État2')])
  })

  it('un nouvel état se place après l’état sélectionné, et dans un composite sélectionné', () => {
    set('state A\nstate B\nstate X {\n  state Y\n}')
    s.selection = [stateKey('A')]
    expect(s.addState().name).toBe('État')
    expect(names().slice(0, 3)).toEqual(['A', 'État', 'B'])
    s.selection = [stateKey('X')]
    const inside = s.addState('choice')
    expect(inside.name).toBe('Choix')
    expect(findState(s.doc, 'Choix')!.parent?.name).toBe('X')
  })

  it('une transition part de l’état sélectionné et crée les états qui manquent', () => {
    s.reset()
    const t = s.addTransition()
    expect(names()).toEqual(['État', 'État2'])
    expect(t).toMatchObject({ from: 'État', to: 'État2' })
    expect(s.editing).toBe(t.id)
    set('state A\nstate B\nstate C')
    s.selection = [stateKey('B')]
    expect(s.addTransition()).toMatchObject({ from: 'B', to: 'C' })
  })

  it('une transition entre des états d’un composite se range dans ce composite', () => {
    set('state X {\n  state A\n  state B\n}')
    s.selection = [stateKey('A')]
    const t = s.addTransition()
    expect(findTransition(s.doc, t.id)!.owner).toBe('X')
  })
})

describe('composites', () => {
  it('envelopper des états emporte leurs transitions internes et rattache les autres au composite', () => {
    set('[*] --> A\nA --> B : x\nB --> C : y\nC --> [*]')
    s.selection = [stateKey('B'), stateKey('C')]
    const g = s.addComposite()
    expect(g.states!.map((x) => x.name)).toEqual(['B', 'C'])
    expect(g.transitions!.map((t) => `${t.from}>${t.to}`)).toEqual(['B>C'])
    expect(s.doc.transitions.map((t) => `${t.from}>${t.to}`)).toEqual([`[*]>A`, `A>${g.name}`, `C>[*]`.replace('C', g.name)])
    expect(names()).toEqual(['A', g.name, 'B', 'C'])
  })

  it('dissoudre garde les états et les transitions entre eux, et retire celles qui touchaient le composite', () => {
    set('[*] --> A\nA --> X\nstate X {\n  [*] --> B\n  B --> C\n  C --> [*]\n}\nX --> [*]')
    expect(s.ungroupLoss('X')).toBe(4)
    s.ungroup('X')
    expect(names()).toEqual(['A', 'B', 'C'])
    expect(s.doc.transitions.map((t) => `${t.from}>${t.to}`)).toEqual(['[*]>A', 'B>C'])
  })
})

describe('modification', () => {
  it('renommer un état met à jour ses transitions, la sélection et la simulation', () => {
    set('[*] --> A\nA --> B : go\nB --> A')
    s.selection = [stateKey('A')]
    s.simStart()
    s.setState('A', { name: 'Début', kind: 'state', label: 'Le début' })
    expect(text()).toContain('[*] --> Début')
    expect(text()).toContain('B --> Début')
    expect(findState(s.doc, 'Début')!.state.label).toBe('Le début')
    expect(s.selection).toEqual([stateKey('Début')])
    expect(s.sim.current).toBe('Début')
  })

  it('changer le type d’un composite le vide ; décocher « composite » aussi', () => {
    set('state X {\n  state A\n}')
    s.setState('X', { name: 'X', kind: 'state', composite: false })
    expect(findState(s.doc, 'X')!.state.states).toBeUndefined()
    expect(findState(s.doc, 'A')).toBeUndefined()
    s.setState('X', { name: 'X', kind: 'state', composite: true })
    expect(findState(s.doc, 'X')!.state.states).toEqual([])
  })

  it('supprimer un état retire ses transitions et les états qu’il contient', () => {
    set('[*] --> A\nA --> X\nstate X {\n  [*] --> B\n}\nX --> A')
    expect(s.usageOf(['X'])).toBe(4) // B + 3 transitions (A→X, X→A, [*]→B)
    s.selection = [stateKey('X')]
    s.removeSelection()
    expect(names()).toEqual(['A'])
    expect(s.doc.transitions.map((t) => t.to)).toEqual(['A'])
    expect(s.selection).toEqual([])
  })

  it('supprimer une transition ne touche pas aux états', () => {
    set('A --> B')
    s.selection = ['t1']
    s.removeSelection()
    expect(s.doc.transitions).toEqual([])
    expect(names()).toEqual(['A', 'B'])
  })

  it('l’ordre des états se change, bornes comprises', () => {
    set('state A\nstate B\nstate C')
    expect(s.canMoveState('A', -1)).toBe(false)
    expect(s.canMoveState('C', 1)).toBe(false)
    s.moveStateBy('A', 1)
    expect(names()).toEqual(['B', 'A', 'C'])
  })

  it('les réglages généraux se modifient', () => {
    s.setMeta({ title: '  Mon titre ', direction: 'LR' })
    expect(s.doc.title).toBe('Mon titre')
    expect(s.doc.direction).toBe('LR')
    s.setMeta({ title: '', direction: 'TB' })
    expect(s.doc.title).toBeUndefined()
    expect(s.doc.direction).toBeUndefined()
  })
})

describe('copier, coller, dupliquer', () => {
  it('une copie reçoit des noms et des identifiants neufs, avec ses transitions internes', () => {
    set('state X {\n  [*] --> A\n  A --> B\n}\nstate Y\nX --> Y')
    s.selection = [stateKey('X')]
    s.duplicate()
    expect(names()).toEqual(['X', 'A', 'B', 'X2', 'A2', 'B2', 'Y'])
    expect(findState(s.doc, 'X2')!.state.transitions!.map((t) => `${t.from}>${t.to}`)).toEqual(['[*]>A2', 'A2>B2'])
    const ids = new Set<string>()
    for (const t of [...s.doc.transitions, ...findState(s.doc, 'X')!.state.transitions!, ...findState(s.doc, 'X2')!.state.transitions!]) ids.add(t.id)
    expect(ids.size).toBe(s.doc.transitions.length + 4)
  })

  it('copier emporte les transitions entre les états copiés, coller les insère dans le conteneur ciblé', () => {
    set('A --> B : go\nB --> C\nstate Z {\n  state W\n}')
    s.selection = [stateKey('A'), stateKey('B')]
    expect(s.copy()).toBe(true)
    s.selection = [stateKey('Z')]
    expect(s.paste()).toBe(true)
    expect(findState(s.doc, 'A2')!.parent?.name).toBe('Z')
    expect(findState(s.doc, 'Z')!.state.transitions).toHaveLength(1)
    s.selection = []
    expect(s.copy()).toBe(false)
  })
})

describe('simulation, recherche, chargement', () => {
  it('démarre à l’état initial, avance, se termine et redémarre', () => {
    set('[*] --> A\nA --> B : go\nB --> [*] : fin')
    s.simStart()
    expect(s.sim.current).toBe('A')
    expect(s.simOptions.map((o) => o.t.event)).toEqual(['go'])
    s.simFire(s.simOptions[0].t.id)
    expect(s.sim.current).toBe('B')
    s.simFire(s.simOptions[0].t.id)
    expect(s.sim.ended).toBe(true)
    expect(s.simOptions).toEqual([])
    expect(s.sim.trace.map((x) => [x.from, x.to])).toEqual([['A', 'B'], ['B', null]])
    s.simStart()
    expect(s.sim).toMatchObject({ on: true, current: 'A', ended: false, trace: [] })
    s.simStop()
    expect(s.sim.on).toBe(false)
  })

  it('ignore une transition qui n’est pas possible, et repart si l’état courant disparaît', () => {
    set('[*] --> A\nA --> B\nB --> C')
    s.simStart()
    s.simFire('t3') // B → C n'est pas possible depuis A
    expect(s.sim.current).toBe('A')
    s.simFire('t2')
    s.selection = [stateKey('B')]
    s.removeSelection()
    expect(s.sim.current).toBe('A')
  })

  it('indexe états et transitions pour la recherche', () => {
    set('state "Libellé" as A\nA --> B : go\nstate X {\n  C --> D\n}')
    const hits = s.searchIndex()
    expect(hits.map((h) => h.kind)).toEqual(['state', 'state', 'state', 'state', 'state', 'transition', 'transition'])
    expect(hits[0]).toMatchObject({ label: 'Libellé', context: 'A' })
    expect(hits.find((h) => h.label === 'C')?.context).toBe('Dans « X »')
    expect(hits.at(-1)?.context).toBe('Dans « X »')
  })

  it('un document importé est validé, un document invalide est refusé', () => {
    expect(() => s.importSchema({ nimporte: 'quoi' })).toThrow()
    s.importSchema({ states: [{ name: 'X' }], transitions: [{ from: 'X', to: 'X', event: 'boucle' }] })
    expect(names()).toEqual(['X'])
    expect(s.doc.transitions).toHaveLength(1)
  })

  it('les remarques de conception suivent le document', () => {
    set('A --> B')
    expect(s.issues.map((i) => i.rule)).toContain('no-initial')
    set('[*] --> A\nA --> B')
    expect(s.issues).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { mergeState, parseStateText, stateToText } from '../text'
import { PSEUDO, findState, findTransition, sanitizeState, walkStates, walkTransitions, type StateDocument } from '../model'
import { STATE_EXAMPLES } from '../stateStore'

const counter = () => {
  let n = 0
  return () => `t${++n}`
}
const parse = (text: string) => parseStateText(text, counter())
const names = (doc: StateDocument) => {
  const out: string[] = []
  walkStates(doc, ({ state }) => out.push(state.name))
  return out
}

describe('lecture du texte', () => {
  it('crée les états cités par les transitions, avec événement, garde et action', () => {
    const { doc, errors } = parse('[*] --> Brouillon\nBrouillon --> Envoyé : envoyer [complet] / notifier')
    expect(errors).toEqual([])
    expect(names(doc)).toEqual(['Brouillon', 'Envoyé'])
    expect(doc.transitions[0]).toMatchObject({ from: PSEUDO, to: 'Brouillon' })
    expect(doc.transitions[1]).toMatchObject({ from: 'Brouillon', to: 'Envoyé', event: 'envoyer', guard: 'complet', action: 'notifier' })
  })

  it('les trois parties de l’étiquette sont facultatives', () => {
    const t = (label: string) => parse(`A --> B${label}`).doc.transitions[0]
    expect(t('')).toMatchObject({ from: 'A', to: 'B' })
    expect(t(' : go')).toMatchObject({ event: 'go' })
    expect(t(' : [ok]')).toMatchObject({ guard: 'ok' })
    expect(t(' : / faire')).toMatchObject({ action: 'faire' })
    expect(t(' : go / faire').action).toBe('faire')
  })

  it('déclare libellé, type, actions et note', () => {
    const { doc, errors } = parse('state "Paiement en cours" as Paiement\nstate Test <<choice>>\nPaiement : entrée / initialiser\nPaiement : do / surveiller\nnote right of Paiement : à vérifier\nPaiement --> Test')
    expect(errors).toEqual([])
    const p = findState(doc, 'Paiement')!.state
    expect(p).toMatchObject({ label: 'Paiement en cours', actions: ['entrée / initialiser', 'do / surveiller'], note: 'à vérifier' })
    expect(findState(doc, 'Test')!.state.kind).toBe('choice')
  })

  it('un état composite contient ses états et ses transitions, avec son propre début et sa propre fin', () => {
    const { doc, errors } = parse('state Bloc {\n  [*] --> A\n  A --> B\n  B --> [*]\n}\n[*] --> Bloc')
    expect(errors).toEqual([])
    const bloc = findState(doc, 'Bloc')!.state
    expect(bloc.states!.map((s) => s.name)).toEqual(['A', 'B'])
    expect(bloc.transitions).toHaveLength(3)
    expect(doc.states.map((s) => s.name)).toEqual(['Bloc'])
    expect(findState(doc, 'A')!.depth).toBe(1)
  })

  it('accepte un diagramme Mermaid collé tel quel (en-tête, titre, direction, commentaires)', () => {
    const { doc, errors } = parse('---\ntitle: Mon titre\n---\nstateDiagram-v2\n  direction LR\n  %% commentaire\n  [*] --> Still\n  Still --> Moving\n  Moving --> [*]')
    expect(errors).toEqual([])
    expect(doc.title).toBe('Mon titre')
    expect(doc.direction).toBe('LR')
  })

  it('une note sur plusieurs lignes se ferme avec « end note »', () => {
    const { doc, errors } = parse('state A\nnote left of A\n  ligne un\n  ligne deux\nend note')
    expect(errors).toEqual([])
    expect(findState(doc, 'A')!.state.note).toBe('ligne un\nligne deux')
  })

  it('signale les erreurs avec leur ligne', () => {
    const e = (text: string) => parse(text).errors.map((x) => [x.line, x.message] as const)
    expect(e('A --> B\nn’importe quoi')[0][0]).toBe(2)
    expect(e('state A {\nA2 --> B2')[0][1]).toContain('pas fermé')
    expect(e('}')[0][1]).toContain('ne ferme aucun bloc')
    expect(e('[*] --> [*]')[0][1]).toContain('deux « [*] »')
    expect(e('state A\nstate A')[0][1]).toContain('déjà déclaré')
    expect(e('state A <<truc>>')[0][1]).toContain('inconnu')
    expect(e('--')[0][1]).toContain('parallèles')
    expect(e('classDef x fill:#f00')[0][1]).toContain('pas géré')
    expect(e('state Bloc {\n  A --> B\n}\nA --> C')[0][1]).toContain('autre bloc')
    expect(e('note right of A')[0][1]).toBeDefined()
  })
})

describe('écriture et fusion', () => {
  it('relire le texte écrit redonne le même document, pour chaque modèle de départ', () => {
    for (const ex of STATE_EXAMPLES) {
      const a = parse(ex.text)
      expect(a.errors, ex.id).toEqual([])
      const text = stateToText(a.doc)
      const b = parse(text)
      expect(b.errors, ex.id).toEqual([])
      // Les identifiants de transition changent d'une lecture à l'autre : on compare le texte, puis la structure sans eux.
      expect(stateToText(b.doc), ex.id).toBe(text)
      const strip = (d: StateDocument) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'id' ? undefined : v)))
      expect(strip(b.doc), ex.id).toEqual(strip(a.doc))
    }
  })

  it('écrit le texte canonique : déclarations, actions puis transitions', () => {
    const { doc } = parse('[*] --> A\nA --> B : go [ok] / x\nA : entrée / init\nstate "Libellé" as B')
    expect(stateToText(doc)).toBe('state A\nstate "Libellé" as B\nA : entrée / init\n\n[*] --> A\nA --> B : go [ok] / x')
  })

  it('la fusion garde l’identifiant des transitions inchangées', () => {
    const a = parse('A --> B : go\nB --> C').doc
    const ids = a.transitions.map((t) => t.id)
    const b = mergeState(a, parse('A --> B : go\nB --> C\nC --> A : retour').doc)
    expect(b.transitions.map((t) => t.id).slice(0, 2)).toEqual(ids)
    expect(b.transitions).toHaveLength(3)
  })

  it('la fusion apparie les transitions identiques dans l’ordre, même dans un composite', () => {
    const a = parse('state X {\n  A --> B\n  A --> B\n}').doc
    const ids = (findState(a, 'X')!.state.transitions ?? []).map((t) => t.id)
    const b = mergeState(a, parse('state X {\n  A --> B\n  A --> B\n  B --> A\n}').doc)
    expect((findState(b, 'X')!.state.transitions ?? []).map((t) => t.id).slice(0, 2)).toEqual(ids)
  })
})

describe('validation d’un fichier importé', () => {
  it('écarte les noms invalides et en double, et les transitions dont une extrémité est inconnue', () => {
    const doc = sanitizeState(
      {
        title: ' T ',
        states: [{ name: 'A' }, { name: 'a' }, { name: 'état invalide' }, { name: 'B', kind: 'choice' }, { name: 'C', states: [{ name: 'D' }], transitions: [{ from: '[*]', to: 'D' }, { from: 'D', to: 'Z' }] }],
        transitions: [{ id: 'x', from: 'A', to: 'B' }, { id: 'x', from: 'B', to: 'inconnu' }, { id: 'y', from: '[*]', to: '[*]' }, { id: 'z', from: 'A', to: '[*]' }],
      },
      counter(),
    )
    expect(names(doc)).toEqual(['A', 'B', 'C', 'D'])
    expect(doc.title).toBe('T')
    expect(doc.transitions.map((t) => [t.from, t.to])).toEqual([['A', 'B'], ['A', PSEUDO]])
    expect(new Set(doc.transitions.map((t) => t.id)).size).toBe(2)
    expect(findState(doc, 'C')!.state.transitions).toHaveLength(1)
    expect(() => sanitizeState({ states: 'non' }, counter())).toThrow()
  })

  it('un choix ne peut pas être composite', () => {
    const doc = sanitizeState({ states: [{ name: 'X', kind: 'choice', states: [{ name: 'Y' }], transitions: [] }], transitions: [] }, counter())
    expect(findState(doc, 'X')!.state.states).toBeUndefined()
  })

  it('walkTransitions parcourt aussi les composites', () => {
    const { doc } = parse('A --> B\nstate X {\n  C --> D\n}')
    const owners: (string | undefined)[] = []
    walkTransitions(doc, ({ owner }) => owners.push(owner))
    expect(owners).toEqual([undefined, 'X'])
    expect(findTransition(doc, doc.transitions[0].id)).toBeDefined()
  })
})

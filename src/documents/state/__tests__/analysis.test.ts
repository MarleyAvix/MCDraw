import { describe, expect, it } from 'vitest'
import { parseStateText } from '../text'
import { layoutState } from '../layout'
import { lintState } from '../lint'
import { enterState, fireTransition, initialState, optionsFrom } from '../sim'
import { AUTO, tableToCsv, tableToMarkdown, transitionTable } from '../table'
import { stateToMermaid } from '../mermaid'
import { stateToPlantUml } from '../plantuml'
import { STATE_EXAMPLES } from '../stateStore'
import type { StateDocument } from '../model'

const counter = () => {
  let n = 0
  return () => `t${++n}`
}
const parse = (text: string): StateDocument => {
  const { doc, errors } = parseStateText(text, counter())
  expect(errors).toEqual([])
  return doc
}
const example = (id: string) => parse(STATE_EXAMPLES.find((e) => e.id === id)!.text)
const rules = (text: string) => lintState(parse(text)).map((i) => i.rule)

describe('mise en page', () => {
  it('chaque modèle se dispose : états, transitions et cadre cohérents', () => {
    for (const ex of STATE_EXAMPLES) {
      const doc = parse(ex.text)
      const L = layoutState(doc)
      expect(L.width, ex.id).toBeGreaterThan(100)
      expect(L.height, ex.id).toBeGreaterThan(100)
      expect(L.edges.length, ex.id).toBe(doc.transitions.length + doc.states.reduce((n, s) => n + (s.transitions?.length ?? 0), 0))
      for (const e of L.edges) {
        expect(e.d, `${ex.id} ${e.id}`).toMatch(/^M/)
        expect(e.head.split(' ')).toHaveLength(3)
      }
      for (const s of L.states) {
        expect(s.x, `${ex.id} ${s.name}`).toBeGreaterThanOrEqual(0)
        expect(s.y).toBeGreaterThanOrEqual(0)
        expect(s.x + s.w, `${ex.id} ${s.name}`).toBeLessThanOrEqual(L.width)
        expect(s.y + s.h).toBeLessThanOrEqual(L.height)
      }
    }
  })

  it('un composite contient ses états, et deux états d’un même bloc ne se chevauchent pas', () => {
    const L = layoutState(example('commande'))
    const livraison = L.states.find((s) => s.name === 'Livraison')!
    const inside = L.states.filter((s) => s.depth === 1)
    expect(inside.map((s) => s.name).sort()).toEqual(['Expédiée', 'Préparation'])
    for (const s of inside) {
      expect(s.x).toBeGreaterThan(livraison.x)
      expect(s.y).toBeGreaterThan(livraison.y + livraison.headerH)
      expect(s.x + s.w).toBeLessThan(livraison.x + livraison.w)
      expect(s.y + s.h).toBeLessThan(livraison.y + livraison.h)
    }
    const roots = L.states.filter((s) => s.depth === 0)
    for (const a of roots)
      for (const b of roots)
        if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.name}/${b.name}`).toBe(true)
  })

  it('le sens de lecture change la forme du diagramme', () => {
    const text = '[*] --> A\nA --> B\nB --> C\nC --> D'
    const tb = layoutState(parse(text))
    const lr = layoutState(parse(`direction LR\n${text}`))
    expect(tb.height).toBeGreaterThan(tb.width)
    expect(lr.width).toBeGreaterThan(lr.height)
  })

  it('une boucle sur un état est dessinée à droite de l’état, avec son étiquette', () => {
    const doc = parse('state A\nA --> A : encore')
    const L = layoutState(doc)
    const a = L.states[0]
    const loop = L.edges[0]
    expect(loop.self).toBe(true)
    expect(loop.lx).toBeGreaterThan(a.x + a.w)
    expect(L.width).toBeGreaterThan(loop.lx + loop.lw / 2)
  })

  it('un titre et un document vide ne font pas échouer la mise en page', () => {
    expect(layoutState(parse('title Mon titre\nstate A')).title).toBe('Mon titre')
    const empty = layoutState({ states: [], transitions: [] })
    expect(empty.states).toEqual([])
    const lone = layoutState(parse('state Vide {\n}'))
    expect(lone.states[0].composite).toBe(true)
  })
})

describe('remarques de conception', () => {
  it('les modèles de départ n’ont aucune erreur', () => {
    for (const ex of STATE_EXAMPLES) expect(lintState(parse(ex.text)).filter((i) => i.severity === 'error'), ex.id).toEqual([])
  })

  it('signale l’absence d’état initial, les états inaccessibles et les impasses', () => {
    expect(rules('A --> B')).toContain('no-initial')
    const text = '[*] --> A\nA --> B\nB --> [*]\nstate C\nstate D\nD --> A\nstate E'
    const r = lintState(parse(text))
    expect(r.filter((i) => i.rule === 'unreachable').map((i) => i.key).sort()).toEqual(['s:C', 's:D', 's:E'])
    expect(rules('[*] --> A\nA --> B\nA --> [*]')).toContain('dead-end')
    expect(rules('[*] --> A\nA --> B')).not.toContain('dead-end') // sans état final, B peut être terminal
  })

  it('un même événement vers deux états sans garde est ambigu ; des gardes distinctes le résolvent', () => {
    expect(rules('[*] --> A\nA --> B : go\nA --> C : go')).toContain('ambiguous')
    expect(rules('[*] --> A\nA --> B : go [x]\nA --> C : go [y]')).not.toContain('ambiguous')
    expect(rules('[*] --> A\nA --> B\nA --> C')).toContain('ambiguous') // deux transitions automatiques
    expect(rules('[*] --> A\nA --> B : go\nA --> B : go')).toEqual(expect.arrayContaining(['duplicate']))
  })

  it('contrôle les choix : sorties, gardes, entrée', () => {
    expect(rules('state X <<choice>>')).toEqual(expect.arrayContaining(['choice-no-exit', 'choice-no-entry']))
    expect(rules('[*] --> X\nstate X <<choice>>\nX --> A : [ok]')).toContain('choice-one-exit')
    expect(rules('[*] --> X\nstate X <<choice>>\nX --> A : [ok]\nX --> B')).toContain('choice-guards')
    expect(rules('[*] --> X\nstate X <<choice>>\nX --> A : [ok]\nX --> B : [ko]')).not.toContain('choice-guards')
  })

  it('contrôle les composites : bloc vide, bloc sans état initial', () => {
    expect(rules('[*] --> X\nstate X {\n}')).toContain('empty-composite')
    expect(rules('[*] --> X\nstate X {\n  A --> B\n}')).toContain('no-initial')
  })

  it('un état dans un composite qui peut être quitté n’est pas une impasse', () => {
    const r = rules('[*] --> X\nstate X {\n  [*] --> A\n  A --> B\n  B --> [*]\n  state C\n  A --> C\n}\nX --> Y : sortir\nY --> [*]')
    expect(r).not.toContain('dead-end')
  })
})

describe('simulation', () => {
  it('démarre dans l’état initial et entre dans un composite par son état initial', () => {
    const doc = example('feu')
    expect(initialState(doc)).toBe('Rouge')
    expect(enterState(doc, 'Fonctionnement')).toBe('Rouge')
    expect(initialState(parse('A --> B'))).toBeNull()
  })

  it('propose les transitions de l’état puis celles de ses composites parents, et les suit', () => {
    const doc = example('feu')
    const from = optionsFrom(doc, 'Rouge')
    expect(from.map((o) => [o.t.event, o.via])).toEqual([['minuterie 30 s', 'Rouge'], ['panne détectée', 'Fonctionnement']])
    const panne = from.find((o) => o.via === 'Fonctionnement')!
    expect(fireTransition(doc, panne.t)).toBe('Panne')
    const retour = optionsFrom(doc, 'Panne')[0]
    expect(fireTransition(doc, retour.t)).toBe('Rouge') // on rentre dans le composite par son état initial
  })

  it('l’état final de la racine termine la simulation, celui d’un composite rend la main au composite', () => {
    const doc = example('commande')
    const livree = optionsFrom(doc, 'Livrée')[0]
    expect(fireTransition(doc, livree.t)).toBeNull()
    const remise = optionsFrom(doc, 'Expédiée').find((o) => o.t.to === '[*]')!
    expect(fireTransition(doc, remise.t)).toBe('Livraison')
    expect(optionsFrom(doc, 'Livraison').map((o) => o.t.to)).toEqual(expect.arrayContaining(['Livrée', 'Annulée']))
  })
})

describe('tableau des transitions', () => {
  const doc = parse('[*] --> A\nA --> B : go [ok] / x\nB --> A : retour\nB --> [*] : fin\nA --> A')

  it('une colonne par événement (les transitions automatiques en dernier), une ligne par état', () => {
    const t = transitionTable(doc)
    expect(t.events).toEqual(['go', 'retour', 'fin', AUTO])
    expect(t.rows.map((r) => r.name)).toEqual(['[*]', 'A', 'B'])
    expect(t.rows[1].cells).toEqual([['B [ok] / x'], [], [], ['A']])
    expect(t.rows[2].cells).toEqual([[], ['A'], ['◉ fin'], []])
    expect(t.rows[0].cells[3]).toEqual(['A'])
  })

  it('s’exporte en Markdown et en CSV', () => {
    const t = transitionTable(doc)
    const md = tableToMarkdown(t)
    expect(md.split('\n')[0]).toBe('| État | go | retour | fin | (automatique) |')
    expect(md).toContain('| A | B [ok] / x | — | — | A |')
    const csv = tableToCsv(t)
    expect(csv.split('\n')[0]).toBe('État,go,retour,fin,(automatique)')
    expect(csv).toContain('B [ok] / x')
  })

  it('les choix et les barres n’ont pas de ligne ; les états contenus sont indentés', () => {
    const t = transitionTable(example('commande'))
    expect(t.rows.map((r) => r.name)).not.toContain('Contrôle')
    expect(t.rows.find((r) => r.name === 'Préparation')!.depth).toBe(1)
  })
})

describe('exports', () => {
  it('Mermaid : en-tête, états déclarés, composites imbriqués, transitions', () => {
    const out = stateToMermaid(example('commande'))
    expect(out.startsWith('---\ntitle: Cycle de vie d\'une commande\n---\nstateDiagram-v2\n')).toBe(true)
    expect(out).toContain('state "Paiement en cours" as Paiement')
    expect(out).toContain('state Contrôle <<choice>>')
    expect(out).toContain('state Livraison {')
    expect(out).toContain('        [*] --> Préparation')
    expect(out).toContain('    Panier --> Paiement : payer [panier non vide]')
    expect(out).toContain('    Panier : entrée / calculer le total')
    expect(out).toContain('    Livrée --> [*]')
  })

  it('Mermaid : sens, nettoyage des identifiants et échappements', () => {
    const doc = parse('direction LR\nstate "Un ; deux" as A-1\nA-1 --> B.2 : a#b\nstate Isolé')
    const out = stateToMermaid(doc)
    expect(out).toContain('direction LR')
    expect(out).toContain('state "Un #59; deux" as A_1')
    expect(out).toContain('A_1 --> B_2 : a#35;b')
    expect(out).toContain('    Isolé') // un état isolé doit être cité pour exister
  })

  it('PlantUML : balises, composite, étiquettes', () => {
    const out = stateToPlantUml(example('feu'))
    expect(out.startsWith('@startuml\ntitle Feu tricolore\nleft to right direction\n')).toBe(true)
    expect(out).toContain('state Fonctionnement {')
    expect(out).toContain('  Rouge --> Vert : minuterie 30 s')
    expect(out).toContain('state "Clignotant orange" as Panne')
    expect(out.trimEnd().endsWith('@enduml')).toBe(true)
  })
})

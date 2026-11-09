import { describe, expect, it } from 'vitest'
import { layoutClasses } from '../layout'
import { classesToMermaid } from '../mermaid'
import { classesToPlantUml } from '../plantuml'
import { isValidName, relationKeys, sanitizeClasses } from '../model'
import { classesToText, parseClassText } from '../text'
import { CLASS_EXAMPLES } from '../classStore'

const parse = (t: string) => {
  const r = parseClassText(t)
  expect(r.errors).toEqual([])
  return r.doc
}

describe('saisie texte', () => {
  it('lit classes, membres, stéréotypes et relations', () => {
    const d = parse(`classDiagram
title Zoo
class Animal {
  <<abstract>>
  +nom: String
  +manger() void
}
Animal : +age: int
Animal <|-- Chien
Chien "1" *-- "0..*" Puce : héberge`)
    expect(d.title).toBe('Zoo')
    const animal = d.classes.find((c) => c.name === 'Animal')!
    expect(animal.kind).toBe('abstract')
    expect(animal.attributes).toEqual(['+nom: String', '+age: int'])
    expect(animal.methods).toEqual(['+manger() void'])
    expect(d.classes.map((c) => c.name)).toEqual(['Animal', 'Chien', 'Puce'])
    expect(d.relations[0]).toEqual({ from: 'Chien', to: 'Animal', type: 'inheritance' })
    // `Chien *-- Puce` : le symbole est du côté de Chien (le tout) ; les multiplicités suivent leur côté.
    expect(d.relations[1]).toEqual({ from: 'Puce', to: 'Chien', type: 'composition', label: 'héberge', fromMult: '0..*', toMult: '1' })
  })

  it('comprend le symbole écrit à droite', () => {
    const d = parse('Chien --|> Animal\nA "n" --> "1" B')
    expect(d.relations[0]).toEqual({ from: 'Chien', to: 'Animal', type: 'inheritance' })
    expect(d.relations[1]).toEqual({ from: 'A', to: 'B', type: 'association', fromMult: 'n', toMult: '1' })
  })

  it('signale les lignes illisibles et les accolades oubliées', () => {
    const r = parseClassText('classDiagram\nn’importe quoi\nclass A {\n  +x: int')
    expect(r.errors.map((e) => e.line)).toEqual([2, 4])
  })

  it('fait l’aller-retour texte → modèle → texte', () => {
    for (const ex of CLASS_EXAMPLES) {
      const d = parse(ex.text)
      const again = parse(classesToText(d))
      expect(again).toEqual(d)
    }
  })
})

describe('modèle', () => {
  it('valide les noms et distingue les relations en double', () => {
    expect(isValidName('Compte')).toBe(true)
    expect(isValidName('Compte client')).toBe(false)
    expect(isValidName('class')).toBe(false)
    expect(relationKeys([{ from: 'A', to: 'B', type: 'link' }, { from: 'A', to: 'B', type: 'link' }])).toEqual(['r:A>B:link', 'r:A>B:link:2'])
  })

  it('écarte ce qui est inutilisable dans une donnée importée', () => {
    expect(() => sanitizeClasses({})).toThrow()
    const d = sanitizeClasses({
      classes: [{ name: 'A', kind: 'inconnu', attributes: ['x', 3] }, { name: 'A' }, { name: 'mauvais nom' }],
      relations: [{ from: 'A', to: 'A', type: 'link' }, { from: 'A', to: 'Z', type: 'link' }, { from: 'A', to: 'A', type: 'nope' }],
    })
    expect(d.classes).toEqual([{ name: 'A', kind: 'class', attributes: ['x'], methods: [] }])
    expect(d.relations).toHaveLength(1)
  })
})

describe('disposition', () => {
  const doc = parse(CLASS_EXAMPLES[0].text)
  const L = layoutClasses(doc)
  const at = (n: string) => L.classes.find((c) => c.name === n)!

  it('place les parents au-dessus de leurs enfants', () => {
    expect(at('Dessinable').y).toBeLessThan(at('Forme').y)
    expect(at('Forme').y).toBeLessThan(at('Cercle').y)
    expect(at('Cercle').y).toBe(at('Rectangle').y)
  })

  it('ne fait chevaucher aucune classe', () => {
    for (const a of L.classes) for (const b of L.classes) {
      if (a === b) continue
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      expect(apart, `${a.name} / ${b.name}`).toBe(true)
    }
  })

  it('dessine un symbole creux pour l’héritage et plein pour la composition', () => {
    expect(L.relations.find((r) => r.type === 'inheritance')!.marker!.fill).toBe('hollow')
    const d2 = layoutClasses(parse('A *-- B\nA -- C'))
    expect(d2.relations[0].marker!.fill).toBe('solid')
    expect(d2.relations[1].marker).toBeNull()
  })

  it('tolère un cycle d’héritage et une relation sur soi-même', () => {
    const l = layoutClasses(parse('A <|-- B\nB <|-- A\nC --> C'))
    expect(l.classes).toHaveLength(3)
    expect(l.relations.find((r) => r.from === 'C')!.d).toContain('H')
  })
})

describe('exports', () => {
  const doc = parse(CLASS_EXAMPLES[0].text)

  it('Mermaid', () => {
    const m = classesToMermaid(doc)
    expect(m).toContain('classDiagram')
    expect(m).toContain('<<interface>>')
    expect(m).toContain('Forme <|-- Cercle')
    expect(m).toContain('Dessin "1" o-- "0..*" Forme : contient')
  })

  it('PlantUML', () => {
    const p = classesToPlantUml(doc)
    expect(p.startsWith('@startuml')).toBe(true)
    expect(p).toContain('interface Dessinable {')
    expect(p).toContain('abstract class Forme {')
    expect(p.trim().endsWith('@enduml')).toBe(true)
  })

  it('le Mermaid exporté se relit à l’identique', () => {
    expect(parse(classesToMermaid(doc))).toEqual(doc)
  })
})

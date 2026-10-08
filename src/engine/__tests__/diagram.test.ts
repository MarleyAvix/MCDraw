import { describe, expect, it } from 'vitest'
import { maxOf, meriseToDiagram, minOf, umlMultiplicity } from '../meriseToDiagram'
import type { Cardinality, Entity, Link, MeriseSchema, Relation } from '../../types/schema'

const entity = (name: string, extra: Partial<Entity> = {}): Entity => ({
  id: name,
  name,
  attributes: [{ id: `${name}.id`, name: 'id', type: 'INT', isPrimaryKey: true }],
  x: 0,
  y: 0,
  ...extra,
})
const relation = (name: string, withAttr = false): Relation => ({
  id: name,
  name,
  attributes: withAttr ? [{ id: `${name}.q`, name: 'quantite', type: 'INT', isPrimaryKey: false }] : [],
  x: 0,
  y: 0,
})
const link = (rel: string, ent: string, cardinality: Cardinality, extra: Partial<Link> = {}): Link => ({
  id: `${rel}-${ent}`,
  relationId: rel,
  entityId: ent,
  cardinality,
  ...extra,
})
const schema = (s: Partial<MeriseSchema>): MeriseSchema => ({ entities: [], relations: [], links: [], ...s })

describe('multiplicités', () => {
  it('traduit les cardinalités Merise', () => {
    expect(['0,1', '1,1', '0,n', '1,n'].map((c) => umlMultiplicity(c as Cardinality))).toEqual(['0..1', '1', '0..*', '1..*'])
    expect(minOf('0,n')).toBe('0')
    expect(maxOf('1,1')).toBe('1')
  })
})

describe('meriseToDiagram', () => {
  const base = schema({
    entities: [entity('Client'), entity('Commande')],
    relations: [relation('passer')],
    links: [link('passer', 'Client', '0,n'), link('passer', 'Commande', '1,1')],
  })

  it("dessine l'extrémité d'une entité avec la cardinalité de la patte opposée", () => {
    for (const style of ['erd', 'uml'] as const) {
      const { nodes, edges } = meriseToDiagram(base, style)
      expect(nodes.map((n) => n.id)).toEqual(['Client', 'Commande'])
      expect(edges).toHaveLength(1)
      // Client –0,n– passer –1,1– Commande : un client a 0..n commandes (côté Commande), une commande a 1 client
      expect(edges[0]).toMatchObject({ source: 'Client', target: 'Commande', sourceEnd: '1,1', targetEnd: '0,n', label: 'passer' })
    }
  })

  it('ERD : une association avec propriétés devient une entité associative', () => {
    const s = schema({
      entities: [entity('Commande'), entity('Produit')],
      relations: [relation('contenir', true)],
      links: [link('contenir', 'Commande', '0,n'), link('contenir', 'Produit', '1,n')],
    })
    const erd = meriseToDiagram(s, 'erd')
    expect(erd.nodes.find((n) => n.id === 'contenir')).toMatchObject({ kind: 'box', attributes: [{ name: 'quantite' }] })
    expect(erd.edges.map((e) => [e.variant, e.source, e.target, e.sourceEnd, e.targetEnd])).toEqual([
      ['leg', 'Commande', 'contenir', '1,1', '0,n'],
      ['leg', 'Produit', 'contenir', '1,1', '1,n'],
    ])
  })

  it("UML : une association binaire avec propriétés a une classe d'association en pointillés", () => {
    const s = schema({
      entities: [entity('Commande'), entity('Produit')],
      relations: [relation('contenir', true)],
      links: [link('contenir', 'Commande', '0,n'), link('contenir', 'Produit', '1,n')],
    })
    const uml = meriseToDiagram(s, 'uml')
    expect(uml.edges.map((e) => e.variant)).toEqual(['association', 'classLink'])
    expect(uml.edges[1].anchor).toEqual(['Commande', 'Produit'])
    expect(uml.nodes.find((n) => n.id === 'contenir')?.kind).toBe('box')
  })

  it('UML : une association ternaire est un losange avec la multiplicité de chaque patte', () => {
    const s = schema({
      entities: [entity('A'), entity('B'), entity('C')],
      relations: [relation('r')],
      links: [link('r', 'A', '0,n'), link('r', 'B', '1,1'), link('r', 'C', '1,n')],
    })
    const uml = meriseToDiagram(s, 'uml')
    expect(uml.nodes.find((n) => n.id === 'r')?.kind).toBe('diamond')
    expect(uml.edges.map((e) => e.sourceEnd)).toEqual(['0,n', '1,1', '1,n'])
    expect(uml.edges.every((e) => e.targetEnd === undefined)).toBe(true)
  })

  it("représente l'héritage de la fille vers la mère", () => {
    const s = schema({ entities: [entity('Personne'), entity('Client', { parentId: 'Personne' })] })
    expect(meriseToDiagram(s, 'uml').edges).toMatchObject([{ variant: 'inheritance', source: 'Client', target: 'Personne' }])
  })

  it('écarte les associations parallèles et marque les entités faibles', () => {
    const s = schema({
      entities: [entity('A'), entity('B')],
      relations: [relation('r1'), relation('r2')],
      links: [link('r1', 'A', '1,n'), link('r1', 'B', '1,1', { identifying: true }), link('r2', 'A', '0,n'), link('r2', 'B', '0,n')],
    })
    const { nodes, edges } = meriseToDiagram(s, 'erd')
    expect(edges.map((e) => [e.index, e.count])).toEqual([[0, 2], [1, 2]])
    expect(nodes.find((n) => n.id === 'B')?.weak).toBe(true)
  })

  it('ignore une association à moins de deux pattes', () => {
    const s = schema({ entities: [entity('A')], relations: [relation('r')], links: [link('r', 'A', '1,1')] })
    expect(meriseToDiagram(s, 'erd')).toMatchObject({ edges: [], nodes: [{ id: 'A' }] })
  })
})

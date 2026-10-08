import { describe, expect, it } from 'vitest'
import { lintSchema } from '../lintSchema'
import type { Attribute, Cardinality, Entity, Link, MeriseSchema, Relation } from '../../types/schema'

const attr = (name: string, pk = false): Attribute => ({ id: name, name, type: 'INT', isPrimaryKey: pk })
const entity = (name: string, attrs: Attribute[] = [attr(`id_${name}`, true)]): Entity => ({ id: name, name, attributes: attrs, x: 0, y: 0 })
const relation = (name: string): Relation => ({ id: name, name, attributes: [], x: 0, y: 0 })
const link = (rel: string, ent: string, cardinality: Cardinality, role?: string): Link => ({
  id: `${rel}-${ent}-${cardinality}-${role ?? ''}`,
  relationId: rel,
  entityId: ent,
  cardinality,
  role,
})
const lint = (s: Partial<MeriseSchema>, rule?: string) =>
  lintSchema({ entities: [], relations: [], links: [], ...s }).filter((i) => !rule || i.rule === rule)

describe('lintSchema', () => {
  it('ne signale rien sur un schéma sain', () => {
    expect(
      lint({
        entities: [entity('client'), entity('commande')],
        relations: [relation('passer')],
        links: [link('passer', 'client', '0,n'), link('passer', 'commande', '1,1')],
      }),
    ).toEqual([])
  })

  it('signale une entité sans clé primaire, sauf héritée ou faible', () => {
    const issues = lint({ entities: [entity('a', [attr('x')]), { ...entity('b', [attr('y')]), parentId: 'c' }, entity('c')] }, 'no-pk')
    expect(issues.map((i) => i.nodeIds)).toEqual([['a']])
    const weak = lint(
      {
        entities: [entity('ligne', [attr('no')]), entity('commande')],
        relations: [relation('contenir')],
        links: [{ ...link('contenir', 'ligne', '1,1'), identifying: true }, link('contenir', 'commande', '0,n')],
      },
      'no-pk',
    )
    expect(weak).toEqual([])
  })

  it('signale des identifiants de même nom dans des entités non reliées', () => {
    const e = [entity('a', [attr('id', true)]), entity('b', [attr('id', true)]), entity('c', [attr('id', true)])]
    const none = lint({ entities: e }, 'same-pk-name')
    expect(none).toHaveLength(1)
    expect(none[0].nodeIds.sort()).toEqual(['a', 'b', 'c'])
    // a–b reliées, c isolée : c reste en défaut avec a et b
    const some = lint({ entities: e, relations: [relation('r')], links: [link('r', 'a', '0,n'), link('r', 'b', '0,n')] }, 'same-pk-name')
    expect(some[0].nodeIds.sort()).toEqual(['a', 'b', 'c'])
    // toutes reliées : rien
    const all = lint(
      { entities: e, relations: [relation('r')], links: [link('r', 'a', '0,n'), link('r', 'b', '0,n'), link('r', 'c', '0,n')] },
      'same-pk-name',
    )
    expect(all).toEqual([])
  })

  it("accepte les identifiants de même nom entre une classe mère et sa fille", () => {
    const e = [entity('a', [attr('id', true)]), { ...entity('b', [attr('id', true)]), parentId: 'a' }]
    expect(lint({ entities: e }, 'same-pk-name')).toEqual([])
  })

  it('signale les associations orphelines, à une seule patte ou réflexives sans rôles', () => {
    const issues = lint(
      {
        entities: [entity('a'), entity('b')],
        relations: [relation('orpheline'), relation('seule'), relation('refl'), relation('refl_ok')],
        links: [
          link('seule', 'a', '0,n'),
          link('refl', 'a', '0,n'),
          link('refl', 'a', '0,1'),
          link('refl_ok', 'b', '0,n', 'chef'),
          link('refl_ok', 'b', '0,1', 'subordonné'),
        ],
      },
      'lonely-relation',
    )
    expect(issues.map((i) => i.nodeIds[0]).sort()).toEqual(['orpheline', 'refl', 'seule'])
  })

  it('détecte les dépendances cycliques (1,1) — (1,1)', () => {
    const e = [entity('a'), entity('b'), entity('c')]
    const both = lint({ entities: e, relations: [relation('r')], links: [link('r', 'a', '1,1'), link('r', 'b', '1,1')] }, 'cyclic-mandatory')
    expect(both).toHaveLength(1)
    expect(both[0].nodeIds).toEqual(expect.arrayContaining(['a', 'b', 'r']))
    // (1,1) d'un seul côté : simple dépendance, pas de cycle
    expect(lint({ entities: e, relations: [relation('r')], links: [link('r', 'a', '1,1'), link('r', 'b', '0,n')] }, 'cyclic-mandatory')).toEqual([])
    // cycle à trois : a → b → c → a
    const ring = lint(
      {
        entities: e,
        relations: [relation('r1'), relation('r2'), relation('r3')],
        links: [
          link('r1', 'a', '1,1'), link('r1', 'b', '0,n'),
          link('r2', 'b', '1,1'), link('r2', 'c', '0,n'),
          link('r3', 'c', '1,1'), link('r3', 'a', '0,n'),
        ],
      },
      'cyclic-mandatory',
    )
    expect(ring).toHaveLength(1)
    expect(ring[0].nodeIds).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })
})

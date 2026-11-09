import { describe, expect, it } from 'vitest'
import { API_EXAMPLES } from '../../api/apiStore'
import { parseApiText } from '../../api/text'
import type { ApiDocument } from '../../api/model'
import { classesFromApi } from '../fromApi'
import { classesToText, parseClassText } from '../text'

const shop = (): ApiDocument => {
  const r = parseApiText(API_EXAMPLES.find((e) => e.id === 'boutique')!.text, () => Math.random().toString(36).slice(2, 10))
  expect(r.errors).toEqual([])
  return r.api
}

describe('classesFromApi', () => {
  const doc = classesFromApi(shop())
  const cls = (n: string) => doc.classes.find((c) => c.name === n)!

  it('fait une classe par ressource, plus une énumération par champ énuméré', () => {
    expect(doc.title).toBe('API Boutique')
    expect(doc.classes.map((c) => c.name)).toEqual(['Product', 'ProductCategory', 'ProductInput', 'ProductInputCategory', 'OrderLine', 'Order', 'OrderStatus', 'OrderInput'])
    expect(cls('ProductCategory')).toMatchObject({ kind: 'enum', attributes: ['book', 'music', 'game'] })
    expect(cls('Product').kind).toBe('class')
  })

  it('écrit les champs simples en attributs, avec leur type', () => {
    expect(cls('Product').attributes).toEqual(['+id: uuid', '+name: string', '+price: number', '+stock: int', '+category: ProductCategory', '+createdAt: datetime'])
    expect(doc.relations).toContainEqual({ from: 'Product', to: 'ProductCategory', type: 'dependency' })
  })

  it('transforme une référence en association avec sa multiplicité, sans attribut redondant', () => {
    expect(doc.relations).toContainEqual({ from: 'Order', to: 'OrderLine', type: 'association', label: 'lines', toMult: '0..*' })
    expect(cls('Order').attributes.some((a) => a.includes('lines'))).toBe(false)
  })

  it('gère le facultatif, les références simples et celles vers une ressource absente', () => {
    const api: ApiDocument = {
      info: {},
      endpoints: [],
      resources: [
        { id: '1', name: 'User', fields: [{ name: 'nick', type: 'string', optional: true }, { name: 'boss', type: 'User', optional: true }, { name: 'team', type: 'Team' }, { name: 'tags', type: 'string[]' }, { name: 'ghost', type: 'Ghost' }] },
        { id: '2', name: 'Team', fields: [] },
      ],
    }
    const d = classesFromApi(api)
    expect(d.classes[0].attributes).toEqual(['+nick: string [0..1]', '+tags: string[]', '+ghost: Ghost'])
    expect(d.relations).toEqual([
      { from: 'User', to: 'User', type: 'association', label: 'boss', toMult: '0..1' },
      { from: 'User', to: 'Team', type: 'association', label: 'team', toMult: '1' },
    ])
  })

  it('ne garde que les ressources demandées, et les références vers les autres restent des attributs', () => {
    const d = classesFromApi(shop(), { only: ['Order'] })
    expect(d.classes.map((c) => c.name)).toEqual(['Order', 'OrderStatus'])
    expect(d.relations.some((r) => r.to === 'OrderLine')).toBe(false)
    expect(d.classes[0].attributes).toContain('+lines: OrderLine[]')
  })

  it('produit un document qui survit à l’aller-retour par le texte', () => {
    const again = parseClassText(classesToText(doc))
    expect(again.errors).toEqual([])
    expect(again.doc).toEqual(doc)
  })

  it('renvoie un document vide quand l’API n’a pas de ressource', () => {
    expect(classesFromApi({ info: {}, resources: [], endpoints: [] })).toEqual({ classes: [], relations: [] })
  })
})

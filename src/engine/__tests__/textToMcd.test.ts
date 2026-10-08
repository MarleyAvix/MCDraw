import { describe, expect, it } from 'vitest'
import { layoutMcd, mcdToText, parseMcdText } from '../textToMcd'
import { meriseToMld } from '../meriseToMld'
import { sanitizeSchema } from '../sanitize'
import { lintSchema } from '../lintSchema'

let n = 0
const id = () => `id${n++}`
const parse = (t: string) => parseMcdText(t, id)

const SHOP = `
// boutique
Client: #id_client, nom, email
Commande: #id_commande, date_commande:DATE
Produit: #id_produit, libelle, prix:DECIMAL(8,2)

Passer: Client 0,n -- Commande 1,1
Contenir (quantite:INT): Commande 1,n -- Produit 0,n
`

describe('parseMcdText', () => {
  it('lit entités, types, tailles et identifiants', () => {
    const { schema, errors } = parse(SHOP)
    expect(errors).toEqual([])
    expect(schema.entities.map((e) => e.name)).toEqual(['Client', 'Commande', 'Produit'])
    const client = schema.entities[0]
    expect(client.attributes.map((a) => [a.name, a.type, a.isPrimaryKey])).toEqual([
      ['id_client', 'INT', true],
      ['nom', 'VARCHAR', false],
      ['email', 'VARCHAR', false],
    ])
    expect(schema.entities[2].attributes[2]).toMatchObject({ name: 'prix', type: 'DECIMAL', size: '8,2' })
  })

  it('prend le premier attribut comme identifiant quand aucun # n’est posé', () => {
    const { schema } = parse('Livre: isbn:VARCHAR(13), titre')
    expect(schema.entities[0].attributes.map((a) => a.isPrimaryKey)).toEqual([true, false])
    expect(schema.entities[0].attributes[0]).toMatchObject({ type: 'VARCHAR', size: '13' })
  })

  it('lit cardinalités, rôles, CIF et propriétés d’association', () => {
    const { schema, errors } = parse(`
      Employe: #id, nom
      Commande: #id_commande
      Ligne: #no
      Diriger: Employe 0N chef -- Employe 0..1 subordonne
      Contenir (quantite:INT): Ligne 1,1 CIF -- Commande 0,n
    `)
    expect(errors).toEqual([])
    const [diriger, contenir] = schema.relations
    const legs = (r: typeof diriger) => schema.links.filter((l) => l.relationId === r.id)
    expect(legs(diriger).map((l) => [l.cardinality, l.role])).toEqual([['0,n', 'chef'], ['0,1', 'subordonne']])
    expect(legs(contenir)[0]).toMatchObject({ cardinality: '1,1', identifying: true })
    expect(contenir.attributes[0]).toMatchObject({ name: 'quantite', type: 'INT', isPrimaryKey: false })
  })

  it('lit l’héritage : la classe fille n’a pas d’identifiant propre', () => {
    const { schema, errors } = parse('Personne: #id, nom\nEtudiant < Personne: numero')
    expect(errors).toEqual([])
    const [p, e] = schema.entities
    expect(e.parentId).toBe(p.id)
    expect(e.attributes.some((a) => a.isPrimaryKey)).toBe(false)
  })

  it('signale les erreurs avec leur numéro de ligne', () => {
    const { errors } = parse(`A: #x
B: #y:BIGTHING
C: z, w w
P: A 0,n -- Z 1,1
Q: A 0,n -- A 2,9
A: #dup
???`)
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7])
    expect(errors[0].message).toContain('BIGTHING')
    expect(errors[2].message).toContain('Z')
  })

  it('produit un schéma accepté par sanitizeSchema et par le MLD', () => {
    const { schema } = parse(SHOP)
    const clean = sanitizeSchema(layoutMcd(schema), id)
    const mld = meriseToMld(clean)
    expect(mld.warnings).toEqual([])
    expect(mld.tables.map((t) => t.name).sort()).toEqual(['client', 'commande', 'commande_produit', 'produit'])
    expect(lintSchema(clean)).toEqual([])
  })
})

describe('layoutMcd', () => {
  it('place les nœuds sans chevauchement et oriente les pattes', () => {
    const laid = layoutMcd(parse(SHOP).schema)
    const nodes = [...laid.entities, ...laid.relations]
    expect(new Set(nodes.map((x) => `${Math.round(x.x)},${Math.round(x.y)}`)).size).toBe(nodes.length)
    expect(laid.links.every((l) => l.entityHandle && l.relationHandle)).toBe(true)
  })

  it('applique un décalage d’origine', () => {
    const base = layoutMcd(parse(SHOP).schema)
    const moved = layoutMcd(parse(SHOP).schema, { x: 1000, y: 500 })
    expect(moved.entities[0].x - base.entities[0].x).toBe(1000)
    expect(moved.entities[0].y - base.entities[0].y).toBe(500)
  })
})

describe('mcdToText', () => {
  it('fait un aller-retour sans perte', () => {
    const first = parse(SHOP).schema
    const text = mcdToText(first)
    const second = parse(text)
    expect(second.errors).toEqual([])
    expect(mcdToText(second.schema)).toBe(text)
    expect(text).toContain('Contenir (quantite:INT): Commande 1,n -- Produit 0,n')
    expect(text).toContain('prix:DECIMAL(8,2)')
  })

  it('conserve héritage, rôles et CIF', () => {
    const src = 'P: #id\nE < P: n\nR: E 1,1 CIF -- P 0,n chef\n'
    expect(mcdToText(parse(src).schema)).toBe('P: #id\nE < P: n\n\nR: E 1,1 CIF -- P 0,n chef\n')
  })
})

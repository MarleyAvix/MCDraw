import { describe, expect, it } from 'vitest'
import { parseMcdText } from '../textToMcd'
import { meriseToMld, sqlServerCascadeWarnings } from '../meriseToMld'
import type { MldTable, RefAction } from '../../types/schema'

let n = 0
const mldOf = (text: string, action: RefAction) => {
  const { schema } = parseMcdText(text, () => `id${n++}`)
  schema.links.forEach((l) => (l.onDelete = action))
  return meriseToMld(schema)
}
const warnings = (text: string, action: RefAction) => sqlServerCascadeWarnings(mldOf(text, action).tables)

const REFLEXIVE = `
Employé: #id_employe, nom
Encadrer: Employé 0,n manager -- Employé 0,1 collaborateur
`
// Pays → Ville → Adresse, et Pays → Adresse directement : deux chemins de cascade vers Adresse.
const TWO_PATHS = `
Pays: #id_pays, nom
Ville: #id_ville, nom
Adresse: #id_adresse, rue
Situer: Pays 0,n -- Ville 1,1
Localiser: Ville 0,n -- Adresse 1,1
Rattacher: Pays 0,n -- Adresse 1,1
`
const SIMPLE = `
Client: #id_client, nom
Commande: #id_commande, date_commande:DATE
Passer: Client 0,n -- Commande 1,1
`

describe('avertissements SQL Server sur les cascades', () => {
  it('table qui se référence elle-même avec CASCADE', () => {
    expect(warnings(REFLEXIVE, 'CASCADE')).toHaveLength(1)
    expect(warnings(REFLEXIVE, 'SET NULL')).toHaveLength(1)
  })
  it('plusieurs chemins de cascade vers une même table', () => {
    const w = warnings(TWO_PATHS, 'CASCADE')
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('plusieurs chemins')
  })
  it('RESTRICT ne pose jamais de problème', () => {
    expect(warnings(REFLEXIVE, 'RESTRICT')).toEqual([])
    expect(warnings(TWO_PATHS, 'RESTRICT')).toEqual([])
  })
  it('une cascade simple est acceptée', () => {
    expect(warnings(SIMPLE, 'CASCADE')).toEqual([])
  })
  it('ne figure pas dans les avertissements généraux du MLD (propre au dialecte SQL Server)', () => {
    expect(mldOf(TWO_PATHS, 'CASCADE').warnings.some((w) => w.startsWith('SQL Server'))).toBe(false)
  })
  it('reste rapide sur des cascades en losanges empilés (2^40 chemins)', () => {
    const fk = (ref: string) => ({ columns: [`id_${ref}`], refTable: ref, refColumns: ['id'], onDelete: 'CASCADE' as const })
    const table = (name: string, refs: string[]): MldTable => ({ name, origin: 'entity', sourceId: name, columns: [], primaryKey: ['id'], foreignKeys: refs.map(fk) })
    const tables = [table('t0', [])]
    for (let k = 1; k <= 40; k++) tables.push(table(`a${k}`, [`t${k - 1}`]), table(`b${k}`, [`t${k - 1}`]), table(`t${k}`, [`a${k}`, `b${k}`]))
    const t0 = performance.now()
    const w = sqlServerCascadeWarnings(tables)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(w.length).toBeGreaterThan(0)
    expect(w.every((x) => x.includes('plusieurs chemins'))).toBe(true)
  })
})

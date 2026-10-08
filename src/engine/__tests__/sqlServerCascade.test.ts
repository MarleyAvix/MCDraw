import { describe, expect, it } from 'vitest'
import { parseMcdText } from '../textToMcd'
import { meriseToMld } from '../meriseToMld'
import type { RefAction } from '../../types/schema'

let n = 0
const warnings = (text: string, action: RefAction) => {
  const { schema } = parseMcdText(text, () => `id${n++}`)
  schema.links.forEach((l) => (l.onDelete = action))
  return meriseToMld(schema).warnings.filter((w) => w.startsWith('SQL Server'))
}

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
})

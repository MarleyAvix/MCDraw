import { describe, expect, it } from 'vitest'
import { buildTemplate, TEMPLATE_DEFS } from '../templates'
import { lintSchema } from '../lintSchema'
import { meriseToMld } from '../meriseToMld'
import { mldToSql, SQL_DIALECTS } from '../mldToSql'
import { sanitizeSchema } from '../sanitize'

const counter = () => {
  let n = 0
  return () => `n${n++}`
}

describe.each(TEMPLATE_DEFS)('modèle « $label »', (def) => {
  const schema = buildTemplate(def, counter())

  it('se construit sans erreur et avec des identifiants uniques', () => {
    const ids = [...schema.entities, ...schema.relations, ...schema.links].map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(schema.entities.length).toBeGreaterThanOrEqual(6)
  })

  it('ne déclenche aucun avertissement de conception', () => {
    expect(lintSchema(schema).filter((i) => i.severity === 'warning')).toEqual([])
  })

  it('donne un MLD sans avertissement et du SQL pour chaque dialecte', () => {
    const mld = meriseToMld(schema)
    expect(mld.warnings).toEqual([])
    for (const dialect of SQL_DIALECTS) expect(mldToSql(mld, { dialect, autoIncrement: true })).toContain('CREATE TABLE')
  })

  it('survit à la validation d’import (sauvegarde locale)', () => {
    const back = sanitizeSchema(JSON.parse(JSON.stringify(schema)), counter())
    expect(back.entities.length).toBe(schema.entities.length)
    expect(back.entities.flatMap((e) => e.attributes).filter((a) => a.unique || a.check || a.defaultValue).length).toBeGreaterThan(0)
  })

  it('pose des positions distinctes', () => {
    const pos = new Set([...schema.entities, ...schema.relations].map((n) => `${n.x},${n.y}`))
    expect(pos.size).toBe(schema.entities.length + schema.relations.length)
  })
})

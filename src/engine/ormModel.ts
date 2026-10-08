import type { MldColumn, MldResult, MldTable } from '../types/schema'
import { pascal } from './mldToEfCore'

/** Identifiant camelCase d'une colonne ou d'une navigation : id_client → idClient. */
export function camel(s: string): string {
  const p = pascal(s)
  return p[0].toLowerCase() + p.slice(1)
}

/** Retire un éventuel préfixe / suffixe d'identifiant : id_client → client, client_id → client. */
const stripId = (col: string) => col.replace(/^id_/i, '').replace(/_id$/i, '')

export interface OrmRel {
  fk: MldTable['foreignKeys'][number]
  host: MldTable
  target: MldTable
  /** Propriété de navigation côté table qui porte la clé étrangère. */
  field: string
  /** Navigation inverse côté table référencée : collection, ou référence simple en 1–1. */
  inverse: string
  nullable: boolean
  /** Relation 1–1 : clé étrangère unique, ou confondue avec la clé primaire. */
  oneToOne: boolean
  /** Nom de relation, nécessaire dès que deux tables sont reliées plusieurs fois (ou une table à elle-même). */
  name?: string
}

export interface OrmModel {
  className: Map<string, string>
  /** table → colonne → propriété. */
  props: Map<string, Map<string, string>>
  rels: OrmRel[]
}

/** Noms de classes / propriétés et relations déduites des clés étrangères, communs aux exports Prisma et TypeORM. */
export function ormModel(mld: MldResult): OrmModel {
  const tables = mld.tables
  const className = new Map(tables.map((t) => [t.name, pascal(t.name)]))
  const props = new Map<string, Map<string, string>>()
  const taken = new Map<string, Set<string>>()
  for (const t of tables) {
    const used = new Set<string>()
    const m = new Map<string, string>()
    for (const c of t.columns) {
      let p = camel(c.name)
      while (used.has(p)) p += '_'
      used.add(p)
      m.set(c.name, p)
    }
    props.set(t.name, m)
    taken.set(t.name, used)
  }
  const unique = (table: string, base: string) => {
    const used = taken.get(table)!
    let n = base
    for (let i = 2; used.has(n); i++) n = `${base}${i}`
    used.add(n)
    return n
  }

  const byName = new Map(tables.map((t) => [t.name, t]))
  const rels: OrmRel[] = []
  for (const host of tables) {
    for (const fk of host.foreignKeys) {
      const target = byName.get(fk.refTable)!
      let stem = ''
      if (fk.columns.length === 1) {
        const [col] = fk.columns
        const [ref] = fk.refColumns
        // chef_id_employe référence id_employe : le rôle « chef » donne le nom de navigation
        stem = camel(col !== ref && col.endsWith(`_${ref}`) ? col.slice(0, -(ref.length + 1)) : stripId(col))
      }
      const base = stem && stem !== camel(host.name) ? stem : camel(target.name)
      const field = unique(host.name, base)
      const oneToOne =
        !!fk.unique || (fk.columns.length === host.primaryKey.length && fk.columns.every((c) => host.primaryKey.includes(c)))
      const inverse = unique(target.name, `${camel(host.name)}${oneToOne ? '' : 's'}`)
      const nullable = fk.columns.some((c) => host.columns.find((x) => x.name === c)!.nullable)
      rels.push({ fk, host, target, field, inverse, nullable, oneToOne })
    }
  }

  const pairKey = (r: OrmRel) => [r.host.name, r.target.name].sort().join('\u0000')
  const perPair = new Map<string, number>()
  for (const r of rels) perPair.set(pairKey(r), (perPair.get(pairKey(r)) ?? 0) + 1)
  for (const r of rels) {
    if (r.host === r.target || perPair.get(pairKey(r))! > 1) r.name = `${className.get(r.host.name)}_${r.field}`
  }
  return { className, props, rels }
}

export const precisionOf = (c: MldColumn): [number, number | null] | null => {
  const m = /^DECIMAL\((\d+)(?:,\s*(\d+))?\)$/.exec(c.sqlType)
  return m ? [Number(m[1]), m[2] ? Number(m[2]) : null] : null
}

export const lengthOf = (c: MldColumn): number | null => {
  const m = /^VARCHAR\((\d+)\)$/.exec(c.sqlType)
  return m ? Number(m[1]) : null
}

export const baseType = (c: MldColumn) => c.sqlType.replace(/\(.*\)$/, '')

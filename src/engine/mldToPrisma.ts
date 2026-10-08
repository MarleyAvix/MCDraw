import type { MldColumn, MldResult } from '../types/schema'
import { isAutoIncrement, sqlDefault, type SqlDialect, type SqlOptions } from './mldToSql'
import { baseType, lengthOf, ormModel, precisionOf } from './ormModel'

const PROVIDERS: Record<SqlDialect, string> = {
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlite: 'sqlite',
  sqlserver: 'sqlserver',
  standard: 'postgresql',
}

export const PRISMA_VERSIONS = { '7': 'Prisma 7', '6': 'Prisma 5 / 6' } as const
export type PrismaVersion = keyof typeof PRISMA_VERSIONS

const PRISMA_ACTION = { 'NO ACTION': 'NoAction', RESTRICT: 'Restrict', CASCADE: 'Cascade', 'SET NULL': 'SetNull' } as const

function prismaType(c: MldColumn): string {
  switch (baseType(c)) {
    case 'INT':
      return 'Int'
    case 'DECIMAL':
      return 'Decimal'
    case 'FLOAT':
      return 'Float'
    case 'BOOLEAN':
      return 'Boolean'
    case 'DATE':
    case 'DATETIME':
      return 'DateTime'
    default:
      return 'String'
  }
}

/** Attribut natif (@db.*) qui conserve la longueur / précision / sous-type SQL ; SQLite n'en a pas. */
function nativeType(c: MldColumn, dialect: SqlDialect): string | null {
  if (dialect === 'sqlite') return null
  const len = lengthOf(c)
  if (len) return `@db.VarChar(${len})`
  const prec = precisionOf(c)
  if (prec) return `@db.Decimal(${prec[0]}, ${prec[1] ?? 0})`
  const base = baseType(c)
  if (base === 'TEXT') return dialect === 'sqlserver' ? '@db.NVarChar(Max)' : '@db.Text'
  if (base === 'DATE') return '@db.Date'
  return null
}

const str = (s: string) => JSON.stringify(s)

function prismaDefault(c: MldColumn, dialect: SqlDialect): string | null {
  if (!c.defaultValue?.trim()) return null
  const v = c.defaultValue.trim()
  const temporal = c.dataType === 'DATE' || c.dataType === 'DATETIME'
  if (/^(CURRENT_TIMESTAMP|NOW\(\))$/i.test(v)) return 'now()'
  if (c.dataType === 'BOOLEAN' && /^(true|false|0|1)$/i.test(v)) return /^(true|1)$/i.test(v) ? 'true' : 'false'
  if (!temporal) {
    if (/^[+-]?\d+(\.\d+)?$/.test(v)) return v
    const quoted = /^'(.*)'$/s.exec(v)
    if (quoted) return str(quoted[1].replace(/''/g, "'"))
    if (!/^[A-Za-z_][A-Za-z0-9_.]*\(.*\)$/s.test(v) && !/^CURRENT_/i.test(v)) return str(v)
  }
  return `dbgenerated(${str(sqlDefault(v, c, dialect))})`
}

/** Génère un schéma Prisma (`schema.prisma`) : modèles, relations nommées si nécessaire, correspondance avec les noms SQL via @map / @@map. */
export function mldToPrisma(mld: MldResult, options: Partial<SqlOptions> & { version?: PrismaVersion } = {}): string {
  const o = { dialect: 'standard', autoIncrement: false, version: '7', ...options } as SqlOptions & { version: PrismaVersion }
  const tables = mld.tables
  if (!tables.length) return '// Aucune table : ajoutez des entités au MCD.\n'

  const { className, props, rels } = ormModel(mld)
  const lines: string[] = []

  // Prisma 7 : générateur `prisma-client` (sortie obligatoire) et URL de connexion déplacée dans prisma.config.ts.
  if (o.version === '7') {
    lines.push('generator client {', '  provider = "prisma-client"', '  output   = "../generated/prisma"', '}', '')
    lines.push('datasource db {', `  provider = "${PROVIDERS[o.dialect]}"`, '}')
  } else {
    lines.push('generator client {', '  provider = "prisma-client-js"', '}', '')
    lines.push('datasource db {', `  provider = "${PROVIDERS[o.dialect]}"`, '  url      = env("DATABASE_URL")', '}')
  }

  for (const t of tables) {
    const cls = className.get(t.name)!
    const p = props.get(t.name)!
    const rows: string[][] = [] // [champ, type, attributs]
    const block: string[] = []
    const comments: string[] = []

    const single = t.primaryKey.length === 1
    for (const c of t.columns) {
      const field = p.get(c.name)!
      const isPk = t.primaryKey.includes(c.name)
      const fkUnique = t.foreignKeys.some((f) => f.unique && f.columns.length === 1 && f.columns[0] === c.name)
      const attrs: string[] = []
      if (isPk && single) attrs.push('@id')
      const def = o.autoIncrement && isAutoIncrement(t, c) ? 'autoincrement()' : prismaDefault(c, o.dialect)
      if (def) attrs.push(`@default(${def})`)
      if ((c.unique || fkUnique) && !(isPk && single)) attrs.push('@unique')
      if (field !== c.name) attrs.push(`@map(${str(c.name)})`)
      const native = nativeType(c, o.dialect)
      if (native) attrs.push(native)
      if (c.check) comments.push(`  // CHECK ${c.name} : ${c.check} (non géré par Prisma, à ajouter dans une migration SQL)`)
      rows.push([field, prismaType(c) + (c.nullable && !isPk ? '?' : ''), attrs.join(' ')])
    }

    for (const r of rels.filter((x) => x.host === t || x.target === t)) {
      const targetCls = className.get(r.target.name)!
      const hostCls = className.get(r.host.name)!
      const relName = r.name ? `${str(r.name)}, ` : ''
      if (r.host === t) {
        const args = [
          `fields: [${r.fk.columns.map((c) => p.get(c)).join(', ')}]`,
          `references: [${r.fk.refColumns.map((c) => props.get(r.target.name)!.get(c)).join(', ')}]`,
          `onDelete: ${PRISMA_ACTION[r.fk.onDelete ?? 'RESTRICT']}`,
          ...(r.fk.onUpdate ? [`onUpdate: ${PRISMA_ACTION[r.fk.onUpdate]}`] : []),
        ]
        rows.push([r.field, targetCls + (r.nullable ? '?' : ''), `@relation(${relName}${args.join(', ')})`])
      }
      if (r.target === t) {
        rows.push([r.inverse, r.oneToOne ? `${hostCls}?` : `${hostCls}[]`, r.name ? `@relation(${str(r.name)})` : ''])
      }
    }

    const w0 = Math.max(...rows.map((r) => r[0].length))
    const w1 = Math.max(...rows.map((r) => r[1].length))
    for (const [f, ty, at] of rows) block.push(`  ${f.padEnd(w0)} ${at ? ty.padEnd(w1) + ' ' + at : ty}`)

    const tail: string[] = []
    if (t.primaryKey.length > 1) tail.push(`  @@id([${t.primaryKey.map((k) => p.get(k)).join(', ')}])`)
    else if (!t.primaryKey.length) comments.push('  // Prisma exige une clé primaire ou un @@unique : aucune clé définie dans le MLD.')
    for (const fk of t.foreignKeys.filter((f) => f.unique && f.columns.length > 1)) {
      tail.push(`  @@unique([${fk.columns.map((c) => p.get(c)).join(', ')}])`)
    }
    if (t.name !== cls) tail.push(`  @@map(${str(t.name)})`)

    lines.push('', `model ${cls} {`, ...block, ...(tail.length ? ['', ...tail] : []), ...comments, '}')
  }

  return lines.join('\n') + '\n'
}

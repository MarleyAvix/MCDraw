import type { MldColumn, MldResult, MldTable } from '../types/schema'

export const SQL_DIALECTS = ['mysql', 'postgresql', 'sqlite', 'sqlserver', 'standard'] as const
export type SqlDialect = (typeof SQL_DIALECTS)[number]

export const DIALECT_LABELS: Record<SqlDialect, string> = {
  mysql: 'MySQL / MariaDB',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
  standard: 'SQL standard',
}

export interface SqlOptions {
  dialect: SqlDialect
  /** Rend auto-incrémentées les clés primaires simples de type INT des entités. */
  autoIncrement: boolean
}

const DEFAULTS: SqlOptions = { dialect: 'standard', autoIncrement: false }

/** Adapte un type générique (INT, DATETIME…) au dialecte cible. */
function mapType(sqlType: string, dialect: SqlDialect): string {
  const base = sqlType.replace(/\(.*\)$/, '')
  const args = sqlType.slice(base.length)
  switch (dialect) {
    case 'postgresql':
      if (base === 'DATETIME') return 'TIMESTAMP'
      if (base === 'FLOAT') return 'DOUBLE PRECISION'
      break
    case 'sqlite':
      if (base === 'INT' || base === 'BOOLEAN') return 'INTEGER'
      if (base === 'DATE' || base === 'DATETIME') return 'TEXT'
      if (base === 'DECIMAL') return `NUMERIC${args}`
      if (base === 'FLOAT') return 'REAL'
      break
    case 'sqlserver':
      if (base === 'BOOLEAN') return 'BIT'
      if (base === 'DATETIME') return 'DATETIME2'
      if (base === 'TEXT') return 'NVARCHAR(MAX)'
      if (base === 'VARCHAR') return `NVARCHAR${args}`
      break
    case 'mysql':
    case 'standard':
      break
  }
  return sqlType
}

const isAutoIncrement = (t: MldTable, c: MldColumn) =>
  t.origin === 'entity' && t.primaryKey.length === 1 && c.isPrimaryKey && !c.isForeignKey && c.sqlType === 'INT'

function columnSql(t: MldTable, c: MldColumn, o: SqlOptions): string {
  const auto = o.autoIncrement && isAutoIncrement(t, c)
  let type = mapType(c.sqlType, o.dialect)
  let suffix = c.nullable ? '' : ' NOT NULL'
  if (auto) {
    switch (o.dialect) {
      case 'mysql':
        suffix += ' AUTO_INCREMENT'
        break
      case 'postgresql':
        type = 'SERIAL'
        suffix = ''
        break
      case 'sqlserver':
        suffix += ' IDENTITY(1,1)'
        break
      case 'sqlite':
        return `  ${c.name} INTEGER PRIMARY KEY AUTOINCREMENT`
      case 'standard':
        suffix += ' GENERATED ALWAYS AS IDENTITY'
        break
    }
  }
  return `  ${c.name} ${type}${suffix}`
}

function fkSql(t: MldTable, i: number, name: string): string {
  const fk = t.foreignKeys[i]
  return `CONSTRAINT ${name} FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.refTable} (${fk.refColumns.join(', ')})`
}

function renderTable(t: MldTable, names: string[], deferred: Set<string>, o: SqlOptions): string {
  const sqliteInlinePk =
    o.dialect === 'sqlite' && o.autoIncrement && t.columns.some((c) => isAutoIncrement(t, c))
  const lines = t.columns.map((c) => columnSql(t, c, o))
  if (t.primaryKey.length && !sqliteInlinePk) lines.push(`  PRIMARY KEY (${t.primaryKey.join(', ')})`)
  t.foreignKeys.forEach((_, i) => {
    if (!deferred.has(names[i])) lines.push(`  ${fkSql(t, i, names[i])}`)
  })
  return `CREATE TABLE ${t.name} (\n${lines.join(',\n')}\n);`
}

/** Convertit le MLD en script SQL DDL. Les dépendances cycliques passent en ALTER TABLE. */
export function mldToSql(mld: MldResult, options: Partial<SqlOptions> = {}): string {
  const o: SqlOptions = { ...DEFAULTS, ...options }
  const tables = mld.tables
  if (!tables.length) return '-- Aucune table : ajoutez des entités au MCD.\n'

  const fkNames = new Map<MldTable, string[]>(
    tables.map((t) => [
      t,
      t.foreignKeys.map((fk, i) => {
        const nth = t.foreignKeys.slice(0, i).filter((f) => f.refTable === fk.refTable).length
        return `fk_${t.name}_${fk.refTable}${nth ? `_${nth + 1}` : ''}`
      }),
    ]),
  )

  // Tri topologique ; les auto-références sont ignorées, les cycles sont différés en ALTER TABLE.
  const created = new Set<string>()
  const ordered: MldTable[] = []
  const deferred = new Set<string>()
  let pending = [...tables]
  while (pending.length) {
    let ready = pending.filter((t) => t.foreignKeys.every((fk) => fk.refTable === t.name || created.has(fk.refTable)))
    if (!ready.length) {
      const t = pending[0]
      t.foreignKeys.forEach((fk, i) => {
        if (fk.refTable !== t.name && !created.has(fk.refTable)) deferred.add(fkNames.get(t)![i])
      })
      ready = [t]
    }
    for (const t of ready) {
      ordered.push(t)
      created.add(t.name)
    }
    pending = pending.filter((t) => !ready.includes(t))
  }

  const parts = ordered.map((t) => renderTable(t, fkNames.get(t)!, deferred, o))
  for (const t of tables) {
    fkNames.get(t)!.forEach((n, i) => {
      if (deferred.has(n)) parts.push(`ALTER TABLE ${t.name}\n  ADD ${fkSql(t, i, n)};`)
    })
  }
  return `-- Script généré par MCDraw (${DIALECT_LABELS[o.dialect]})\n\n${parts.join('\n\n')}\n`
}

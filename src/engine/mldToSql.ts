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

/** Mots réservés de MySQL, PostgreSQL, SQL Server, SQLite et du SQL standard, interdits comme identifiants nus. */
const RESERVED = new Set(
  `ACCESSIBLE ADD ALL ALTER ANALYSE ANALYZE AND ANY ARRAY AS ASC ASENSITIVE ASYMMETRIC AUTHORIZATION BACKUP BEFORE BEGIN
  BETWEEN BIGINT BINARY BLOB BOTH BREAK BROWSE BULK BY CALL CASCADE CASE CAST CHANGE CHAR CHARACTER CHECK CHECKPOINT CLOSE
  CLUSTERED COALESCE COLLATE COLLATION COLUMN COMMIT COMPUTE CONCURRENTLY CONDITION CONSTRAINT CONTAINS CONTINUE CONVERT
  CREATE CROSS CUBE CUME_DIST CURRENT CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE CURRENT_SCHEMA CURRENT_TIME
  CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DATABASES DBCC DEALLOCATE DEC DECIMAL DECLARE DEFAULT DEFERRABLE DELAYED
  DELETE DENSE_RANK DENY DESC DESCRIBE DETERMINISTIC DISK DISTINCT DISTINCTROW DISTRIBUTED DIV DO DOUBLE DROP DUAL DUMP EACH
  ELSE ELSEIF EMPTY ENCLOSED END ERRLVL ESCAPE ESCAPED EXCEPT EXEC EXECUTE EXISTS EXIT EXPLAIN EXTERNAL FALSE FETCH FILE
  FILLFACTOR FIRST_VALUE FLOAT FOR FORCE FOREIGN FREETEXT FREEZE FROM FULL FULLTEXT FUNCTION GENERATED GET GOTO GRANT GROUP
  GROUPING GROUPS HAVING HIGH_PRIORITY HOLDLOCK IDENTITY IDENTITYCOL IF IGNORE ILIKE IN INDEX INFILE INITIALLY INNER INOUT
  INSENSITIVE INSERT INT INTEGER INTERSECT INTERVAL INTO IS ISNULL ITERATE JOIN JSON_TABLE KEY KEYS KILL LAG LAST_VALUE
  LATERAL LEAD LEADING LEAVE LEFT LIKE LIMIT LINEAR LINENO LINES LOAD LOCALTIME LOCALTIMESTAMP LOCK LONG LOOP LOW_PRIORITY
  MATCH MERGE MOD MODIFIES NATIONAL NATURAL NOCHECK NONCLUSTERED NOT NOTNULL NTH_VALUE NTILE NULL NULLIF NUMERIC OF OFF
  OFFSET OFFSETS ON ONLY OPEN OPTIMIZE OPTION OPTIONALLY OR ORDER OUT OUTER OUTFILE OVER OVERLAPS PARTITION PERCENT
  PERCENT_RANK PIVOT PLACING PLAN PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC PURGE RAISERROR RANGE RANK READ READS
  READTEXT REAL RECONFIGURE RECURSIVE REFERENCES REGEXP RELEASE RENAME REPEAT REPLACE REPLICATION REQUIRE RESIGNAL RESTORE
  RESTRICT RETURN RETURNING REVERT REVOKE RIGHT RLIKE ROLLBACK ROW ROWCOUNT ROWGUIDCOL ROWS ROW_NUMBER RULE SAVE SCHEMA
  SCHEMAS SELECT SENSITIVE SEPARATOR SESSION_USER SET SETUSER SHOW SHUTDOWN SIGNAL SIMILAR SMALLINT SOME SPATIAL SPECIFIC
  SQL SQLEXCEPTION SQLSTATE SQLWARNING STARTING STATISTICS STORED STRAIGHT_JOIN SYMMETRIC SYSTEM SYSTEM_USER TABLE
  TABLESAMPLE TERMINATED TEXTSIZE THEN TINYINT TO TOP TRAILING TRAN TRANSACTION TRIGGER TRUE TRUNCATE UNDO UNION UNIQUE
  UNLOCK UNPIVOT UNSIGNED UPDATE UPDATETEXT USAGE USE USER USING VALUES VARBINARY VARCHAR VARIADIC VARYING VERBOSE VIEW
  VIRTUAL WAITFOR WHEN WHERE WHILE WINDOW WITH WITHIN WRITE WRITETEXT XOR ZEROFILL`.split(/\s+/),
)

/** Délimite un identifiant qui est un mot réservé : `order` (MySQL), [order] (SQL Server), "order" (autres). */
export function quoteIdent(name: string, dialect: SqlDialect): string {
  if (!RESERVED.has(name.toUpperCase())) return name
  if (dialect === 'mysql') return `\`${name}\``
  if (dialect === 'sqlserver') return `[${name}]`
  return `"${name}"`
}

/** Longueur maximale d'un nom de contrainte (PostgreSQL : 63, MySQL : 64). */
const MAX_NAME = 63

/** Nom de contrainte unique dans tout le script (MySQL et SQL Server l'exigent), tronqué si besoin. */
function constraintName(base: string, taken: Set<string>): string {
  let name = base.slice(0, MAX_NAME)
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, MAX_NAME - String(i).length - 1)}_${i}`
  taken.add(name)
  return name
}

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

const KEYWORD_DEFAULT = /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL)$/i

/**
 * Formate une valeur par défaut saisie par l'utilisateur pour un dialecte donné :
 * nombres et mots-clés tels quels, booléens adaptés, texte et dates mis entre apostrophes,
 * appels de fonction conservés (entre parenthèses quand MySQL / SQLite l'exigent).
 */
export function sqlDefault(raw: string, c: Pick<MldColumn, 'dataType'>, dialect: SqlDialect): string {
  const v = raw.trim()
  const type = c.dataType
  const wrap = (x: string) => (dialect === 'mysql' || dialect === 'sqlite' ? `(${x})` : x)
  if (type === 'BOOLEAN' && /^(true|false|0|1)$/i.test(v)) {
    const on = /^(true|1)$/i.test(v)
    return dialect === 'sqlserver' || dialect === 'sqlite' ? (on ? '1' : '0') : on ? 'TRUE' : 'FALSE'
  }
  if (/^(CURRENT_DATE)$/i.test(v)) {
    if (dialect === 'sqlserver') return 'CAST(GETDATE() AS DATE)'
    return dialect === 'mysql' ? '(CURRENT_DATE)' : 'CURRENT_DATE'
  }
  if (KEYWORD_DEFAULT.test(v)) return v.toUpperCase()
  if (/^[+-]?\d+(\.\d+)?$/.test(v) && type !== 'DATE' && type !== 'DATETIME') return v
  if (/^'.*'$/s.test(v)) return v
  if (/^[A-Za-z_][A-Za-z0-9_.]*\(.*\)$/s.test(v)) return wrap(v)
  return `'${v.replace(/'/g, "''")}'`
}

export const isAutoIncrement = (t: MldTable, c: MldColumn) =>
  t.origin === 'entity' && t.primaryKey.length === 1 && c.isPrimaryKey && !c.isForeignKey && c.sqlType === 'INT'

/** SQL Server n'admet qu'un seul NULL dans une contrainte UNIQUE : une colonne facultative passe par un index filtré. */
const filteredUnique = (nullable: boolean, o: SqlOptions) => nullable && o.dialect === 'sqlserver'

function columnSql(t: MldTable, c: MldColumn, o: SqlOptions): string {
  const name = quoteIdent(c.name, o.dialect)
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
        return `  ${name} INTEGER PRIMARY KEY AUTOINCREMENT`
      case 'standard':
        suffix += ' GENERATED ALWAYS AS IDENTITY'
        break
    }
  }
  return `  ${name} ${type}${suffix}${constraintSql(t, c, o)}`
}

/** Contraintes de colonne : DEFAULT, UNIQUE (inutile sur une clé primaire simple) et CHECK. */
function constraintSql(t: MldTable, c: MldColumn, o: SqlOptions): string {
  let out = ''
  if (c.defaultValue) out += ` DEFAULT ${sqlDefault(c.defaultValue, c, o.dialect)}`
  if (c.unique && !(t.primaryKey.length === 1 && c.isPrimaryKey) && !filteredUnique(c.nullable, o)) out += ' UNIQUE'
  if (c.check) out += ` CHECK (${c.check})`
  return out
}

/** `ON DELETE` / `ON UPDATE` ; SQL Server n'a pas RESTRICT (NO ACTION est équivalent). */
function refActions(fk: MldTable['foreignKeys'][number], dialect: SqlDialect): string {
  const fix = (a: string) => (dialect === 'sqlserver' && a === 'RESTRICT' ? 'NO ACTION' : a)
  return (fk.onDelete ? ` ON DELETE ${fix(fk.onDelete)}` : '') + (fk.onUpdate ? ` ON UPDATE ${fix(fk.onUpdate)}` : '')
}

/** Contrainte d'unicité portant sur une ou plusieurs colonnes, hors contraintes `UNIQUE` en ligne. */
interface UniqueKey {
  name: string
  columns: string[]
  /** Index unique filtré (`WHERE … IS NOT NULL`) créé après la table. */
  filtered: boolean
}

interface TableNames {
  fks: string[]
  uniques: UniqueKey[]
}

/** Unicités de table : clés étrangères composées d'une association 1–1, et colonnes facultatives uniques sous SQL Server. */
function uniqueKeys(t: MldTable, o: SqlOptions, taken: Set<string>): UniqueKey[] {
  const nullable = (cols: string[]) => cols.some((n) => t.columns.find((c) => c.name === n)?.nullable)
  const keys = [
    ...t.columns.filter((c) => c.unique && !c.isPrimaryKey && filteredUnique(c.nullable, o)).map((c) => [c.name]),
    ...t.foreignKeys.filter((fk) => fk.unique && fk.columns.length > 1).map((fk) => fk.columns),
  ]
  return keys.map((columns) => ({
    name: constraintName(`uq_${t.name}_${columns.join('_')}`, taken),
    columns,
    filtered: filteredUnique(nullable(columns), o),
  }))
}

function fkSql(t: MldTable, i: number, name: string, dialect: SqlDialect): string {
  const fk = t.foreignKeys[i]
  const q = (n: string) => quoteIdent(n, dialect)
  return `CONSTRAINT ${name} FOREIGN KEY (${fk.columns.map(q).join(', ')}) REFERENCES ${q(fk.refTable)} (${fk.refColumns.map(q).join(', ')})${refActions(fk, dialect)}`
}

function renderTable(t: MldTable, names: TableNames, deferred: Set<string>, o: SqlOptions): string {
  const q = (n: string) => quoteIdent(n, o.dialect)
  const list = (cols: string[]) => cols.map(q).join(', ')
  const sqliteInlinePk =
    o.dialect === 'sqlite' && o.autoIncrement && t.columns.some((c) => isAutoIncrement(t, c))
  const lines = t.columns.map((c) => columnSql(t, c, o))
  if (t.primaryKey.length && !sqliteInlinePk) lines.push(`  PRIMARY KEY (${list(t.primaryKey)})`)
  for (const u of names.uniques) if (!u.filtered) lines.push(`  CONSTRAINT ${u.name} UNIQUE (${list(u.columns)})`)
  names.fks.forEach((n, i) => {
    if (!deferred.has(n)) lines.push(`  ${fkSql(t, i, n, o.dialect)}`)
  })
  let out = `CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n);`
  for (const u of names.uniques.filter((x) => x.filtered)) {
    const where = u.columns.map((c) => `${q(c)} IS NOT NULL`).join(' AND ')
    out += `\nCREATE UNIQUE INDEX ${u.name} ON ${q(t.name)} (${list(u.columns)}) WHERE ${where};`
  }
  return out
}

/** Convertit le MLD en script SQL DDL. Les dépendances cycliques passent en ALTER TABLE. */
export function mldToSql(mld: MldResult, options: Partial<SqlOptions> = {}): string {
  const o: SqlOptions = { ...DEFAULTS, ...options }
  const tables = mld.tables
  if (!tables.length) return '-- Aucune table : ajoutez des entités au MCD.\n'

  const taken = new Set<string>()
  const names = new Map<MldTable, TableNames>(
    tables.map((t) => [
      t,
      {
        fks: t.foreignKeys.map((fk) => constraintName(`fk_${t.name}_${fk.refTable}`, taken)),
        uniques: uniqueKeys(t, o, taken),
      },
    ]),
  )

  // Tri topologique ; les auto-références sont ignorées, les cycles sont différés en ALTER TABLE.
  // SQLite n'a pas `ALTER TABLE … ADD CONSTRAINT`, mais accepte de référencer une table créée plus loin.
  const created = new Set<string>()
  const ordered: MldTable[] = []
  const deferred = new Set<string>()
  let pending = [...tables]
  while (pending.length) {
    let ready = pending.filter((t) => t.foreignKeys.every((fk) => fk.refTable === t.name || created.has(fk.refTable)))
    if (!ready.length) {
      const t = pending[0]
      t.foreignKeys.forEach((fk, i) => {
        if (fk.refTable !== t.name && !created.has(fk.refTable) && o.dialect !== 'sqlite') deferred.add(names.get(t)!.fks[i])
      })
      ready = [t]
    }
    for (const t of ready) {
      ordered.push(t)
      created.add(t.name)
    }
    pending = pending.filter((t) => !ready.includes(t))
  }

  const parts = ordered.map((t) => renderTable(t, names.get(t)!, deferred, o))
  for (const t of tables) {
    names.get(t)!.fks.forEach((n, i) => {
      if (deferred.has(n)) parts.push(`ALTER TABLE ${quoteIdent(t.name, o.dialect)}\n  ADD ${fkSql(t, i, n, o.dialect)};`)
    })
  }
  return `-- Script généré par MCDraw (${DIALECT_LABELS[o.dialect]})\n\n${parts.join('\n\n')}\n`
}

import type { Attribute, Cardinality, DataType, Entity, Link, MeriseSchema, RefAction, Relation } from '../types/schema'

/**
 * Import SQL → MCD : lit des `CREATE TABLE` (et les `ALTER TABLE … ADD` de contraintes) et reconstruit un MCD.
 *
 *   table dont la clé primaire est entièrement faite de clés étrangères (≥ 2)  → association (0,n de chaque côté)
 *   clé primaire = une clé étrangère                                           → entité fille (« est un »)
 *   clé étrangère incluse dans une clé primaire plus large                     → association à identifiant relatif (CIF)
 *   autre clé étrangère                                                        → association binaire (1,1 ou 0,1 côté table)
 *
 * Les colonnes de clé étrangère disparaissent des attributs : le MLD les régénère. Les dialectes courants sont acceptés
 * (MySQL, PostgreSQL, SQL Server, SQLite, Oracle) : identifiants entre « " », « ` » ou « [ ] », schéma préfixé, commentaires.
 */

export interface SqlImportResult {
  /** Positions non calculées (x = y = 0) : à passer à `layoutMcd`. */
  schema: MeriseSchema
  warnings: string[]
}

interface Col {
  name: string
  type: DataType
  size?: string
  notNull: boolean
  unique: boolean
  defaultValue?: string
  check?: string
}
interface Fk {
  cols: string[]
  ref: string
  onDelete?: RefAction
  onUpdate?: RefAction
}
interface Tbl {
  name: string
  cols: Col[]
  pk: string[]
  fks: Fk[]
  uniques: string[][]
}

const ID = String.raw`(?:"[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[\p{L}\p{N}_$]+)`
const QNAME = String.raw`${ID}(?:\s*\.\s*${ID})*`
const CONSTRAINT = String.raw`^(?:CONSTRAINT\s+${ID}\s+)?`
const CLUSTER = String.raw`(?:(?:NON)?CLUSTERED\s*)?`

const RE = {
  create: new RegExp(String.raw`\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})\s*\(`, 'iu'),
  alter: new RegExp(String.raw`\bALTER\s+TABLE\s+(?:ONLY\s+|IF\s+EXISTS\s+)*(${QNAME})\s+(?:WITH\s+(?:NO)?CHECK\s+)?(.*)$`, 'isu'),
  pk: new RegExp(CONSTRAINT + String.raw`PRIMARY\s+KEY\s*${CLUSTER}\(([^)]*)\)`, 'iu'),
  fk: new RegExp(CONSTRAINT + String.raw`FOREIGN\s+KEY\s*(?:${ID}\s*)?\(([^)]*)\)\s*REFERENCES\s+(${QNAME})\s*(?:\([^)]*\))?(.*)$`, 'isu'),
  unique: new RegExp(CONSTRAINT + String.raw`UNIQUE\s*(?:KEY\s+|INDEX\s+)?${CLUSTER}(?:${ID}\s*)?\(([^)]*)\)`, 'iu'),
  skip: /^(?:KEY|INDEX|FULLTEXT|SPATIAL|CHECK|EXCLUDE|PERIOD|(?:CONSTRAINT\s+\S+\s+)?CHECK)\b/i,
  column: new RegExp(
    String.raw`^(${ID})\s+((?:[\["])?[A-Za-z_]\w*(?:[\]"])?(?:\s+(?:VARYING|PRECISION|UNSIGNED|ZEROFILL|WITH(?:OUT)?\s+TIME\s+ZONE))*)\s*(?:\(([^)]*)\))?(.*)$`,
    'isu',
  ),
  /** Colonne réduite à son nom (SQLite accepte une colonne sans type). */
  bare: new RegExp(String.raw`^(${ID})()()()$`, 'u'),
  inlineRef: new RegExp(String.raw`\bREFERENCES\s+(${QNAME})\s*(?:\([^)]*\))?(.*)$`, 'isu'),
  id: new RegExp(ID, 'gu'),
}

const k = (s: string) => s.toLowerCase()
const unquote = (s: string) => s.replace(/^(["`[])(.*)[\]"`]$/s, '$2')
/** Dernier segment d'un nom qualifié : `dbo`.`Client` → Client. */
const lastIdent = (q: string) => unquote([...q.matchAll(RE.id)].pop()?.[0] ?? q.trim())
const firstIdent = (q: string) => unquote(q.match(RE.id)?.[0] ?? q.trim())

/** Retire les commentaires SQL (de ligne et de bloc) sans toucher à ce qui est entre guillemets. */
function stripComments(sql: string): string {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === '\\' && c !== '`') j += 2
        else if (sql[j] !== c) j++
        else if (sql[j + 1] === c) j += 2
        else break
      }
      out += sql.slice(i, j + 1)
      i = j
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 1
      out += ' '
    } else out += c
  }
  return out
}

/** Découpe sur `sep` hors parenthèses et hors guillemets. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  let quote = ''
  let escaped = false
  for (const ch of s) {
    if (escaped) escaped = false
    else if (quote) {
      if (ch === '\\' && quote !== '`' && quote !== ']') escaped = true
      else if (ch === quote) quote = ''
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '[') quote = ']'
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

/** Position de la parenthèse fermante qui répond à celle de `s[open]`. */
function closeParen(s: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === '\\' && quote !== '`') i++
      else if (ch === quote) quote = ''
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return -1
}

const cols = (list: string) => splitTop(list, ',').map(firstIdent)

function mapType(raw: string, size: string | undefined): { type: DataType; size?: string; known: boolean } {
  const t = raw.toUpperCase().replace(/\s+/g, ' ')
  const dim = size && /^\d+(\s*,\s*\d+)?$/.test(size.trim()) ? size.replace(/\s+/g, '') : undefined
  if (t === 'TINYINT' && dim === '1') return { type: 'BOOLEAN', known: true }
  if (/^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|SERIAL|BIGSERIAL|SMALLSERIAL|INT2|INT4|INT8)\b/.test(t)) return { type: 'INT', known: true }
  if (/^(TINYTEXT|MEDIUMTEXT|LONGTEXT|TEXT|NTEXT|CLOB|NCLOB|JSON|JSONB|XML)$/.test(t)) return { type: 'TEXT', known: true }
  if (/^(VARCHAR|NVARCHAR|VARCHAR2|NVARCHAR2|CHAR|NCHAR|CHARACTER|CHARACTER VARYING|STRING|ENUM|SET|UUID)$/.test(t)) {
    if (size?.trim().toUpperCase() === 'MAX') return { type: 'TEXT', known: true }
    if (t === 'UUID') return { type: 'VARCHAR', size: '36', known: true }
    return { type: 'VARCHAR', size: t === 'ENUM' || t === 'SET' ? undefined : dim, known: true }
  }
  if (/^(DECIMAL|NUMERIC|NUMBER|MONEY|SMALLMONEY)$/.test(t)) return { type: 'DECIMAL', size: dim, known: true }
  if (/^(FLOAT|FLOAT4|FLOAT8|DOUBLE|DOUBLE PRECISION|REAL)$/.test(t)) return { type: 'FLOAT', known: true }
  if (/^(BOOLEAN|BOOL|BIT)$/.test(t)) return { type: 'BOOLEAN', known: true }
  if (t === 'DATE') return { type: 'DATE', known: true }
  if (/^(DATETIME|DATETIME2|SMALLDATETIME|DATETIMEOFFSET|TIMESTAMP|TIMESTAMPTZ|TIME)\b/.test(t)) return { type: 'DATETIME', known: true }
  return { type: 'VARCHAR', known: false }
}

function readDefault(rest: string): string | undefined {
  const m = /\bDEFAULT\s+/i.exec(rest)
  if (!m) return undefined
  let r = rest.slice(m.index + m[0].length)
  let v: string
  if (r.startsWith('(')) {
    const end = closeParen(r, 0)
    v = end < 0 ? r : r.slice(0, end + 1)
  } else if (/^N?'/i.test(r)) {
    r = r.replace(/^N/i, '')
    let j = 1
    while (j < r.length) {
      if (r[j] !== "'") j++
      else if (r[j + 1] === "'") j += 2
      else break
    }
    v = r.slice(0, j + 1)
  } else v = /^[^\s,]+/.exec(r)?.[0] ?? ''
  while (v.startsWith('(') && v.endsWith(')')) v = v.slice(1, -1).trim()
  const q = /^N?'(.*)'$/s.exec(v)
  v = q ? q[1].replace(/''/g, "'") : v
  if (!v || /^NULL$/i.test(v) || /^nextval\(/i.test(v)) return undefined
  return v
}

function readCheck(rest: string): string | undefined {
  const m = /\bCHECK\s*\(/i.exec(rest)
  if (!m) return undefined
  const open = m.index + m[0].length - 1
  const end = closeParen(rest, open)
  return end < 0 ? undefined : rest.slice(open + 1, end).trim() || undefined
}

function actions(tail: string): Pick<Fk, 'onDelete' | 'onUpdate'> {
  const get = (kind: 'DELETE' | 'UPDATE'): RefAction | undefined => {
    const m = new RegExp(String.raw`\bON\s+${kind}\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)`, 'i').exec(tail)
    const v = m?.[1].toUpperCase().replace(/\s+/g, ' ')
    return v === 'CASCADE' || v === 'SET NULL' || v === 'RESTRICT' ? v : undefined
  }
  const out: Pick<Fk, 'onDelete' | 'onUpdate'> = {}
  const d = get('DELETE')
  const u = get('UPDATE')
  if (d) out.onDelete = d
  if (u) out.onUpdate = u
  return out
}

/**
 * Vrai si `item` se lit comme une colonne de type connu : `key text` ou `period VARCHAR(7)` sont des colonnes
 * (mots non réservés en PostgreSQL), alors que `KEY idx_nom (nom)` est un index.
 */
function looksLikeColumn(item: string): boolean {
  const m = RE.column.exec(item)
  return !!m && mapType(m[2].replace(/[[\]"]/g, ''), m[3]).known
}

/** Applique une contrainte de table (`PRIMARY KEY (…)`, `FOREIGN KEY …`, `UNIQUE (…)`). Faux si `item` n'en est pas une. */
function tableConstraint(t: Tbl, item: string): boolean {
  let m = RE.pk.exec(item)
  if (m) {
    t.pk = cols(m[1])
    return true
  }
  m = RE.fk.exec(item)
  if (m) {
    t.fks.push({ cols: cols(m[1]), ref: lastIdent(m[2]), ...actions(m[3]) })
    return true
  }
  m = RE.unique.exec(item)
  if (m) {
    t.uniques.push(cols(m[1]))
    return true
  }
  return RE.skip.test(item) && !looksLikeColumn(item)
}

function parseColumn(t: Tbl, item: string, warnings: string[]) {
  const m = RE.column.exec(item) ?? RE.bare.exec(item)
  if (!m) return
  let typeWord = m[2].replace(/[[\]"]/g, '')
  let rest = m[4]
  // Colonne sans type (SQLite) : le « type » lu est en fait un début de contrainte.
  if (/^(PRIMARY|NOT|NULL|UNIQUE|DEFAULT|REFERENCES|CHECK|CONSTRAINT)$/i.test(typeWord)) {
    rest = `${typeWord} ${m[3] ? `(${m[3]}) ` : ''}${rest}`
    typeWord = ''
  }
  const name = unquote(m[1])
  const mapped = typeWord ? mapType(typeWord, m[3]) : { type: 'VARCHAR' as DataType, known: true, size: undefined }
  if (!mapped.known) warnings.push(`${t.name}.${name} : type « ${typeWord} » inconnu, remplacé par VARCHAR.`)
  const col: Col = {
    name,
    type: mapped.type,
    notNull: /\bNOT\s+NULL\b/i.test(rest),
    unique: /\bUNIQUE\b/i.test(rest),
  }
  if (mapped.size) col.size = mapped.size
  const def = readDefault(rest)
  if (def !== undefined) col.defaultValue = def
  const check = readCheck(rest)
  if (check) col.check = check
  t.cols.push(col)
  if (/\bPRIMARY\s+KEY\b/i.test(rest)) t.pk = [name]
  const ref = RE.inlineRef.exec(rest)
  if (ref) t.fks.push({ cols: [name], ref: lastIdent(ref[1]), ...actions(ref[2]) })
}

function parseTables(sql: string, warnings: string[]): Tbl[] {
  const tables: Tbl[] = []
  const alters: { table: string; item: string; column: boolean }[] = []
  for (const stmt of splitTop(sql, ';')) {
    const c = RE.create.exec(stmt)
    if (c) {
      const open = c.index + c[0].length - 1
      const end = closeParen(stmt, open)
      const body = stmt.slice(open + 1, end < 0 ? undefined : end)
      const t: Tbl = { name: lastIdent(c[1]), cols: [], pk: [], fks: [], uniques: [] }
      for (const item of splitTop(body, ',')) if (!tableConstraint(t, item)) parseColumn(t, item, warnings)
      tables.push(t)
      continue
    }
    const a = RE.alter.exec(stmt)
    if (a) {
      // MySQL / phpMyAdmin : plusieurs « ADD … » séparés par des virgules dans un même ALTER TABLE ;
      // SQL Server : « ADD a INT, b INT » ajoute deux colonnes avec un seul ADD.
      let afterAdd = false
      for (const piece of splitTop(a[2], ',')) {
        const add = /^ADD\s+(COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(.*)$/is.exec(piece)
        const more: boolean = !add && afterAdd && looksLikeColumn(piece)
        if (add) alters.push({ table: lastIdent(a[1]), item: add[2].trim(), column: !!add[1] })
        else if (more) alters.push({ table: lastIdent(a[1]), item: piece, column: true })
        afterAdd = !!add || more
      }
    }
  }
  // Scripts de migration : contraintes et colonnes ajoutées après coup (ALTER TABLE … ADD [COLUMN]).
  for (const { table, item, column } of alters) {
    const t = tables.find((x) => k(x.name) === k(table))
    if (!t) continue
    if (column || (!tableConstraint(t, item) && looksLikeColumn(item))) parseColumn(t, item, warnings)
  }
  return tables
}

export function sqlToMcd(sql: string, makeId: () => string): SqlImportResult {
  const warnings: string[] = []
  // « GO » (SQL Server) sépare les lots comme un point-virgule.
  const tables = parseTables(stripComments(sql).replace(/^[ 	]*GO[ 	]*$/gim, ';'), warnings)
  const technical = /^(?:__efmigrationshistory|flyway_schema_history|schema_migrations|django_migrations|alembic_version|migrations)$/i
  const ignored = tables.filter((t) => technical.test(t.name))
  if (ignored.length) warnings.push(`Table(s) technique(s) ignorée(s) : ${ignored.map((t) => t.name).join(', ')}.`)
  tables.splice(0, tables.length, ...tables.filter((t) => !technical.test(t.name)))
  if (!tables.length) warnings.push('Aucun CREATE TABLE trouvé dans ce script.')

  const byName = new Map(tables.map((t) => [k(t.name), t]))
  for (const t of tables) {
    t.fks = t.fks.filter((fk) => {
      if (byName.has(k(fk.ref))) return true
      warnings.push(`${t.name} : la table « ${fk.ref} » est absente du script, ${fk.cols.join(', ')} reste un simple attribut.`)
      return false
    })
  }

  const pkSet = (t: Tbl) => new Set(t.pk.map(k))
  const fkCols = (t: Tbl) => new Set(t.fks.flatMap((f) => f.cols.map(k)))
  const sameCols = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.map(k).includes(k(c)))
  const colOf = (t: Tbl, name: string) => t.cols.find((c) => k(c.name) === k(name))

  // Associations : clé primaire entièrement composée de clés étrangères. Une table que d'autres référencent reste une entité.
  const referenced = new Set(tables.flatMap((t) => t.fks.map((f) => k(f.ref))))
  const assoc = new Set(
    tables.filter(
      (t) =>
        t.fks.length >= 2 &&
        t.pk.length >= 2 &&
        t.pk.every((c) => fkCols(t).has(k(c))) &&
        t.fks.every((f) => f.cols.every((c) => pkSet(t).has(k(c)))) &&
        !referenced.has(k(t.name)),
    ),
  )

  // Héritage : la clé primaire est elle-même une clé étrangère.
  const parentFk = new Map<Tbl, Fk>()
  for (const t of tables) {
    if (assoc.has(t)) continue
    const fk = t.fks.find((f) => k(f.ref) !== k(t.name) && sameCols(f.cols, t.pk))
    if (fk) parentFk.set(t, fk)
  }
  for (const t of [...parentFk.keys()]) {
    const seen = new Set<Tbl>()
    for (let cur: Tbl | undefined = t; cur && parentFk.has(cur); cur = byName.get(k(parentFk.get(cur)!.ref))) {
      if (seen.has(cur)) {
        parentFk.delete(t)
        break
      }
      seen.add(cur)
    }
  }

  const attrOf = (t: Tbl, c: Col): Attribute => {
    const a: Attribute = { id: makeId(), name: c.name, type: c.type, isPrimaryKey: pkSet(t).has(k(c.name)) }
    if (c.size) a.size = c.size
    if (c.notNull && !a.isPrimaryKey) a.notNull = true
    if (c.unique || t.uniques.some((u) => u.length === 1 && k(u[0]) === k(c.name))) a.unique = true
    if (c.defaultValue !== undefined) a.defaultValue = c.defaultValue
    if (c.check) a.check = c.check
    return a
  }

  const entities: Entity[] = []
  const relations: Relation[] = []
  const links: Link[] = []
  const entityOf = new Map<string, Entity>()

  for (const t of tables) {
    if (assoc.has(t)) continue
    const consumed = fkCols(t)
    const attributes = t.cols.filter((c) => !consumed.has(k(c.name))).map((c) => attrOf(t, c))
    if (!parentFk.has(t) && !attributes.some((a) => a.isPrimaryKey)) {
      warnings.push(`${t.name} : pas de clé primaire exploitable, ${attributes[0] ? `« ${attributes[0].name} » devient l'identifiant` : 'un identifiant « id » est ajouté'}.`)
      if (attributes[0]) attributes[0].isPrimaryKey = true
      else attributes.push({ id: makeId(), name: 'id', type: 'INT', isPrimaryKey: true })
    }
    const entity: Entity = { id: makeId(), name: t.name, attributes, x: 0, y: 0 }
    entities.push(entity)
    entityOf.set(k(t.name), entity)
  }
  for (const [t, fk] of parentFk) entityOf.get(k(t.name))!.parentId = entityOf.get(k(fk.ref))!.id

  // Noms d'associations distincts entre eux et de ceux des entités (sinon « nom en double » sur le canvas).
  const usedNames = new Set<string>([...entities.map((e) => k(e.name)), ...[...assoc].map((t) => k(t.name))])
  const uniqueName = (base: string) => {
    let name = base
    for (let n = 2; usedNames.has(k(name)); n++) name = `${base}_${n}`
    usedNames.add(k(name))
    return name
  }
  /** `id_client` → `client` ; vide si cela redit le nom de l'entité visée. */
  const roleOf = (col: string, target: string) => {
    const t = byName.get(k(target))!
    const pk = t.pk.find((p) => k(col) === k(p) || k(col).endsWith(`_${k(p)}`))
    let r = pk ? col.slice(0, Math.max(0, col.length - pk.length - 1)) : col
    if (!pk) r = r.replace(/^(?:id|fk|code)[_-]|[_-](?:id|fk|code)$/i, '').replace(/(?<=[a-z])Id$/, '')
    return !r || /^(?:id|fk|code)$/i.test(r) || k(r) === k(target) ? '' : r
  }
  const ref = (fk: Fk, id: string, cardinality: Cardinality, extra: Partial<Link> = {}): Link => ({
    id: makeId(),
    relationId: id,
    entityId: entityOf.get(k(fk.ref))!.id,
    cardinality,
    ...(fk.onDelete ? { onDelete: fk.onDelete } : {}),
    ...(fk.onUpdate ? { onUpdate: fk.onUpdate } : {}),
    ...extra,
  })

  // Clés étrangères d'une entité → associations binaires.
  for (const t of tables) {
    if (assoc.has(t)) continue
    const child = entityOf.get(k(t.name))!
    for (const fk of t.fks) {
      if (fk === parentFk.get(t)) continue
      const inPk = fk.cols.every((c) => pkSet(t).has(k(c)))
      const notNull = fk.cols.every((c) => pkSet(t).has(k(c)) || colOf(t, c)?.notNull)
      const oneToOne = t.uniques.some((u) => sameCols(u, fk.cols)) || (fk.cols.length === 1 && !!colOf(t, fk.cols[0])?.unique)
      const hint = roleOf(fk.cols[0], fk.ref)
      const relation: Relation = { id: makeId(), name: uniqueName(hint || `${t.name}_${fk.ref}`), attributes: [], x: 0, y: 0 }
      relations.push(relation)
      const selfRef = k(fk.ref) === k(t.name)
      const mine: Link = {
        id: makeId(),
        relationId: relation.id,
        entityId: child.id,
        cardinality: inPk || notNull ? '1,1' : '0,1',
      }
      if (inPk) mine.identifying = true
      const theirs = ref(fk, relation.id, oneToOne ? '0,1' : '0,n')
      if (selfRef) {
        // C'est le rôle de la patte référencée qui préfixe la colonne de clé étrangère dans le MLD.
        theirs.role = hint || 'parent'
        mine.role = theirs.role === 'enfant' ? 'fils' : 'enfant'
      }
      links.push(mine, theirs)
    }
  }

  // Tables d'association → associations n-aires portant leurs propres colonnes.
  for (const t of assoc) {
    const relation: Relation = {
      id: makeId(),
      name: t.name,
      tableName: t.name,
      attributes: t.cols.filter((c) => !fkCols(t).has(k(c.name))).map((c) => attrOf(t, c)),
      x: 0,
      y: 0,
    }
    relations.push(relation)
    const legs = t.fks.map((fk) => ref(fk, relation.id, '0,n'))
    // Plusieurs pattes vers la même entité (amitié, parenté…) : un rôle tiré du nom de colonne les distingue.
    const count = new Map<string, number>()
    for (const l of legs) count.set(l.entityId, (count.get(l.entityId) ?? 0) + 1)
    const roles = new Set<string>()
    legs.forEach((l, i) => {
      if ((count.get(l.entityId) ?? 0) < 2) return
      let role = roleOf(t.fks[i].cols[0], t.fks[i].ref) || `role${i + 1}`
      if (roles.has(role)) role = `${role}${i + 1}`
      roles.add(role)
      l.role = role
    })
    links.push(...legs)
  }

  return { schema: { entities, relations, links }, warnings }
}

import { faker } from '@faker-js/faker/locale/fr'
import { isAutoIncrement, quoteIdent, type SqlDialect } from './mldToSql'
import type { MldColumn, MldForeignKey, MldResult, MldTable } from '../types/schema'

export interface SeedOptions {
  /** Nombre de lignes visé par table (réduit si une contrainte d'unicité l'impose). */
  rows: number
  /** Graine du générateur : un même MLD et une même graine donnent toujours les mêmes données. */
  seed: number
}

export const SEED_DEFAULTS: SeedOptions = { rows: 10, seed: 42 }

export type ValueKind =
  | 'email' | 'firstName' | 'lastName' | 'productName' | 'word' | 'city' | 'country' | 'zip' | 'phone' | 'street'
  | 'company' | 'url' | 'title' | 'text' | 'color' | 'username' | 'password' | 'status' | 'gender'
  | 'int' | 'decimal' | 'bool' | 'date' | 'datetime'

export interface ValuePlan {
  kind: ValueKind
  min?: number
  max?: number
  /** Décimales (DECIMAL / FLOAT). */
  decimals?: number
  /** Longueur maximale d'une chaîne. */
  maxLen?: number
  /** Valeurs distinctes exigées (clé primaire, UNIQUE). */
  unique: boolean
  /** Date de fin : colonne de date précédente (même table) à laquelle on ajoute quelques jours. */
  after?: string
}

/**
 * Comment une clé étrangère choisit sa ligne parente :
 *  - `random`  : au hasard (ou NULL de temps en temps si elle est facultative) ;
 *  - `index`   : la n-ième ligne ↔ le n-ième parent (association 1–1, clé primaire = clé étrangère) ;
 *  - `combo`   : combinaisons distinctes de parents (table d'association) ;
 *  - `self`    : auto-référence, vers une ligne précédente ;
 *  - `forward` : parent créé plus loin (dépendance circulaire) : identifiant supposé ;
 *  - `null`    : parent créé plus loin et clé facultative.
 */
export type FkMode = 'random' | 'index' | 'combo' | 'self' | 'forward' | 'null'

export interface FkPlan {
  fk: MldForeignKey
  mode: FkMode
  nullable: boolean
}

export interface ColumnPlan {
  column: MldColumn
  /** `serial` : 1, 2, 3… ; `fk` : voir `fks[fkIndex]` ; `value` : valeur fictive. */
  source: 'serial' | 'fk' | 'value'
  value?: ValuePlan
  fkIndex?: number
  /** Clé primaire simple générée par la base (auto-incrément) : l'insérer n'est pas obligatoire. */
  dbGenerated: boolean
}

export interface TablePlan {
  table: MldTable
  count: number
  columns: ColumnPlan[]
  fks: FkPlan[]
  /** Indices des clés étrangères combinées (table d'association). */
  combo: number[]
}

export interface SeedPlan {
  tables: TablePlan[]
  warnings: string[]
}

export type SeedValue = string | number | boolean | null

export interface SeedTable {
  plan: TablePlan
  rows: SeedValue[][]
}

export interface SeedData {
  tables: SeedTable[]
  warnings: string[]
}

// ---------------------------------------------------------------------------------------------
// Plan : ordre d'insertion, origine de chaque colonne, nombre de lignes
// ---------------------------------------------------------------------------------------------

const PERSON_TABLE = /(client|employe|adherent|auteur|personne|utilisateur|user|etudiant|eleve|patient|membre|proprietaire|conducteur|medecin|professeur|vendeur|fournisseur|contact|candidat|salarie)/
const THING_TABLE = /(produit|article|categorie|livre|film|service|piece|vehicule|marque)/

const has = (name: string, re: RegExp) => re.test(name)

/** Genre de valeur fictive d'une colonne d'après son nom et son type. */
function valueKind(t: MldTable, c: MldColumn, previousDate: string | undefined): ValuePlan {
  const n = c.name.toLowerCase()
  const base = c.sqlType.replace(/\(.*\)$/, '')
  const unique = !!c.unique || c.isPrimaryKey
  const len = /^VARCHAR\((\d+)\)$/.exec(c.sqlType)
  const maxLen = len ? +len[1] : undefined
  const str = (kind: ValueKind): ValuePlan => ({ kind, maxLen, unique })

  if (base === 'BOOLEAN') return { kind: 'bool', unique: false }
  if (base === 'DATE' || base === 'DATETIME') {
    const kind = base === 'DATE' ? 'date' : 'datetime'
    if (previousDate && has(n, /(^|_)(fin|retour|echeance|limite|expiration|livraison)/)) return { kind, after: previousDate, unique }
    if (has(n, /naissance|birth/)) return { kind, min: 1960, max: 2005, unique }
    return { kind, min: 2022, max: 2025, unique }
  }
  if (base === 'INT') {
    if (has(n, /(^|_)age($|_)/)) return { kind: 'int', min: 18, max: 80, unique }
    if (has(n, /annee|year/)) return { kind: 'int', min: 1990, max: 2025, unique }
    if (has(n, /note|rating|score/)) return { kind: 'int', min: 1, max: 5, unique }
    if (has(n, /stock/)) return { kind: 'int', min: 0, max: 200, unique }
    if (has(n, /quantite|qte|nombre|(^|_)nb_|duree/)) return { kind: 'int', min: 1, max: 20, unique }
    return { kind: 'int', min: 1, max: 100, unique }
  }
  if (base === 'DECIMAL' || base === 'FLOAT') {
    const m = /^DECIMAL\((\d+)(?:,(\d+))?\)$/.exec(c.sqlType)
    const decimals = m ? +(m[2] ?? 0) : 2
    // plafond imposé par la précision : DECIMAL(5,2) tient dans 999,99
    const cap = m ? 10 ** (+m[1] - decimals) - 1 : Infinity
    let [min, max] = [1, 1000]
    if (has(n, /salaire/)) [min, max] = [1500, 5000]
    else if (has(n, /prix|montant|tarif|cout|total|solde/)) [min, max] = [5, 500]
    else if (has(n, /taux|pourcentage|remise/)) [min, max] = [0, 30]
    max = Math.min(max, cap)
    min = Math.min(min, max)
    return { kind: 'decimal', min, max, decimals, unique }
  }
  // texte (VARCHAR, TEXT)
  if (has(n, /e?mail|courriel/)) return str('email')
  if (has(n, /(^|_)(prenom|firstname|first_name)/)) return str('firstName')
  if (has(n, /(^|_)(nom_?famille|lastname|last_name)/)) return str('lastName')
  if (has(n, /(^|_)(nom|name)$/) || has(n, /^(nom|name)_/)) {
    if (PERSON_TABLE.test(t.name)) return str('lastName')
    return str(THING_TABLE.test(t.name) ? 'productName' : 'word')
  }
  if (has(n, /ville|city|commune/)) return str('city')
  if (has(n, /pays|country/)) return str('country')
  if (has(n, /code_?postal|(^|_)cp($|_)|zip/)) return str('zip')
  if (has(n, /(^|_)(tel|telephone|phone|mobile|portable)/)) return str('phone')
  if (has(n, /adresse|address|(^|_)rue($|_)/)) return str('street')
  if (has(n, /societe|entreprise|company|raison_sociale/)) return str('company')
  if (has(n, /(^|_)(url|site|website)/)) return str('url')
  if (has(n, /couleur|color/)) return str('color')
  if (has(n, /login|pseudo|username/)) return str('username')
  if (has(n, /mot_?de_?passe|password|(^|_)mdp($|_)/)) return str('password')
  if (has(n, /statut|status|(^|_)etat($|_)/)) return str('status')
  if (has(n, /sexe|genre/)) return str('gender')
  if (has(n, /description|commentaire|resume|contenu|notes?($|_)|texte|message|biographie/) || base === 'TEXT') {
    return base === 'VARCHAR' && maxLen && maxLen < 60 ? str('title') : str('text')
  }
  if (has(n, /titre|title|libelle|intitule|designation/)) return str('title')
  return str('word')
}

/** Tri topologique ; les auto-références sont ignorées, un cycle est coupé sur la première table restante. */
function insertionOrder(tables: MldTable[]): { ordered: MldTable[]; forward: Set<MldForeignKey> } {
  const created = new Set<string>()
  const ordered: MldTable[] = []
  const forward = new Set<MldForeignKey>()
  let pending = [...tables]
  while (pending.length) {
    let ready = pending.filter((t) => t.foreignKeys.every((fk) => fk.refTable === t.name || created.has(fk.refTable)))
    if (!ready.length) {
      const t = pending[0]
      for (const fk of t.foreignKeys) if (fk.refTable !== t.name && !created.has(fk.refTable)) forward.add(fk)
      ready = [t]
    }
    for (const t of ready) {
      ordered.push(t)
      created.add(t.name)
    }
    pending = pending.filter((t) => !ready.includes(t))
  }
  return { ordered, forward }
}

/** Plan de génération : ordre d'insertion, source de chaque colonne et nombre de lignes par table. */
export function planSeed(mld: MldResult, options: Partial<SeedOptions> = {}): SeedPlan {
  const o = { ...SEED_DEFAULTS, ...options }
  const rows = Math.max(1, Math.floor(o.rows))
  const warnings: string[] = []
  const { ordered, forward } = insertionOrder(mld.tables)
  const counts = new Map<string, number>()
  const plans: TablePlan[] = []

  for (const t of ordered) {
    const coverPk = (fk: MldForeignKey) => t.primaryKey.every((k) => fk.columns.includes(k))
    const fkOfColumn = (name: string) => t.foreignKeys.findIndex((fk) => fk.columns.includes(name))

    // Clés étrangères des colonnes de la clé primaire : plus d'un groupe → table d'association (combinaisons).
    const pkFks = [...new Set(t.primaryKey.map(fkOfColumn).filter((i) => i >= 0))]
    const isAssociation = t.primaryKey.length > 0 && pkFks.length >= 2 && t.primaryKey.every((k) => fkOfColumn(k) >= 0)
    const combo = isAssociation ? pkFks.filter((i) => t.foreignKeys[i].refTable !== t.name) : []

    let count = rows
    const fks: FkPlan[] = t.foreignKeys.map((fk, i) => {
      const nullable = fk.columns.every((n) => t.columns.find((c) => c.name === n)!.nullable)
      let mode: FkMode = 'random'
      if (fk.refTable === t.name) mode = 'self'
      else if (forward.has(fk)) mode = nullable ? 'null' : 'forward'
      else if (combo.includes(i)) mode = 'combo'
      else if (fk.unique || (coverPk(fk) && pkFks.length === 1)) mode = 'index'
      if (mode === 'index') count = Math.min(count, counts.get(fk.refTable) ?? count)
      if (mode === 'forward') warnings.push(`${t.name}(${fk.columns.join(', ')}) référence ${fk.refTable}, créée plus loin (dépendance circulaire) : insérez les données en désactivant les contraintes.`)
      return { fk, mode, nullable }
    })
    if (combo.length) {
      const possible = combo.reduce((p, i) => p * (counts.get(t.foreignKeys[i].refTable) ?? rows), 1)
      count = Math.min(count, possible)
    }

    let previousDate: string | undefined
    const columns: ColumnPlan[] = t.columns.map((c) => {
      const dbGenerated = isAutoIncrement(t, c)
      const fkIndex = fkOfColumn(c.name)
      if (fkIndex >= 0) return { column: c, source: 'fk', fkIndex, dbGenerated: false }
      if (c.isPrimaryKey && c.sqlType === 'INT') return { column: c, source: 'serial', dbGenerated }
      const value = valueKind(t, c, previousDate)
      if (value.kind === 'date' || value.kind === 'datetime') previousDate = c.name
      return { column: c, source: 'value', value, dbGenerated: false }
    })

    counts.set(t.name, count)
    plans.push({ table: t, count, columns, fks, combo })
  }
  return { tables: plans, warnings }
}

// ---------------------------------------------------------------------------------------------
// Génération des lignes
// ---------------------------------------------------------------------------------------------

export const COLORS = ['rouge', 'bleu', 'vert', 'jaune', 'noir', 'blanc', 'orange', 'violet']
export const STATUSES = ['actif', 'en_attente', 'termine']
export const GENDERS = ['F', 'H']

const pad = (n: number) => String(n).padStart(2, '0')
const fmtDate = (d: Date, withTime: boolean) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
  (withTime ? ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : '')

function addDays(value: string, days: number): string {
  const withTime = value.length > 10
  const d = new Date((withTime ? value.replace(' ', 'T') : `${value}T00:00:00`) + 'Z')
  d.setUTCDate(d.getUTCDate() + days)
  return fmtDate(d, withTime)
}

export function seedData(plan: SeedPlan, options: Partial<SeedOptions> = {}): SeedData {
  const o = { ...SEED_DEFAULTS, ...options }
  // Toutes les valeurs viennent de @faker-js/faker (locale fr), amorcé par la graine : mêmes entrées, mêmes données.
  faker.seed(o.seed)
  const rng = () => faker.number.float({ min: 0, max: 0.999999 })
  const int = (min: number, max: number) => faker.number.int({ min, max })
  const pick = <T>(list: readonly T[]) => faker.helpers.arrayElement(list)
  const done = new Map<string, SeedTable>()
  const out: SeedTable[] = []

  const text = (v: ValuePlan, row: SeedValue[], cols: ColumnPlan[]): SeedValue => {
    switch (v.kind) {
      case 'email': return faker.internet.email().toLowerCase()
      case 'firstName': return faker.person.firstName()
      case 'lastName': return faker.person.lastName()
      case 'productName': return faker.commerce.productName()
      case 'word': return faker.lorem.word()
      case 'city': return faker.location.city()
      case 'country': return faker.location.country()
      case 'zip': return faker.location.zipCode()
      case 'phone': return faker.phone.number()
      case 'street': return faker.location.streetAddress()
      case 'company': return faker.company.name()
      case 'url': return faker.internet.url()
      case 'title': return faker.lorem.sentence({ min: 2, max: 4 }).replace(/\.$/, '')
      case 'text': return faker.lorem.paragraph()
      case 'color': return pick(COLORS)
      case 'username': return faker.internet.username().toLowerCase()
      case 'password': return faker.internet.password()
      case 'status': return pick(STATUSES)
      case 'gender': return pick(GENDERS)
      case 'int': return int(v.min ?? 1, v.max ?? 100)
      case 'decimal': return faker.number.float({ min: v.min ?? 1, max: v.max ?? 1000, fractionDigits: v.decimals ?? 2 })
      case 'bool': return faker.datatype.boolean()
      case 'date':
      case 'datetime': {
        const withTime = v.kind === 'datetime'
        if (v.after) {
          const prev = row[cols.findIndex((c) => c.column.name === v.after)]
          if (typeof prev === 'string') return addDays(prev, int(1, 30))
        }
        const d = faker.date.between({ from: `${v.min ?? 2022}-01-01T00:00:00Z`, to: `${v.max ?? 2025}-12-31T23:59:59Z` })
        if (!withTime) d.setUTCHours(0, 0, 0, 0)
        return fmtDate(d, withTime)
      }
    }
  }

  /** Rend la valeur unique parmi celles déjà prises dans la colonne (suffixe numérique ou incrément). */
  const makeUnique = (v: SeedValue, seen: Set<string>, i: number): SeedValue => {
    let cur = v
    for (let k = 0; seen.has(String(cur)); k++) {
      if (typeof cur === 'number') cur += 1
      else if (typeof v === 'string' && v.includes('@')) cur = v.replace('@', `${i + 1 + k}@`)
      else cur = `${v}${i + 1 + k}`
    }
    seen.add(String(cur))
    return cur
  }

  for (const tp of plan.tables) {
    const t = tp.table
    const colIndex = new Map(t.columns.map((c, i) => [c.name, i]))
    const rows: SeedValue[][] = Array.from({ length: tp.count }, () => new Array<SeedValue>(t.columns.length).fill(null))
    const seen = tp.columns.map(() => new Set<string>())

    // 1) identifiants séquentiels et valeurs fictives (dans l'ordre des colonnes : une date de fin suit sa date de début)
    rows.forEach((row, i) => {
      tp.columns.forEach((cp, ci) => {
        if (cp.source === 'serial') row[ci] = i + 1
        else if (cp.source === 'value') {
          const v = cp.value!
          let val = text(v, row, tp.columns)
          if (typeof val === 'string' && v.maxLen && !v.unique) val = val.slice(0, v.maxLen)
          if (v.unique) val = makeUnique(val, seen[ci], i)
          if (typeof val === 'string' && v.maxLen) val = val.slice(0, v.maxLen)
          row[ci] = val
        }
      })
    })

    // 2) clés étrangères
    const parentRows = (fk: MldForeignKey) => done.get(fk.refTable)?.rows ?? []
    const copyKey = (row: SeedValue[], fk: MldForeignKey, parent: SeedValue[] | null, parentTable: MldTable) => {
      fk.columns.forEach((name, k) => {
        row[colIndex.get(name)!] = parent ? parent[parentTable.columns.findIndex((c) => c.name === fk.refColumns[k])] : null
      })
    }
    const parentTableOf = (fk: MldForeignKey) => (fk.refTable === t.name ? t : plan.tables.find((p) => p.table.name === fk.refTable)!.table)

    // combinaisons distinctes de parents pour une table d'association
    let combos: number[][] = []
    if (tp.combo.length) {
      combos = [[]]
      for (const fi of tp.combo) {
        const n = parentRows(t.foreignKeys[fi]).length
        combos = combos.flatMap((c) => Array.from({ length: n }, (_, k) => [...c, k]))
      }
      for (let i = combos.length - 1; i > 0; i--) {
        const j = int(0, i)
        ;[combos[i], combos[j]] = [combos[j], combos[i]]
      }
    }

    rows.forEach((row, i) => {
      tp.fks.forEach((fp, fi) => {
        const { fk } = fp
        const pt = parentTableOf(fk)
        const parents = parentRows(fk)
        switch (fp.mode) {
          case 'index':
            copyKey(row, fk, parents[i % Math.max(parents.length, 1)] ?? null, pt)
            break
          case 'combo':
            copyKey(row, fk, parents[combos[i][tp.combo.indexOf(fi)]] ?? null, pt)
            break
          case 'self':
            if (i === 0 && fp.nullable) copyKey(row, fk, null, pt)
            else if (i === 0) copyKey(row, fk, row, pt) // première ligne : elle se référence elle-même
            else copyKey(row, fk, fp.nullable && rng() < 0.2 ? null : rows[int(0, i - 1)], pt)
            break
          case 'null':
            copyKey(row, fk, null, pt)
            break
          case 'forward':
            fk.columns.forEach((name) => (row[colIndex.get(name)!] = int(1, o.rows)))
            break
          default:
            copyKey(row, fk, fp.nullable && rng() < 0.15 ? null : parents[int(0, parents.length - 1)] ?? null, pt)
        }
      })
    })

    const table: SeedTable = { plan: tp, rows }
    done.set(t.name, table)
    out.push(table)
  }
  return { tables: out, warnings: plan.warnings }
}

// ---------------------------------------------------------------------------------------------
// Export SQL INSERT
// ---------------------------------------------------------------------------------------------

export interface SeedSqlOptions {
  dialect: SqlDialect
  autoIncrement: boolean
}

/** Littéral SQL d'une valeur. */
export function sqlLiteral(v: SeedValue, dialect: SqlDialect): string {
  if (v === null) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return dialect === 'sqlserver' || dialect === 'sqlite' ? (v ? '1' : '0') : v ? 'TRUE' : 'FALSE'
  const quoted = `'${v.replace(/'/g, "''")}'`
  return dialect === 'sqlserver' ? `N${quoted}` : quoted
}

/** Instructions à placer autour des INSERT d'une table dont la clé est auto-incrémentée (identifiants explicites). */
export function identityWrap(tp: TablePlan, o: SeedSqlOptions): { before: string[]; after: string[]; override: boolean } {
  const wrap = { before: [] as string[], after: [] as string[], override: false }
  const key = o.autoIncrement ? tp.table.columns.find((c) => isAutoIncrement(tp.table, c)) : undefined
  if (!key) return wrap
  const q = (n: string) => quoteIdent(n, o.dialect)
  const t = q(tp.table.name)
  if (o.dialect === 'sqlserver') {
    wrap.before.push(`SET IDENTITY_INSERT ${t} ON;`)
    wrap.after.push(`SET IDENTITY_INSERT ${t} OFF;`)
  } else if (o.dialect === 'postgresql') {
    wrap.after.push(`SELECT setval(pg_get_serial_sequence('${tp.table.name}', '${key.name}'), (SELECT MAX(${q(key.name)}) FROM ${t}));`)
  } else if (o.dialect === 'standard') {
    wrap.override = true
  }
  return wrap
}

/** Script `INSERT INTO` : une instruction multi-lignes par table, dans l'ordre qui respecte les clés étrangères. */
export function seedToSql(data: SeedData, options: Partial<SeedSqlOptions> = {}): string {
  const o: SeedSqlOptions = { dialect: 'standard', autoIncrement: false, ...options }
  if (!data.tables.length) return '-- Aucune table : ajoutez des entités au MCD.\n'
  const q = (n: string) => quoteIdent(n, o.dialect)
  const parts: string[] = []
  for (const { plan, rows } of data.tables) {
    if (!rows.length) continue
    const t = plan.table
    const wrap = identityWrap(plan, o)
    const cols = t.columns.map((c) => q(c.name)).join(', ')
    const values = rows.map((r) => `  (${r.map((v) => sqlLiteral(v, o.dialect)).join(', ')})`).join(',\n')
    parts.push(
      [...wrap.before, `INSERT INTO ${q(t.name)} (${cols})${wrap.override ? ' OVERRIDING SYSTEM VALUE' : ''} VALUES\n${values};`, ...wrap.after].join('\n'),
    )
  }
  const warn = data.warnings.map((w) => `-- Attention : ${w}`).join('\n')
  return `-- Données fictives générées par MCDraw (${rowsSummary(data)})\n${warn ? warn + '\n' : ''}\n${parts.join('\n\n')}\n`
}

const rowsSummary = (data: SeedData) => `${data.tables.reduce((s, t) => s + t.rows.length, 0)} lignes dans ${data.tables.length} tables`

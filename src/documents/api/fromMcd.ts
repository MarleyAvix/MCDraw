/**
 * Génère une API REST à partir d'un MCD : une ressource par entité (avec son schéma d'entrée), le CRUD classique,
 * les listes imbriquées des relations 1–n et les routes de rattachement des associations n–n.
 * S'appuie sur le MLD déjà calculé : les clés primaires et étrangères y sont résolues.
 */
import { meriseToMld } from '../../engine/meriseToMld'
import type { MeriseSchema, MldColumn, MldTable } from '../../types/schema'
import { pathParams, routeKey, type ApiDocument, type ApiEndpoint, type ApiField, type ApiResource, type ApiResponse } from './model'

const camel = (s: string) => s.split('_').filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('')
const pascal = (s: string) => s.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const words = (s: string) => s.replace(/_/g, ' ')

export function plural(w: string): string {
  if (/[sxz]$/.test(w)) return w
  if (/[^aeiouy]y$/.test(w)) return `${w.slice(0, -1)}ies`
  return `${w}s`
}

/** Type de l'API pour une colonne du MLD. */
export function apiTypeOf(col: Pick<MldColumn, 'name' | 'sqlType' | 'dataType'>): string {
  const sql = (col.dataType ?? col.sqlType.split('(')[0]).toUpperCase()
  if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT)$/.test(sql)) return 'int'
  if (/^(DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)$/.test(sql)) return 'number'
  if (/^(BOOLEAN|BOOL|BIT)$/.test(sql)) return 'bool'
  if (sql === 'DATE') return 'date'
  if (/^(DATETIME|TIMESTAMP)$/.test(sql)) return 'datetime'
  return /e-?mail|courriel/i.test(col.name) ? 'email' : 'string'
}

const resp = (status: number, type?: string): ApiResponse => ({ status, ...(type ? { type } : {}) })

export function apiFromMcd(mcd: MeriseSchema, makeId: () => string): { api: ApiDocument; notes: string[] } {
  const mld = meriseToMld(mcd)
  const notes: string[] = []
  const entityTables = mld.tables.filter((t) => t.origin === 'entity')
  const byName = new Map(entityTables.map((t) => [t.name, t]))
  const colOf = (t: MldTable, name: string) => t.columns.find((c) => c.name === name)!

  const usable = entityTables.filter((t) => {
    if (t.primaryKey.length) return true
    notes.push(`« ${t.name} » n’a pas de clé primaire : ignorée.`)
    return false
  })
  const usableNames = new Set(usable.map((t) => t.name))

  // Identifiant relatif (CIF) : la clé primaire contient la clé d'un parent, la ressource s'imbrique sous lui.
  const parentOf = (t: MldTable) => {
    const fk = t.foreignKeys.find((f) => f.columns.every((c) => t.primaryKey.includes(c)) && f.columns.length < t.primaryKey.length && usableNames.has(f.refTable) && f.refTable !== t.name)
    return fk ? { table: byName.get(fk.refTable)!, cols: fk.columns } : undefined
  }

  const coll = (t: MldTable) => plural(t.name).replace(/_/g, '-')
  const paramName = (t: MldTable) => `${camel(t.name)}Id`
  const memo = new Map<string, { collection: string; item: string; types: Record<string, string> }>()
  const pathsOf = (t: MldTable, seen: string[] = []): { collection: string; item: string; types: Record<string, string> } => {
    const known = memo.get(t.name)
    if (known) return known
    const parent = parentOf(t)
    const base = parent && !seen.includes(parent.table.name) ? pathsOf(parent.table, [...seen, t.name]) : undefined
    const own = parent && base ? t.primaryKey.filter((c) => !parent.cols.includes(c)) : t.primaryKey
    const names = own.length === 1 && !(parent && base) ? [paramName(t)] : own.map(camel)
    const types = { ...(base?.types ?? {}), ...Object.fromEntries(own.map((c, i) => [names[i], apiTypeOf(colOf(t, c))])) }
    const collection = `${base ? base.item : ''}/${coll(t)}`
    const out = { collection, item: `${collection}/${names.map((n) => `{${n}}`).join('/')}`, types }
    memo.set(t.name, out)
    return out
  }

  const resources: ApiResource[] = []
  const endpoints: ApiEndpoint[] = []
  const have = new Set<string>()
  const add = (e: Omit<ApiEndpoint, 'id' | 'params'> & { types: Record<string, string> }) => {
    const { types, ...rest } = e
    const ep: ApiEndpoint = { id: makeId(), ...rest, params: pathParams(rest.path, types) }
    if (have.has(routeKey(ep))) return notes.push(`Route ${ep.method} ${ep.path} déjà générée : doublon ignoré.`)
    have.add(routeKey(ep))
    endpoints.push(ep)
  }

  for (const t of usable) {
    const name = pascal(t.name)
    const p = pathsOf(t)
    const parent = parentOf(t)
    const fieldOf = (c: MldColumn): ApiField => ({ name: camel(c.name), type: apiTypeOf(c), ...(c.nullable && !c.isPrimaryKey ? { optional: true } : {}) })
    const inputCols = t.columns.filter((c) => (t.primaryKey.length === 1 ? !t.primaryKey.includes(c.name) : !parent?.cols.includes(c.name)))
    resources.push({ id: makeId(), name, fields: t.columns.map(fieldOf) }, { id: makeId(), name: `${name}Input`, description: `Données pour créer ou modifier : ${words(t.name)}.`, fields: inputCols.map(fieldOf) })

    const label = words(t.name)
    const conflict = t.columns.some((c) => c.unique && !c.isPrimaryKey)
    const notFound = p.collection.includes('{') ? [resp(404)] : [] // collection imbriquée : le parent peut ne pas exister
    add({ method: 'GET', path: p.collection, summary: `Lister : ${words(plural(t.name))}`, paginated: true, responses: [resp(200, `${name}[]`), ...notFound], types: p.types })
    add({ method: 'POST', path: p.collection, summary: `Créer : ${label}`, auth: true, body: { type: `${name}Input` }, responses: [resp(201, name), resp(400), resp(401), resp(403), ...(conflict ? [resp(409)] : []), ...notFound], types: p.types })
    add({ method: 'GET', path: p.item, summary: `Détail : ${label}`, responses: [resp(200, name), resp(404)], types: p.types })
    add({ method: 'PUT', path: p.item, summary: `Modifier : ${label}`, auth: true, body: { type: `${name}Input` }, responses: [resp(200, name), resp(400), resp(401), resp(403), resp(404), ...(conflict ? [resp(409)] : [])], types: p.types })
    add({ method: 'DELETE', path: p.item, summary: `Supprimer : ${label}`, auth: true, responses: [resp(204), resp(401), resp(403), resp(404)], types: p.types })
  }

  // Relations 1–n : les enfants d'un parent se listent sous lui (hors parent CIF, déjà imbriqué).
  for (const t of usable) {
    const cif = parentOf(t)
    for (const fk of t.foreignKeys) {
      const parent = byName.get(fk.refTable)
      if (!parent || !usableNames.has(parent.name) || fk.columns.every((c) => t.primaryKey.includes(c))) continue
      if (parent.name === t.name) {
        notes.push(`Relation réflexive de « ${t.name} » : liste des enfants non générée.`)
        continue
      }
      if (cif?.table.name === parent.name) continue
      const pp = pathsOf(parent)
      add({ method: 'GET', path: `${pp.item}/${coll(t)}`, summary: `Lister : ${words(plural(t.name))} de ${words(parent.name)}`, paginated: true, responses: [resp(200, `${pascal(t.name)}[]`), resp(404)], types: pp.types })
    }
  }

  // Associations n–n : rattacher / détacher / lister depuis l'un des côtés.
  for (const a of mld.tables.filter((t) => t.origin === 'association')) {
    const sides = a.foreignKeys.filter((f) => f.columns.every((c) => a.primaryKey.includes(c)))
    if (sides.length !== 2 || !sides.every((s) => usableNames.has(s.refTable))) {
      notes.push(`Association « ${a.name} » (${sides.length > 2 ? 'n-aire' : 'incomplète'}) : routes non générées.`)
      continue
    }
    const [left, right] = sides.map((s) => byName.get(s.refTable)!)
    if (left.name === right.name) {
      notes.push(`Association réflexive « ${a.name} » : routes non générées.`)
      continue
    }
    const [lp, rp] = [pathsOf(left), pathsOf(right)]
    const extras = a.columns.filter((c) => !a.primaryKey.includes(c.name))
    let body: { type: string } | undefined
    if (extras.length) {
      const input = `${pascal(a.name)}Input`
      resources.push({ id: makeId(), name: input, description: `Propriétés du lien : ${words(a.name)}.`, fields: extras.map((c) => ({ name: camel(c.name), type: apiTypeOf(c), ...(c.nullable ? { optional: true } : {}) })) })
      body = { type: input }
    }
    const link = `${lp.item}/${coll(right)}/{${paramName(right)}}`
    const types = { ...lp.types, [paramName(right)]: apiTypeOf(colOf(right, right.primaryKey[0])) }
    add({ method: 'GET', path: `${lp.item}/${coll(right)}`, summary: `Lister : ${words(plural(right.name))} de ${words(left.name)}`, paginated: true, responses: [resp(200, `${pascal(right.name)}[]`), resp(404)], types: lp.types })
    add({ method: 'GET', path: `${rp.item}/${coll(left)}`, summary: `Lister : ${words(plural(left.name))} de ${words(right.name)}`, paginated: true, responses: [resp(200, `${pascal(left.name)}[]`), resp(404)], types: rp.types })
    add({ method: 'PUT', path: link, summary: `Rattacher : ${words(right.name)} à ${words(left.name)}`, auth: true, ...(body ? { body } : {}), responses: [resp(204), ...(body ? [resp(400)] : []), resp(401), resp(403), resp(404)], types })
    add({ method: 'DELETE', path: link, summary: `Détacher : ${words(right.name)} de ${words(left.name)}`, auth: true, responses: [resp(204), resp(401), resp(403), resp(404)], types })
  }

  return { api: { info: { title: 'API', version: '1.0.0', auth: 'bearer' }, resources, endpoints }, notes }
}

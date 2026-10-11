/**
 * Modèle d'une API REST : des ressources (schémas typés) et des routes (méthode, chemin, paramètres, corps, réponses).
 * Tout ici est pur (pas de Vue, pas de DOM). Le document est une donnée JSON à plat : c'est ce qui permet d'en garder
 * l'historique, de le sauvegarder, de le partager par lien et de l'exporter.
 */

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HttpMethod = (typeof METHODS)[number]
export const isMethod = (v: unknown): v is HttpMethod => typeof v === 'string' && (METHODS as readonly string[]).includes(v)

export type AuthScheme = 'bearer' | 'apiKey' | 'basic'
export const AUTH_SCHEMES: AuthScheme[] = ['bearer', 'apiKey', 'basic']

export interface ApiInfo {
  title?: string
  version?: string
  description?: string
  /** Adresse de base de l'API (`https://api.exemple.fr`). */
  server?: string
  /** Mécanisme d'authentification des routes marquées `auth`. */
  auth?: AuthScheme
}

export interface ApiField {
  name: string
  /** Expression de type normalisée (voir `parseTypeExpr`). */
  type: string
  optional?: boolean
  description?: string
}

/** Une ressource : le schéma d'un objet échangé par l'API (`User`, `Order`…). */
export interface ApiResource {
  id: string
  name: string
  description?: string
  fields: ApiField[]
}

export type ParamIn = 'path' | 'query' | 'header'

export interface ApiParam {
  name: string
  in: ParamIn
  type: string
  optional?: boolean
  description?: string
}

export interface ApiBody {
  type: string
  description?: string
}

export interface ApiResponse {
  status: number
  type?: string
  description?: string
}

export interface ApiEndpoint {
  id: string
  method: HttpMethod
  /** Chemin normalisé : `/users/{id}`. Les paramètres de chemin sont décrits dans `params`. */
  path: string
  summary?: string
  /** La route exige l'authentification déclarée dans `info.auth`. */
  auth?: boolean
  /** Liste paginée : ajoute les paramètres `page` et `limit` et l'en-tête de réponse `X-Total-Count`. */
  paginated?: boolean
  params: ApiParam[]
  body?: ApiBody
  responses: ApiResponse[]
}

export interface ApiDocument {
  info: ApiInfo
  resources: ApiResource[]
  endpoints: ApiEndpoint[]
}

export interface ParseError {
  line: number
  message: string
}

export const emptyApi = (): ApiDocument => ({ info: {}, resources: [], endpoints: [] })

// --- Types ---------------------------------------------------------------------

export const PRIMITIVES = ['string', 'int', 'number', 'bool', 'date', 'datetime', 'uuid', 'email', 'url', 'any'] as const
const ALIASES: Record<string, (typeof PRIMITIVES)[number]> = {
  boolean: 'bool',
  integer: 'int',
  float: 'number',
  double: 'number',
  'date-time': 'datetime',
  text: 'string',
  str: 'string',
}

export type TypeExpr =
  | { kind: 'prim'; name: string; array: boolean }
  | { kind: 'ref'; name: string; array: boolean }
  | { kind: 'enum'; values: string[]; array: boolean }

/** Lit une expression de type : `string`, `int`, `User`, `User[]`, `enum(draft|paid)`. `null` si elle est invalide. */
export function parseTypeExpr(src: string): TypeExpr | null {
  let s = src.trim()
  let array = false
  if (s.endsWith('[]')) {
    array = true
    s = s.slice(0, -2).trim()
  }
  if (!s || s.endsWith('[]')) return null
  const en = /^enum\(([^()]*)\)$/i.exec(s)
  if (en) {
    const values = en[1].split('|').map((v) => v.trim())
    return values.length && values.every((v) => /^[^\s|()]+$/.test(v)) ? { kind: 'enum', values, array } : null
  }
  const lower = s.toLowerCase()
  const prim = (PRIMITIVES as readonly string[]).includes(lower) ? lower : ALIASES[lower]
  if (prim && s === lower) return { kind: 'prim', name: prim, array }
  if (/^[A-Z][A-Za-z0-9_]*$/.test(s)) return { kind: 'ref', name: s, array }
  return null
}

export function typeToString(t: TypeExpr): string {
  const base = t.kind === 'enum' ? `enum(${t.values.join('|')})` : t.name
  return t.array ? `${base}[]` : base
}

/** Forme canonique d'une expression de type (alias résolus), ou `null` si elle est invalide. */
export function normalizeType(src: string): string | null {
  const t = parseTypeExpr(src)
  return t ? typeToString(t) : null
}

/** Noms de ressources cités par une expression de type. */
export const refsOf = (type: string | undefined): string[] => {
  const t = type ? parseTypeExpr(type) : null
  return t?.kind === 'ref' ? [t.name] : []
}

/** Un paramètre (chemin, requête, en-tête) est une valeur simple : primitive ou énumération, jamais un objet ni une liste. */
export function isParamType(type: string): boolean {
  const t = parseTypeExpr(type)
  return !!t && t.kind !== 'ref' && !t.array
}

// --- Chemins ---------------------------------------------------------------------

const PLACEHOLDER = /^\{([A-Za-z_]\w*)(?::([^{}]+))?\}$/

/**
 * Normalise un chemin saisi : `/users/{id:uuid}/` → `/users/{id}`, avec les types annoncés (`{ id: 'uuid' }`).
 * `error` décrit le problème si le chemin est inutilisable.
 */
export function normalizePath(raw: string): { path: string; types: Record<string, string>; error?: string } {
  const types: Record<string, string> = {}
  const segs: string[] = []
  for (const seg of raw.split('/').filter(Boolean)) {
    if (/\s/.test(seg)) return { path: '/', types, error: 'Un chemin ne contient pas d’espace.' }
    if (/[{}]/.test(seg)) {
      const m = PLACEHOLDER.exec(seg)
      if (!m) return { path: '/', types, error: `Paramètre de chemin invalide : ${seg}` }
      if (m[2]) types[m[1]] = m[2].trim()
      segs.push(`{${m[1]}}`)
    } else segs.push(seg)
  }
  return { path: `/${segs.join('/')}`, types }
}

export const segmentsOf = (path: string) => path.split('/').filter(Boolean)
export const isParamSegment = (seg: string) => seg.startsWith('{') && seg.endsWith('}')
export const paramNamesOf = (path: string) => segmentsOf(path).filter(isParamSegment).map((s) => s.slice(1, -1))
/** Forme d'un chemin sans le nom de ses paramètres : `/users/{id}` et `/users/{userId}` désignent la même route. */
export const pathShape = (path: string) => `/${segmentsOf(path).map((s) => (isParamSegment(s) ? '{}' : s)).join('/')}`

export const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Créé',
  202: 'Accepté',
  204: 'Pas de contenu',
  301: 'Redirection permanente',
  302: 'Redirection',
  304: 'Non modifié',
  400: 'Requête invalide',
  401: 'Non authentifié',
  403: 'Accès interdit',
  404: 'Introuvable',
  405: 'Méthode non autorisée',
  409: 'Conflit',
  410: 'Supprimé définitivement',
  415: 'Type de média non supporté',
  422: 'Données non valides',
  429: 'Trop de requêtes',
  500: 'Erreur serveur',
  502: 'Mauvaise passerelle',
  503: 'Service indisponible',
}
export const statusText = (status: number) => STATUS_TEXT[status] ?? (status < 300 ? 'Succès' : status < 400 ? 'Redirection' : status < 500 ? 'Erreur client' : 'Erreur serveur')
export const isSuccess = (status: number) => status >= 200 && status < 300

/** Construit les paramètres de chemin d'une route : un par `{nom}`, typés d'après la saisie (chaîne par défaut). */
export function pathParams(path: string, types: Record<string, string | undefined> = {}): ApiParam[] {
  const seen = new Set<string>()
  const out: ApiParam[] = []
  for (const name of paramNamesOf(path)) {
    if (seen.has(name)) continue
    seen.add(name)
    const declared = types[name] ? normalizeType(types[name]!) : null
    out.push({ name, in: 'path', type: declared && isParamType(declared) ? declared : 'string' })
  }
  return out
}

/** Clé qui identifie une route, indépendamment de son identifiant technique. */
export const routeKey = (e: Pick<ApiEndpoint, 'method' | 'path'>) => `${e.method} ${pathShape(e.path)}`

// --- Validation d'une source externe -------------------------------------------

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const records = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : [])
const optStr = (v: unknown) => str(v).trim() || undefined

/**
 * Valide un document venu de l'extérieur (fichier, lien, sauvegarde) : champs complétés, types normalisés, identifiants
 * manquants ou en double régénérés, routes invalides écartées. Lève une Error si la structure est inutilisable.
 */
export function sanitizeApi(raw: unknown, makeId: () => string): ApiDocument {
  if (!isRecord(raw) || !Array.isArray(raw.endpoints)) throw new Error('Fichier invalide : liste de routes manquante.')

  const used = new Set<string>()
  const idOf = (v: unknown) => {
    let id = typeof v === 'string' && v && !used.has(v) ? v : makeId()
    while (used.has(id)) id = makeId()
    used.add(id)
    return id
  }
  const typeOf = (v: unknown, fallback: string) => normalizeType(str(v)) ?? fallback

  const info: ApiInfo = {}
  if (isRecord(raw.info)) {
    for (const k of ['title', 'version', 'description', 'server'] as const) {
      const v = optStr(raw.info[k])
      if (v) info[k] = v
    }
    if (AUTH_SCHEMES.includes(raw.info.auth as AuthScheme)) info.auth = raw.info.auth as AuthScheme
  }

  const resources: ApiResource[] = records(raw.resources).map((r) => ({
    id: idOf(r.id),
    name: str(r.name).trim(),
    ...(optStr(r.description) ? { description: optStr(r.description) } : {}),
    fields: records(r.fields)
      .filter((f) => str(f.name).trim())
      .map((f) => ({
        name: str(f.name).trim(),
        type: typeOf(f.type, 'any'),
        ...(f.optional === true ? { optional: true } : {}),
        ...(optStr(f.description) ? { description: optStr(f.description) } : {}),
      })),
  }))

  const endpoints: ApiEndpoint[] = []
  for (const r of records(raw.endpoints)) {
    const method = str(r.method).toUpperCase()
    if (!isMethod(method)) continue
    const { path, types, error } = normalizePath(str(r.path))
    if (error || !str(r.path).trim()) continue

    const declaredPath = new Map(records(r.params).filter((p) => p.in === 'path').map((p) => [str(p.name), str(p.type)]))
    const params: ApiParam[] = pathParams(path, { ...types, ...Object.fromEntries(declaredPath) })
    for (const p of records(r.params)) {
      if ((p.in !== 'query' && p.in !== 'header') || !str(p.name).trim()) continue
      const type = typeOf(p.type, 'string')
      params.push({
        name: str(p.name).trim(),
        in: p.in,
        type: isParamType(type) ? type : 'string',
        ...(p.optional === true ? { optional: true } : {}),
        ...(optStr(p.description) ? { description: optStr(p.description) } : {}),
      })
    }

    const seen = new Set<number>()
    const responses: ApiResponse[] = []
    for (const x of records(r.responses)) {
      const status = Number(x.status)
      if (!Number.isInteger(status) || status < 100 || status > 599 || seen.has(status)) continue
      seen.add(status)
      const type = x.type === undefined ? null : normalizeType(str(x.type))
      responses.push({ status, ...(type ? { type } : {}), ...(optStr(x.description) ? { description: optStr(x.description) } : {}) })
    }

    const bodyType = isRecord(r.body) ? normalizeType(str(r.body.type)) : null
    endpoints.push({
      id: idOf(r.id),
      method,
      path,
      ...(optStr(r.summary) ? { summary: optStr(r.summary) } : {}),
      ...(r.auth === true ? { auth: true } : {}),
      ...(r.paginated === true ? { paginated: true } : {}),
      params,
      ...(bodyType ? { body: { type: bodyType, ...(isRecord(r.body) && optStr(r.body.description) ? { description: optStr(r.body.description) } : {}) } } : {}),
      responses,
    })
  }
  return { info, resources, endpoints }
}

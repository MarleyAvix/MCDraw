/**
 * Import d'un document OpenAPI 3.x (JSON ou YAML) : il devient une API éditable dans MCDraw.
 * L'import est volontairement tolérant : ce qui ne se représente pas (oneOf, objets libres, réponses `default`…) est
 * simplifié et signalé dans `notes`, jamais refusé. Les textes sont ramenés sur une ligne, car la saisie texte l'exige.
 */
import {
  defaultTag,
  isMethod,
  isParamType,
  normalizePath,
  pathParams,
  sanitizeApi,
  statusText,
  type ApiDocument,
  type ApiEndpoint,
  type ApiField,
  type ApiInfo,
  type ApiParam,
  type ApiResource,
  type ApiResponse,
  type AuthScheme,
} from './model'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const strOf = (v: unknown) => (typeof v === 'string' ? v : '')

/** Lit un fichier OpenAPI : JSON d'abord, puis YAML (bibliothèque chargée à la demande). */
export async function parseOpenApiSource(text: string): Promise<unknown> {
  try {
    return JSON.parse(text)
  } catch {
    /* peut être du YAML */
  }
  try {
    return (await import('yaml')).parse(text)
  } catch {
    throw new Error('Fichier illisible : ni JSON ni YAML valide.')
  }
}

/** Texte sur une ligne, sans les séquences qui ont un sens dans la saisie texte (« -- », « -> », « [auth] »). */
export function oneLine(s: unknown, max = 200): string {
  const t = strOf(s)
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)--(?=\s|$)/g, '$1–')
    .replace(/->/g, '→')
    .replace(/\[(auth|paginated|deprecated)\]/gi, '($1)')
    .trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const pascal = (s: string) => s.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, __, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '')

const FORMATS: Record<string, string> = { date: 'date', 'date-time': 'datetime', uuid: 'uuid', email: 'email', uri: 'url', url: 'url' }

interface Flat {
  properties: Record<string, unknown>
  required: string[]
  description?: string
}

export function openApiToApi(raw: unknown, makeId: () => string): { api: ApiDocument; notes: string[] } {
  if (!isObj(raw)) throw new Error('Fichier invalide : ce n’est pas un document OpenAPI.')
  if (typeof raw.swagger === 'string') throw new Error('Swagger 2.0 n’est pas pris en charge : convertissez d’abord le fichier en OpenAPI 3.')
  if (typeof raw.openapi !== 'string' || !raw.openapi.startsWith('3.')) throw new Error('Fichier invalide : champ « openapi » (version 3.x) manquant.')
  if (raw.paths !== undefined && !isObj(raw.paths)) throw new Error('Fichier invalide : « paths » doit être un objet.')

  const notes = new Set<string>()
  const counts = new Map<string, number>()
  const tally = (msg: string) => counts.set(msg, (counts.get(msg) ?? 0) + 1)

  // --- Pointeurs $ref -----------------------------------------------------------------
  const pointer = (ref: string): unknown => {
    if (!ref.startsWith('#/')) return undefined
    let cur: unknown = raw
    for (const part of ref.slice(2).split('/')) {
      if (!isObj(cur)) return undefined
      cur = cur[decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')]
    }
    return cur
  }
  /** Suit les `$ref` (avec garde-fou contre une boucle) jusqu'à l'objet réel. */
  const deref = (v: unknown): unknown => {
    for (let i = 0; i < 10 && isObj(v) && typeof v.$ref === 'string'; i++) v = pointer(v.$ref)
    return v
  }

  // --- Noms de schémas --------------------------------------------------------------
  const components = isObj(raw.components) ? raw.components : {}
  const schemas = isObj(components.schemas) ? components.schemas : {}
  const taken = new Set<string>()
  const uniqueName = (base: string) => {
    let name = base || 'Schema'
    if (/^\d/.test(name)) name = `S${name}`
    let n = 2
    const root = name
    while (taken.has(name)) name = `${root}${n++}`
    taken.add(name)
    return name
  }
  const names = new Map<string, string>(Object.keys(schemas).map((k) => [k, uniqueName(pascal(k))]))
  const resources: ApiResource[] = []
  const done = new Set<string>()

  /** Propriétés d'un schéma objet, `allOf` fusionné ; `null` si ce n'est pas un objet décrit par des propriétés. */
  function flatten(s: unknown, depth = 0): Flat | null {
    s = deref(s)
    if (!isObj(s) || depth > 6) return null
    const out: Flat = { properties: {}, required: [] }
    for (const part of Array.isArray(s.allOf) ? s.allOf : []) {
      const f = flatten(part, depth + 1)
      if (f) Object.assign(out.properties, f.properties), out.required.push(...f.required)
    }
    if (isObj(s.properties)) Object.assign(out.properties, s.properties)
    if (Array.isArray(s.required)) out.required.push(...s.required.filter((r): r is string => typeof r === 'string'))
    if (strOf(s.description)) out.description = oneLine(s.description)
    return Object.keys(out.properties).length ? out : null
  }

  const nullType = (s: unknown) => isObj(s) && (s.type === 'null' || (Array.isArray(s.type) && s.type.length === 1 && s.type[0] === 'null'))

  /** Type MCDraw d'un schéma ; les objets en ligne deviennent des ressources nommées d'après `hint`. */
  function typeOf(s: unknown, hint: string, depth = 0): { type: string; nullable: boolean } {
    if (!isObj(s) || depth > 8) return { type: 'any', nullable: false }
    if (typeof s.$ref === 'string') {
      const m = /^#\/components\/schemas\/(.+)$/.exec(s.$ref)
      const key = m ? decodeURIComponent(m[1]).replace(/~1/g, '/').replace(/~0/g, '~') : undefined
      if (!key || !(key in schemas)) {
        tally('référence externe ou inconnue remplacée par « any »')
        return { type: 'any', nullable: false }
      }
      ensureResource(key)
      return flatten(schemas[key]) ? { type: names.get(key)!, nullable: false } : typeOf(schemas[key], hint, depth + 1)
    }
    let nullable = s.nullable === true
    let t = s.type
    if (Array.isArray(t)) {
      const real = t.filter((x) => x !== 'null')
      nullable ||= real.length < t.length
      t = real.length === 1 ? real[0] : undefined
    }
    for (const key of ['oneOf', 'anyOf'] as const) {
      const alts = s[key]
      if (!Array.isArray(alts)) continue
      const real = alts.filter((a) => !nullType(a))
      if (real.length === 1) return { ...typeOf(real[0], hint, depth + 1), nullable: nullable || real.length < alts.length }
      tally('oneOf / anyOf simplifié en « any »')
      return { type: 'any', nullable }
    }
    if (Array.isArray(s.allOf) && !isObj(s.properties)) {
      const parts = s.allOf.filter((a) => !nullType(a))
      if (parts.length === 1) return { ...typeOf(parts[0], hint, depth + 1), nullable }
    }

    if (Array.isArray(s.enum)) {
      const values = s.enum.filter((v) => v !== null)
      if (values.length && values.every((v) => typeof v === 'string' && /^[^\s|()]+$/.test(v))) return { type: `enum(${values.join('|')})`, nullable: nullable || values.length < s.enum.length }
      if (t === 'integer') return { type: 'int', nullable }
      if (t === 'number') return { type: 'number', nullable }
      if (t === 'boolean') return { type: 'bool', nullable }
      return { type: 'string', nullable }
    }

    if (t === 'array') {
      const inner = typeOf(s.items, hint, depth + 1).type
      if (inner.endsWith('[]')) {
        tally('liste de listes simplifiée en « any[] »')
        return { type: 'any[]', nullable }
      }
      return { type: `${inner}[]`, nullable }
    }
    if (t === 'object' || t === undefined || isObj(s.properties) || Array.isArray(s.allOf)) {
      const flat = flatten(s)
      if (flat) return { type: inlineResource(hint, flat), nullable }
      if (t === 'object' && s.additionalProperties) tally('objet libre (additionalProperties) simplifié en « any »')
      return { type: 'any', nullable }
    }
    if (t === 'string') return { type: FORMATS[strOf(s.format)] ?? 'string', nullable }
    if (t === 'integer') return { type: 'int', nullable }
    if (t === 'number') return { type: 'number', nullable }
    if (t === 'boolean') return { type: 'bool', nullable }
    return { type: 'any', nullable }
  }

  const fieldNames = (props: string[]) => {
    const used = new Set<string>()
    return props.map((p) => {
      let name = /^[A-Za-z_][\w.[\]-]*$/.test(p) ? p : p.replace(/[^\w.[\]-]+/g, '_').replace(/^(?=\d)|^(?=[.[\]-])/, '_') || '_'
      if (name !== p) tally('noms de champs ou de paramètres modifiés (caractères non pris en charge)')
      const root = name
      for (let n = 2; used.has(name); n++) name = `${root}${n}`
      used.add(name)
      return name
    })
  }

  function fieldsOf(flat: Flat, owner: string): ApiField[] {
    const props = Object.keys(flat.properties)
    const safe = fieldNames(props)
    return props.map((p, i) => {
      const sub = flat.properties[p]
      const { type, nullable } = typeOf(sub, `${owner}${pascal(p)}`)
      const desc = isObj(sub) && !sub.$ref ? oneLine(sub.description) : ''
      return { name: safe[i], type, ...(!flat.required.includes(p) || nullable ? { optional: true } : {}), ...(desc ? { description: desc } : {}) }
    })
  }

  /** Crée la ressource d'un schéma nommé (une seule fois, même si elle se cite elle-même). */
  function ensureResource(key: string) {
    if (done.has(key)) return
    done.add(key)
    const flat = flatten(schemas[key])
    if (!flat) return
    const name = names.get(key)!
    const res: ApiResource = { id: makeId(), name, ...(flat.description ? { description: flat.description } : {}), fields: [] }
    resources.push(res)
    res.fields = fieldsOf(flat, name)
  }

  function inlineResource(hint: string, flat: Flat): string {
    const name = uniqueName(pascal(hint))
    const res: ApiResource = { id: makeId(), name, ...(flat.description ? { description: flat.description } : {}), fields: [] }
    resources.push(res)
    res.fields = fieldsOf(flat, name)
    return name
  }

  for (const key of Object.keys(schemas)) ensureResource(key)

  // --- Sécurité -----------------------------------------------------------------------
  const secSchemes = isObj(components.securitySchemes) ? components.securitySchemes : {}
  const authOf = (scheme: unknown): AuthScheme => {
    const s = deref(scheme)
    if (isObj(s) && s.type === 'apiKey') return 'apiKey'
    if (isObj(s) && s.type === 'http' && strOf(s.scheme).toLowerCase() === 'basic') return 'basic'
    if (isObj(s) && s.type === 'http' && strOf(s.scheme).toLowerCase() === 'bearer') return 'bearer'
    tally('authentification OAuth2 / OpenID simplifiée en jeton Bearer')
    return 'bearer'
  }
  const requires = (sec: unknown) => Array.isArray(sec) && sec.some((r) => isObj(r) && Object.keys(r).length > 0)
  const firstUsed = (sec: unknown) => (Array.isArray(sec) ? sec.flatMap((r) => (isObj(r) ? Object.keys(r) : []))[0] : undefined)

  // --- Routes -------------------------------------------------------------------------
  const endpoints: ApiEndpoint[] = []
  let firstSecurity: string | undefined = firstUsed(raw.security)

  for (const [rawPath, item] of Object.entries(isObj(raw.paths) ? raw.paths : {})) {
    const pathItem = deref(item)
    if (!isObj(pathItem)) continue
    const { path, error } = normalizePath(rawPath)
    if (error) {
      tally('route ignorée (chemin invalide)')
      continue
    }

    for (const key of Object.keys(pathItem)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(key)) continue
      if (['head', 'options', 'trace'].includes(key)) tally(`méthode ${key.toUpperCase()} ignorée`)
    }

    for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = deref(pathItem[m])
      const method = m.toUpperCase()
      if (!isObj(op) || !isMethod(method)) continue
      const opName = pascal(strOf(op.operationId) || `${m} ${path}`) || 'Operation'

      // Paramètres : ceux de l'opération l'emportent sur ceux du chemin.
      const merged = new Map<string, Json>()
      for (const p of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
        const d = deref(p)
        if (isObj(d) && typeof d.name === 'string' && typeof d.in === 'string') merged.set(`${d.in}:${d.name}`, d)
      }
      const typed: Record<string, string> = {}
      const extra: ApiParam[] = []
      let hasPage = false
      let hasLimit = false
      const all = [...merged.values()]
      const safe = new Map<Json, string>()
      for (const where of ['query', 'header'] as const) {
        const group = all.filter((p) => p.in === where)
        const renamed = fieldNames(group.map((p) => p.name as string))
        group.forEach((p, i) => safe.set(p, renamed[i]))
      }
      for (const p of all) {
        const name = p.name as string
        if (p.in === 'cookie') {
          tally('paramètre de cookie ignoré')
          continue
        }
        if (p.in !== 'path' && p.in !== 'query' && p.in !== 'header') continue
        if (p.in === 'header' && ['authorization', 'content-type', 'accept'].includes(name.toLowerCase())) continue
        let { type } = typeOf(isObj(p.schema) ? p.schema : isObj(p.content) ? Object.values(p.content).find(isObj)?.schema : undefined, `${opName}${pascal(name)}`)
        if (type.endsWith('[]')) {
          tally('paramètre liste simplifié en valeur simple')
          type = type.slice(0, -2)
        }
        if (!isParamType(type)) type = 'string'
        if (p.in === 'path') {
          typed[name] = type
          continue
        }
        if (p.in === 'query' && name === 'page') hasPage = true
        if (p.in === 'query' && name === 'limit') hasLimit = true
        const desc = oneLine(p.description)
        extra.push({ name: safe.get(p)!, in: p.in, type, ...(p.required === true ? {} : { optional: true }), ...(desc ? { description: desc } : {}) })
      }
      const paginated = hasPage && hasLimit
      // Requêtes avant en-têtes : c'est l'ordre dans lequel la saisie texte les écrit.
      const kept = extra.filter((p) => !(paginated && p.in === 'query' && (p.name === 'page' || p.name === 'limit')))
      const params = [...pathParams(path, typed), ...kept.filter((p) => p.in === 'query'), ...kept.filter((p) => p.in === 'header')]

      // Corps de la requête.
      let body: ApiEndpoint['body']
      const rb = deref(op.requestBody)
      if (isObj(rb) && isObj(rb.content)) {
        const media = rb.content['application/json'] ?? Object.entries(rb.content).find(([k]) => /json/i.test(k))?.[1] ?? Object.values(rb.content)[0]
        if (isObj(media) && media.schema !== undefined) {
          const desc = oneLine(rb.description)
          body = { type: typeOf(media.schema, `${opName}Request`).type, ...(desc ? { description: desc } : {}) }
        }
      }

      // Réponses.
      const responses: ApiResponse[] = []
      const entries = Object.entries(isObj(op.responses) ? op.responses : {})
      for (const [code, r] of entries) {
        const status = Number(code)
        if (!/^\d{3}$/.test(code) || status < 100 || status > 599) {
          tally(`réponse « ${code} » ignorée`)
          continue
        }
        const resp = deref(r)
        if (!isObj(resp)) continue
        let type: string | undefined
        if (isObj(resp.content)) {
          const media = resp.content['application/json'] ?? Object.entries(resp.content).find(([k]) => /json/i.test(k))?.[1] ?? Object.values(resp.content)[0]
          if (isObj(media) && media.schema !== undefined) type = typeOf(media.schema, `${opName}Response${status >= 300 ? status : ''}`).type
        }
        const desc = oneLine(resp.description)
        responses.push({ status, ...(type ? { type } : {}), ...(desc && desc !== statusText(status) ? { description: desc } : {}) })
      }

      const sec = op.security !== undefined ? op.security : raw.security
      firstSecurity ??= firstUsed(sec)
      const summary = oneLine(op.summary) || oneLine(strOf(op.description).split(/(?<=[.!?])\s|\n/)[0], 120)
      // La description n'est conservée que si elle apporte plus que le résumé (sinon elle l'a déjà fourni).
      const description = op.summary !== undefined ? oneLine(op.description, 500) : ''
      const rawTags = (Array.isArray(op.tags) ? op.tags : []).map((t) => oneLine(t, 60).replace(/,/g, ' ')).filter(Boolean)
      // Un groupe identique à celui que le chemin donne déjà n'est pas une information : il est déduit à l'export.
      const tags = rawTags.length === 1 && rawTags[0] === defaultTag(path) ? [] : [...new Set(rawTags)]
      endpoints.push({
        id: makeId(),
        method,
        path,
        ...(summary ? { summary } : {}),
        ...(description && description !== summary ? { description } : {}),
        ...(tags.length ? { tags } : {}),
        ...(op.deprecated === true ? { deprecated: true } : {}),
        ...(requires(sec) ? { auth: true } : {}),
        ...(paginated ? { paginated: true } : {}),
        params,
        ...(body ? { body } : {}),
        responses,
      })
    }
  }

  // --- Informations générales ----------------------------------------------------------
  const info: ApiInfo = {}
  const rawInfo = isObj(raw.info) ? raw.info : {}
  for (const k of ['title', 'version', 'description'] as const) {
    const v = oneLine(rawInfo[k], k === 'description' ? 300 : 120)
    if (v) info[k] = v
  }
  const server = Array.isArray(raw.servers) && isObj(raw.servers[0]) ? strOf(raw.servers[0].url).trim() : ''
  if (server) info.server = oneLine(server)
  const schemeKey = (firstSecurity && firstSecurity in secSchemes ? firstSecurity : undefined) ?? Object.keys(secSchemes)[0]
  if (schemeKey) {
    info.auth = authOf(secSchemes[schemeKey])
  }

  for (const [msg, n] of counts) notes.add(n > 1 ? `${msg} (${n} fois)` : msg)
  // Une dernière validation garantit un document cohérent (types normalisés, identifiants uniques).
  return { api: sanitizeApi({ info, resources, endpoints }, makeId), notes: [...notes] }
}

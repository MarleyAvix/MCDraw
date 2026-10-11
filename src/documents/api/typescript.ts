/**
 * Export TypeScript : les types des ressources et un client `fetch` typé, sans dépendance, prêt à copier dans un projet.
 * Une méthode par route (nommée comme son `operationId` OpenAPI) ; les erreurs HTTP lèvent une `ApiError`.
 */
import { isSuccess, parseTypeExpr, segmentsOf, isParamSegment, type ApiDocument, type ApiEndpoint, type ApiParam } from './model'
import { operationIds } from './openapi'

const IDENT = /^[A-Za-z_$][\w$]*$/
/** Clé d'objet : telle quelle si c'est un identifiant, entre guillemets sinon (`filter[status]`, `X-Request-Id`). */
const key = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name))
/** Accès à une propriété : `args.id` ou `args["user-id"]`. */
const access = (obj: string, name: string) => (IDENT.test(name) ? `${obj}.${name}` : `${obj}[${JSON.stringify(name)}]`)
const doc = (text: string | undefined, pad: string) => (text ? `${pad}/** ${text.replace(/\*\//g, '*\\/')} */\n` : '')

const PRIMITIVE: Record<string, string> = { string: 'string', uuid: 'string', email: 'string', url: 'string', date: 'string', datetime: 'string', int: 'number', number: 'number', bool: 'boolean', any: 'unknown' }

/** Type TypeScript d'une expression de type MCDraw ; un schéma inconnu devient `unknown`. */
export function tsType(type: string, known: Set<string>): string {
  const t = parseTypeExpr(type)
  if (!t) return 'unknown'
  const base = t.kind === 'prim' ? PRIMITIVE[t.name] : t.kind === 'ref' ? (known.has(t.name) ? t.name : 'unknown') : t.values.map((v) => JSON.stringify(v)).join(' | ')
  return t.array ? (t.kind === 'enum' && t.values.length > 1 ? `(${base})[]` : `${base}[]`) : base
}

/** Les noms de propriétés à plat des paramètres de chemin ne doivent pas heurter `query`, `headers`, `body`. */
const pathKey = (name: string) => (['query', 'headers', 'body'].includes(name) ? `${name}Path` : name)

interface Shape {
  /** Type de l'argument de la méthode, `null` si elle n'en prend pas. */
  args: string | null
  /** L'argument est obligatoire (au moins un élément obligatoire). */
  required: boolean
}

function argsOf(e: ApiEndpoint, known: Set<string>): Shape {
  const props: string[] = []
  let required = false
  for (const p of e.params.filter((p) => p.in === 'path')) {
    props.push(`${key(pathKey(p.name))}: ${tsType(p.type, known)}`)
    required = true
  }
  const group = (where: 'query' | 'header', extra: ApiParam[] = []) => {
    const list = [...e.params.filter((p) => p.in === where), ...extra]
    if (!list.length) return
    const must = list.some((p) => !p.optional)
    const name = where === 'query' ? 'query' : 'headers'
    props.push(`${name}${must ? '' : '?'}: { ${list.map((p) => `${key(p.name)}${p.optional ? '?' : ''}: ${tsType(p.type, known)}`).join('; ')} }`)
    required ||= must
  }
  const declared = new Set(e.params.filter((p) => p.in === 'query').map((p) => p.name))
  group(
    'query',
    e.paginated ? ([{ name: 'page', type: 'int' }, { name: 'limit', type: 'int' }] as const).filter((p) => !declared.has(p.name)).map((p) => ({ ...p, in: 'query' as const, optional: true })) : [],
  )
  group('header')
  if (e.body) {
    props.push(`body: ${tsType(e.body.type, known)}`)
    required = true
  }
  return { args: props.length ? `{ ${props.join('; ')} }` : null, required }
}

export function apiToTypeScript(api: ApiDocument): string {
  const known = new Set(api.resources.map((r) => r.name))
  const names = operationIds(api.endpoints)
  const auth = api.info.auth ?? 'bearer'
  const usesAuth = api.endpoints.some((e) => e.auth)
  const usesPages = api.endpoints.some((e) => e.paginated)
  const out: string[] = [`// Généré par MCDraw${api.info.title ? ` — ${api.info.title}` : ''}${api.info.version ? ` ${api.info.version}` : ''}. Ne contient aucune dépendance.`, '']

  // --- Types ---------------------------------------------------------------------
  const seen = new Set<string>()
  for (const r of api.resources) {
    if (seen.has(r.name) || !IDENT.test(r.name)) continue
    seen.add(r.name)
    out.push(`${doc(r.description, '')}export interface ${r.name} {`)
    for (const f of r.fields) out.push(`${doc(f.description, '  ')}  ${key(f.name)}${f.optional ? '?' : ''}: ${tsType(f.type, known)}`)
    out.push('}', '')
  }

  // --- Infrastructure -------------------------------------------------------------
  out.push(
    '/** Erreur renvoyée quand le serveur répond avec un code HTTP d’échec ; `body` est la réponse décodée. */',
    'export class ApiError extends Error {',
    '  constructor(public readonly status: number, public readonly body: unknown) {',
    '    super(`HTTP ${status}`)',
    "    this.name = 'ApiError'",
    '  }',
    '}',
    '',
  )
  if (usesPages) out.push('/** Une page de résultats ; `total` vient de l’en-tête `X-Total-Count`. */', 'export interface Paginated<T> {', '  items: T', '  total: number | null', '}', '')
  out.push(
    'export interface ClientOptions {',
    `  /** Adresse de l’API${api.info.server ? ` (par défaut ${api.info.server})` : ''}. */`,
    '  baseUrl?: string',
  )
  if (usesAuth) out.push(`  /** ${auth === 'apiKey' ? 'Clé d’API' : auth === 'basic' ? 'Identifiants encodés en base64' : 'Jeton'} des routes protégées, ou une fonction qui le fournit. */`, '  auth?: string | (() => string | Promise<string>)')
  out.push('  /** En-têtes ajoutés à toutes les requêtes. */', '  headers?: Record<string, string>', '  /** Remplace `fetch` (tests, Node, intercepteurs). */', '  fetch?: typeof fetch', '}', '')

  const authHeader = auth === 'apiKey' ? "headers.set('X-API-Key', token)" : auth === 'basic' ? 'headers.set(\'Authorization\', `Basic ${token}`)' : 'headers.set(\'Authorization\', `Bearer ${token}`)'
  out.push(
    `export function createClient(options: ClientOptions = {}) {`,
    `  const baseUrl = (options.baseUrl ?? ${JSON.stringify(api.info.server ?? '')}).replace(/\\/+$/, '')`,
    '',
    '  async function request(method: string, path: string, init: { query?: Record<string, unknown>; headers?: Record<string, unknown>; body?: unknown; auth?: boolean } = {}): Promise<Response> {',
    '    const search = new URLSearchParams()',
    '    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== null) search.set(k, String(v))',
    '    const qs = search.toString()',
    '    const headers = new Headers(options.headers)',
    "    headers.set('Accept', 'application/json')",
    '    for (const [k, v] of Object.entries(init.headers ?? {})) if (v !== undefined && v !== null) headers.set(k, String(v))',
  )
  if (usesAuth) {
    out.push(
      '    if (init.auth) {',
      "      const token = typeof options.auth === 'function' ? await options.auth() : options.auth",
      `      if (token) ${authHeader}`,
      '    }',
    )
  }
  out.push(
    "    if (init.body !== undefined) headers.set('Content-Type', 'application/json')",
    '    const send = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))',
    '    const res = await send(`${baseUrl}${path}${qs ? `?${qs}` : \'\'}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })',
    '    if (!res.ok) throw new ApiError(res.status, await readBody(res))',
    '    return res',
    '  }',
    '',
    '  async function readBody(res: Response): Promise<unknown> {',
    '    const text = await res.text()',
    '    if (!text) return undefined',
    '    try {',
    '      return JSON.parse(text)',
    '    } catch {',
    '      return text',
    '    }',
    '  }',
    '',
    '  return {',
  )

  // --- Une méthode par route -------------------------------------------------------
  const methods: string[] = []
  for (const e of api.endpoints) {
    const shape = argsOf(e, known)
    const ok = e.responses.find((r) => isSuccess(r.status) && r.type)
    const result = ok ? tsType(ok.type!, known) : 'void'
    const returns = e.paginated && ok ? `Paginated<${result}>` : result
    const segs = segmentsOf(e.path).map((s) => (isParamSegment(s) ? `\${encodeURIComponent(String(${access('args', pathKey(s.slice(1, -1)))}))}` : s))
    const path = '`/' + segs.join('/') + '`'
    const hasQuery = e.params.some((p) => p.in === 'query') || e.paginated
    const hasHeaders = e.params.some((p) => p.in === 'header')
    const init = [hasQuery ? 'query: args.query' : '', hasHeaders ? 'headers: args.headers' : '', e.body ? 'body: args.body' : '', e.auth ? 'auth: true' : ''].filter(Boolean)
    const call = `request('${e.method}', ${path}${init.length ? `, { ${init.join(', ')} }` : ''})`
    const defaulted = shape.args && !shape.required ? ' = {}' : ''
    const summary = [e.summary, `${e.method} ${e.path}`].filter(Boolean).join(' — ').replace(/\*\//g, '*\\/')
    const lines = [`    /** ${summary} */`]
    lines.push(`    async ${names.get(e.id)}(${shape.args ? `args: ${shape.args}${defaulted}` : ''}): Promise<${returns}> {`)
    if (e.paginated && ok) {
      lines.push(
        `      const res = await ${call}`,
        "      const total = res.headers.get('X-Total-Count')",
        `      return { items: (await readBody(res)) as ${result}, total: total === null ? null : Number(total) }`,
      )
    } else if (ok) lines.push(`      return (await readBody(await ${call})) as ${result}`)
    else lines.push(`      await ${call}`)
    lines.push('    },')
    methods.push(lines.join('\n'))
  }
  out.push(methods.join('\n\n'), '  }', '}', '')
  out.push('export type Client = ReturnType<typeof createClient>', '')
  return out.join('\n')
}

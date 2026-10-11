/**
 * Saisie textuelle d'une API REST.
 *
 *   @title Boutique
 *   @version 1.0.0
 *   @server https://api.exemple.fr
 *   @auth bearer
 *
 *   schema User -- un utilisateur
 *     id: uuid
 *     email: email
 *     role: enum(admin|user)?
 *
 *   /users
 *     GET Lister les utilisateurs [auth] [paginated] -> 200 User[], 401
 *       ? role: string?
 *       @ X-Request-Id: uuid?
 *     POST Créer un utilisateur
 *       < UserInput
 *       > 201 User
 *       > 409 -- e-mail déjà utilisé
 *     /{id:uuid}
 *       GET Détail -> 200 User, 404
 *
 * Les lignes indentées appartiennent à la ligne du dessus. Chemins : `/segment`, imbriqués. Routes : méthode puis résumé,
 * `[auth]` / `[paginated]`, puis `->` et les réponses (`code type`, séparées par des virgules). Détails d'une route :
 * `<` corps de la requête, `>` réponse (avec note après `--`), `?` paramètre de requête, `@` en-tête.
 * Un champ ou un paramètre est obligatoire sauf si son type finit par `?`. Commentaires : `//` en début de ligne.
 */
import { childrenOf } from '../../core/tree'
import {
  AUTH_SCHEMES,
  isMethod,
  isParamType,
  normalizePath,
  normalizeType,
  pathParams,
  routeKey,
  type ApiDocument,
  type ApiEndpoint,
  type ApiField,
  type ApiInfo,
  type ApiResource,
  type AuthScheme,
  type HttpMethod,
  type ParseError,
} from './model'
import { buildPathTree, endpointsUnder, ROOT_PATH, type PathNode } from './pathTree'

/** Largeur d'indentation d'une ligne (une tabulation compte pour deux espaces). */
const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, '  ').length

/** Sépare une note (« -- … ») du reste de la ligne. */
function splitNote(body: string): [string, string | undefined] {
  const m = /(^|\s)--(\s|$)/.exec(body)
  if (!m) return [body.trim(), undefined]
  return [body.slice(0, m.index).trim(), body.slice(m.index + m[0].length).trim() || undefined]
}

/** Nom d'un champ ou d'un paramètre ; les crochets et points servent aux requêtes de type `filter[status]`. */
const NAME = /^([A-Za-z_][\w.[\]-]*)\s*:\s*(.+)$/

/** `type` ou `type?` → type normalisé et caractère facultatif ; `null` si le type est invalide. */
function readType(src: string): { type: string; optional: boolean } | null {
  const optional = src.trim().endsWith('?')
  const type = normalizeType(optional ? src.trim().slice(0, -1) : src)
  return type ? { type, optional } : null
}

const AUTH_BY_WORD: Record<string, AuthScheme> = Object.fromEntries(AUTH_SCHEMES.map((a) => [a.toLowerCase(), a]))

type Frame =
  | { indent: number; kind: 'path'; raw: string }
  | { indent: number; kind: 'resource'; resource: ApiResource }
  | { indent: number; kind: 'endpoint'; endpoint: ApiEndpoint }
  | { indent: number; kind: 'skip' }

export function parseApiText(text: string, makeId: () => string): { api: ApiDocument; errors: ParseError[] } {
  const info: ApiInfo = {}
  const resources: ApiResource[] = []
  const endpoints: ApiEndpoint[] = []
  const errors: ParseError[] = []
  const stack: Frame[] = []

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = i + 1
    const body = rawLine.trim()
    if (!body || body.startsWith('//')) return
    const indent = indentOf(rawLine)
    const fail = (message: string) => errors.push({ line, message })

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    const skip = () => stack.push({ indent, kind: 'skip' })

    if (parent?.kind === 'skip') return

    // --- Détail d'une route ---------------------------------------------------------
    if (parent?.kind === 'endpoint') {
      const e = parent.endpoint
      const mark = body[0]
      const [content, note] = splitNote(body.slice(1))
      if (mark === '<') {
        const t = normalizeType(content)
        if (!t) return fail(`Type de corps inconnu : « ${content} ».`)
        if (e.body) return fail('Cette route a déjà un corps de requête.')
        e.body = { type: t, ...(note ? { description: note } : {}) }
      } else if (mark === '>') {
        const m = /^(\d{3})(?:\s+(.+))?$/.exec(content)
        if (!m || +m[1] < 100 || +m[1] > 599) return fail('Réponse attendue : « > 200 Type » (code HTTP entre 100 et 599).')
        const type = m[2] ? normalizeType(m[2]) : undefined
        if (m[2] && !type) return fail(`Type de réponse inconnu : « ${m[2]} ».`)
        if (e.responses.some((r) => r.status === +m[1])) return fail(`Le code ${m[1]} est déjà décrit pour cette route.`)
        e.responses.push({ status: +m[1], ...(type ? { type } : {}), ...(note ? { description: note } : {}) })
      } else if (mark === '?' || mark === '@') {
        const m = NAME.exec(content)
        const t = m ? readType(m[2]) : null
        if (!m || !t) return fail(`Paramètre attendu : « ${mark} nom: type » (type simple : string, int, enum(a|b)…).`)
        if (!isParamType(t.type)) return fail('Un paramètre est une valeur simple, pas un objet ni une liste.')
        const where = mark === '?' ? 'query' : 'header'
        if (e.params.some((p) => p.in === where && p.name.toLowerCase() === m[1].toLowerCase())) return fail(`Le paramètre « ${m[1]} » est déjà déclaré.`)
        e.params.push({ name: m[1], in: where, type: t.type, ...(t.optional ? { optional: true } : {}), ...(note ? { description: note } : {}) })
      } else {
        fail('Détail attendu : « < corps », « > réponse », « ? paramètre » ou « @ en-tête ».')
      }
      return
    }

    // --- Champ d'une ressource --------------------------------------------------------
    if (parent?.kind === 'resource') {
      const [content, note] = splitNote(body)
      const m = NAME.exec(content)
      const t = m ? readType(m[2]) : null
      if (!m || !t) return fail('Champ attendu : « nom: type » (string, int, User, User[], enum(a|b)…).')
      if (parent.resource.fields.some((f) => f.name === m[1])) return fail(`Le champ « ${m[1]} » existe déjà.`)
      const field: ApiField = { name: m[1], type: t.type, ...(t.optional ? { optional: true } : {}), ...(note ? { description: note } : {}) }
      parent.resource.fields.push(field)
      return
    }

    // --- Chemin ou route, sous un chemin --------------------------------------------------
    if (parent?.kind === 'path') {
      const word = /^[A-Za-z]+/.exec(body)?.[0].toUpperCase()
      if (body.startsWith('/')) return readPath(body, parent.raw)
      if (word && isMethod(word)) return readMethod(word, body, parent.raw)
      fail('Attendu : un chemin (/…) ou une méthode (GET, POST, PUT, PATCH, DELETE).')
      return skip()
    }

    // --- Niveau supérieur ----------------------------------------------------------
    if (body.startsWith('@')) {
      const m = /^@(\w+)\s*(.*)$/.exec(body)
      if (!m) return fail('Directive inconnue (@title, @version, @description, @server, @auth).')
      const value = m[2].trim()
      switch (m[1].toLowerCase()) {
        case 'title': case 'version': case 'description': case 'server':
          if (!value) return fail(`« @${m[1]} » demande une valeur.`)
          info[m[1].toLowerCase() as 'title' | 'version' | 'description' | 'server'] = value
          return
        case 'auth':
          if (!AUTH_BY_WORD[value.toLowerCase()]) return fail('Authentification : « @auth bearer », « @auth apikey » ou « @auth basic ».')
          info.auth = AUTH_BY_WORD[value.toLowerCase()]
          return
        default:
          return fail('Directive inconnue (@title, @version, @description, @server, @auth).')
      }
    }
    if (/^schema\b/i.test(body)) {
      const [content, note] = splitNote(body.replace(/^schema\s*/i, ''))
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(content)) {
        fail('Nom de schéma invalide : une majuscule puis des lettres ou chiffres (ex. « schema User »).')
        return skip()
      }
      const resource: ApiResource = { id: makeId(), name: content, ...(note ? { description: note } : {}), fields: [] }
      resources.push(resource)
      stack.push({ indent, kind: 'resource', resource })
      return
    }
    if (body.startsWith('/')) return readPath(body, '')
    if (/^(GET|POST|PUT|PATCH|DELETE)\b/i.test(body)) {
      fail('Une route doit se trouver sous un chemin (ex. « /users » puis « GET » en dessous).')
      return skip()
    }
    fail('Ligne non reconnue : attendu @directive, schema, ou un chemin commençant par « / ».')
    skip()

    function readPath(text: string, parentRaw: string) {
      const seg = text.split(/\s+/)[0]
      if (seg !== text.trim()) {
        fail('Un chemin ne contient pas d’espace.')
        return skip()
      }
      const raw = `${parentRaw.replace(/\/+$/, '')}${seg}` || '/'
      const { error } = normalizePath(raw)
      if (error) {
        fail(error)
        return skip()
      }
      stack.push({ indent, kind: 'path', raw })
    }

    function readMethod(method: HttpMethod, text: string, pathRaw: string) {
      let rest = text.slice(method.length)
      const flags = { auth: false, paginated: false }
      rest = rest.replace(/\[(auth|paginated)\]/gi, (_, f: string) => ((flags[f.toLowerCase() as 'auth' | 'paginated'] = true), ' '))
      const arrow = rest.indexOf('->')
      const summary = (arrow < 0 ? rest : rest.slice(0, arrow)).trim().replace(/\s+/g, ' ')

      const { path, types } = normalizePath(pathRaw)
      for (const [name, t] of Object.entries(types)) {
        const n = normalizeType(t)
        if (!n || !isParamType(n)) fail(`Type du paramètre de chemin « ${name} » invalide : « ${t} ».`)
      }
      const endpoint: ApiEndpoint = {
        id: makeId(),
        method,
        path,
        ...(summary ? { summary } : {}),
        ...(flags.auth ? { auth: true } : {}),
        ...(flags.paginated ? { paginated: true } : {}),
        params: pathParams(path, types),
        responses: [],
      }
      if (arrow >= 0) {
        for (const token of rest.slice(arrow + 2).split(',').map((t) => t.trim()).filter(Boolean)) {
          const m = /^(\d{3})(?:\s+(.+))?$/.exec(token)
          const type = m?.[2] ? normalizeType(m[2]) : undefined
          if (!m || +m[1] < 100 || +m[1] > 599) fail(`Réponse invalide : « ${token} » (attendu : code HTTP puis type facultatif).`)
          else if (m[2] && !type) fail(`Type de réponse inconnu : « ${m[2]} ».`)
          else if (endpoint.responses.some((r) => r.status === +m[1])) fail(`Le code ${m[1]} est déjà décrit pour cette route.`)
          else endpoint.responses.push({ status: +m[1], ...(type ? { type } : {}) })
        }
      }
      endpoints.push(endpoint)
      stack.push({ indent, kind: 'endpoint', endpoint })
    }
  })

  return { api: { info, resources, endpoints }, errors }
}

// --- Écriture ------------------------------------------------------------------

const typeSuffix = (t: { type: string; optional?: boolean }) => `${t.type}${t.optional ? '?' : ''}`

function endpointLines(e: ApiEndpoint, pad: string): string[] {
  const compact = e.responses.length > 0 && e.responses.every((r) => !r.description)
  const head = [e.method, e.summary, e.auth ? '[auth]' : '', e.paginated ? '[paginated]' : ''].filter(Boolean).join(' ')
  const out = [`${pad}${head}${compact ? ` -> ${e.responses.map((r) => `${r.status}${r.type ? ` ${r.type}` : ''}`).join(', ')}` : ''}`]
  const inner = `${pad}  `
  if (e.body) out.push(`${inner}< ${e.body.type}${e.body.description ? ` -- ${e.body.description}` : ''}`)
  for (const p of e.params.filter((p) => p.in === 'query')) out.push(`${inner}? ${p.name}: ${typeSuffix(p)}${p.description ? ` -- ${p.description}` : ''}`)
  for (const p of e.params.filter((p) => p.in === 'header')) out.push(`${inner}@ ${p.name}: ${typeSuffix(p)}${p.description ? ` -- ${p.description}` : ''}`)
  if (!compact) for (const r of e.responses) out.push(`${inner}> ${r.status}${r.type ? ` ${r.type}` : ''}${r.description ? ` -- ${r.description}` : ''}`)
  return out
}

/** `{id}` s'écrit `{id:uuid}` quand le paramètre n'est pas une simple chaîne. */
function segmentText(node: PathNode, endpoints: ApiEndpoint[]): string {
  if (!node.segment.startsWith('{')) return `/${node.segment}`
  const name = node.segment.slice(1, -1)
  const typed = endpointsUnder(endpoints, node.id)
    .flatMap((e) => e.params)
    .find((p) => p.in === 'path' && p.name === name && p.type !== 'string')
  return typed ? `/{${name}:${typed.type}}` : `/${node.segment}`
}

export function apiToText(api: ApiDocument): string {
  const blocks: string[][] = []
  const head = ([['title', api.info.title], ['version', api.info.version], ['description', api.info.description], ['server', api.info.server], ['auth', api.info.auth?.toLowerCase()]] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `@${k} ${v}`)
  if (head.length) blocks.push(head)

  for (const r of api.resources) {
    blocks.push([`schema ${r.name}${r.description ? ` -- ${r.description}` : ''}`, ...r.fields.map((f) => `  ${f.name}: ${typeSuffix(f)}${f.description ? ` -- ${f.description}` : ''}`)])
  }

  const nodes = buildPathTree(api.endpoints)
  if (nodes.length) {
    const routes: string[] = []
    const emit = (node: PathNode, depth: number) => {
      const pad = '  '.repeat(depth)
      routes.push(`${pad}${segmentText(node, api.endpoints)}`)
      for (const e of node.endpoints) routes.push(...endpointLines(e, `${pad}  `))
      for (const c of childrenOf(nodes, node.id)) emit(c, depth + 1)
    }
    const root = nodes.find((n) => n.id === ROOT_PATH)!
    if (root.endpoints.length) {
      routes.push('/')
      for (const e of root.endpoints) routes.push(...endpointLines(e, '  '))
      for (const c of childrenOf(nodes, ROOT_PATH)) emit(c, 1)
    } else for (const c of childrenOf(nodes, ROOT_PATH)) emit(c, 0)
    blocks.push(routes)
  }
  return blocks.map((b) => b.join('\n')).join('\n\n')
}

// --- Fusion --------------------------------------------------------------------

/**
 * Réapplique un texte sur un document existant : une route (méthode + forme du chemin) et une ressource (nom) gardent
 * leur identifiant, donc leur sélection, quand elles sont inchangées. Les doublons sont appariés dans l'ordre.
 */
export function mergeApi(existing: ApiDocument, fresh: ApiDocument): ApiDocument {
  const reuse = <T extends { id: string }>(olds: T[], news: T[], key: (x: T) => string): T[] => {
    const pool = new Map<string, string[]>()
    for (const o of olds) pool.set(key(o), [...(pool.get(key(o)) ?? []), o.id])
    return news.map((n) => ({ ...n, id: pool.get(key(n))?.shift() ?? n.id }))
  }
  return {
    info: fresh.info,
    resources: reuse(existing.resources, fresh.resources, (r) => r.name),
    endpoints: reuse(existing.endpoints, fresh.endpoints, routeKey),
  }
}

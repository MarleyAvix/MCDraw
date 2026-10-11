/**
 * Linter de conception REST : repère les routes qui s'écartent des bonnes pratiques usuelles (noms, codes HTTP,
 * cohérence). Tout est pur ; chaque anomalie porte l'identifiant de la route ou de la ressource concernée.
 */
import {
  isParamSegment,
  isSuccess,
  parseTypeExpr,
  pathShape,
  refsOf,
  segmentsOf,
  type ApiDocument,
  type ApiEndpoint,
} from './model'

export type Severity = 'error' | 'warning' | 'info'

export interface LintIssue {
  /** Règle qui a produit l'anomalie (stable : sert aux tests et à un éventuel filtrage). */
  rule: string
  severity: Severity
  message: string
  endpointId?: string
  resourceId?: string
}

const VERBS = new Set(['get', 'create', 'delete', 'update', 'add', 'remove', 'list', 'fetch', 'set', 'new', 'edit', 'find'])
/** Découpe `getUsers`, `create-user`, `create_user` en mots minuscules. */
const words = (seg: string) => seg.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().split(/[-_]/).filter(Boolean)

const label = (e: ApiEndpoint) => `${e.method} ${e.path}`
const has = (e: ApiEndpoint, status: number) => e.responses.some((r) => r.status === status)
const endsWithParam = (e: ApiEndpoint) => {
  const segs = segmentsOf(e.path)
  return segs.length > 0 && isParamSegment(segs[segs.length - 1])
}
const successTypes = (e: ApiEndpoint) => e.responses.filter((r) => isSuccess(r.status))

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

export function lintApi(api: ApiDocument): LintIssue[] {
  const out: LintIssue[] = []
  const add = (rule: string, severity: Severity, message: string, ref: { endpointId?: string; resourceId?: string }) => out.push({ rule, severity, message, ...ref })
  const names = new Set(api.resources.map((r) => r.name))

  // --- Ressources ----------------------------------------------------------------
  const seenRes = new Set<string>()
  for (const r of api.resources) {
    if (seenRes.has(r.name)) add('duplicate-resource', 'error', `Le schéma « ${r.name} » est défini plusieurs fois.`, { resourceId: r.id })
    seenRes.add(r.name)
    for (const f of r.fields) {
      for (const ref of refsOf(f.type)) if (!names.has(ref)) add('unknown-type', 'error', `${r.name}.${f.name} : le schéma « ${ref} » n’existe pas.`, { resourceId: r.id })
    }
  }
  const used = new Set<string>()
  const useIn = (type: string | undefined) => refsOf(type).forEach((n) => used.add(n))
  for (const r of api.resources) for (const f of r.fields) useIn(f.type)

  // --- Routes --------------------------------------------------------------------
  const byRoute = new Map<string, ApiEndpoint[]>()
  for (const e of api.endpoints) {
    byRoute.set(`${e.method} ${pathShape(e.path)}`, [...(byRoute.get(`${e.method} ${pathShape(e.path)}`) ?? []), e])
    useIn(e.body?.type)
    e.responses.forEach((r) => useIn(r.type))

    const refs = [e.body?.type, ...e.responses.map((r) => r.type)].flatMap(refsOf)
    for (const ref of new Set(refs)) if (!names.has(ref)) add('unknown-type', 'error', `${label(e)} : le schéma « ${ref} » n’existe pas.`, { endpointId: e.id })

    const segs = segmentsOf(e.path)
    segs.forEach((seg, i) => {
      if (isParamSegment(seg)) return
      if (/[A-Z_]/.test(seg)) add('path-case', 'warning', `${label(e)} : « ${seg} » devrait être en minuscules, mots séparés par des tirets (kebab-case).`, { endpointId: e.id })
      const w = words(seg)
      if (w.length > 1 && VERBS.has(w[0])) add('verb-in-path', 'warning', `${label(e)} : « ${seg} » contient un verbe ; la méthode HTTP exprime déjà l’action.`, { endpointId: e.id })
      else if (w.length === 1 && VERBS.has(w[0]) && seg !== 'search') add('verb-in-path', 'warning', `${label(e)} : « ${seg} » est un verbe ; préférez un nom de ressource.`, { endpointId: e.id })
      const next = segs[i + 1]
      if (next && isParamSegment(next) && !seg.endsWith('s')) add('plural', 'warning', `${label(e)} : « ${seg} » désigne une collection, mettez-la au pluriel.`, { endpointId: e.id })
    })

    if (!e.responses.length) add('no-response', 'warning', `${label(e)} : aucune réponse décrite.`, { endpointId: e.id })
    else if (!successTypes(e).length) add('no-success', 'warning', `${label(e)} : aucune réponse de succès (2xx).`, { endpointId: e.id })

    if (e.method === 'GET' && e.body) add('get-body', 'error', `${label(e)} : un GET n’a pas de corps de requête.`, { endpointId: e.id })
    if (e.method === 'DELETE' && e.body) add('delete-body', 'warning', `${label(e)} : un DELETE n’a normalement pas de corps de requête.`, { endpointId: e.id })
    if ((e.method === 'POST' || e.method === 'PUT' || e.method === 'PATCH') && !e.body && !e.params.some((p) => p.in === 'query')) {
      add('missing-body', 'info', `${label(e)} : aucun corps de requête décrit.`, { endpointId: e.id })
    }

    if (e.params.some((p) => p.in === 'path') && e.method !== 'POST' && endsWithParam(e) && !has(e, 404)) {
      add('missing-404', 'warning', `${label(e)} : la ressource ciblée peut ne pas exister, ajoutez la réponse 404.`, { endpointId: e.id })
    }
    if ((e.method === 'POST' || e.method === 'PUT' || e.method === 'PATCH') && e.body && !has(e, 400) && !has(e, 422)) {
      add('missing-400', 'info', `${label(e)} : ajoutez 400 ou 422 pour les données invalides.`, { endpointId: e.id })
    }
    if (e.method === 'POST' && has(e, 200) && !has(e, 201) && !has(e, 202)) add('post-status', 'info', `${label(e)} : un POST qui crée une ressource répond 201.`, { endpointId: e.id })
    if (e.method === 'DELETE' && successTypes(e).length && !has(e, 204) && !successTypes(e).some((r) => r.type)) {
      add('delete-status', 'info', `${label(e)} : un DELETE sans contenu répond 204.`, { endpointId: e.id })
    }
    if (e.auth && !has(e, 401)) add('auth-401', 'info', `${label(e)} : route protégée, ajoutez la réponse 401.`, { endpointId: e.id })
    if (e.auth && !has(e, 403) && e.method !== 'GET') add('auth-403', 'info', `${label(e)} : prévoyez 403 si certains rôles n’ont pas le droit.`, { endpointId: e.id })
    if (api.info.auth && e.method !== 'GET' && !e.auth) add('public-write', 'info', `${label(e)} : route modifiante publique alors que l’API a une authentification.`, { endpointId: e.id })
    if (e.auth && !api.info.auth) add('auth-undeclared', 'warning', `${label(e)} : route protégée mais aucune authentification déclarée (@auth).`, { endpointId: e.id })

    const list = e.method === 'GET' && !endsWithParam(e) && e.responses.some((r) => isSuccess(r.status) && parseTypeExpr(r.type ?? '')?.array)
    if (list && !e.paginated) add('unpaginated-list', 'info', `${label(e)} : une liste devrait être paginée ([paginated]).`, { endpointId: e.id })
    if (e.paginated && e.params.some((p) => p.in === 'query' && (p.name === 'page' || p.name === 'limit'))) {
      add('paginated-params', 'info', `${label(e)} : « page » et « limit » sont déjà ajoutés par [paginated].`, { endpointId: e.id })
    }
  }

  for (const group of byRoute.values()) {
    if (group.length > 1) for (const e of group.slice(1)) add('duplicate-route', 'error', `${label(e)} est déjà défini${group[0].path === e.path ? '' : ` (comme ${group[0].path})`}.`, { endpointId: e.id })
  }

  // Un même emplacement de paramètre porte le même nom partout : `/users/{id}` et `/users/{userId}` se contredisent.
  const namesByShape = new Map<string, Map<string, ApiEndpoint>>()
  for (const e of api.endpoints) {
    const shape = pathShape(e.path)
    const m = namesByShape.get(shape) ?? new Map<string, ApiEndpoint>()
    if (!m.has(e.path)) m.set(e.path, e)
    namesByShape.set(shape, m)
  }
  for (const m of namesByShape.values()) {
    if (m.size > 1) for (const e of [...m.values()].slice(1)) add('param-name', 'warning', `${e.path} : nom de paramètre différent d’une route voisine (${[...m.keys()][0]}).`, { endpointId: e.id })
  }

  for (const r of api.resources) {
    if (!used.has(r.name) && api.endpoints.length > 0) add('unused-resource', 'info', `Le schéma « ${r.name} » n’est utilisé par aucune route.`, { resourceId: r.id })
  }

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

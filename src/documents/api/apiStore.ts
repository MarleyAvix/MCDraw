import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Edge, Node } from '@vue-flow/core'
import { useHistory } from '../../composables/useHistory'
import { usePersistence } from '../../composables/usePersistence'
import { layoutHorizontalTree } from '../../core/tree'
import { lintApi } from './lint'
import { emptyApi, pathParams, refsOf, routeKey, sanitizeApi, segmentsOf, type ApiDocument, type ApiEndpoint, type ApiResource, type HttpMethod } from './model'
import { buildPathTree, endpointsUnder, ROOT_PATH, type PathNode } from './pathTree'
import { parseApiText } from './text'

const STORAGE_KEY = 'mcdraw:api:v1'
const uid = () => Math.random().toString(36).slice(2, 10)
/** Copie profonde d'une donnée JSON, y compris un objet réactif (`structuredClone` les refuse). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

// --- Dimensions des cartes (pour la mise en page) ---------------------------------
export const ROUTE_W = 280
const ROUTE_HEADER = 38
const ROUTE_ROW = 28
export const routeHeight = (n: { endpoints: unknown[] }) => ROUTE_HEADER + (n.endpoints.length ? n.endpoints.length * ROUTE_ROW + 8 : 0)
export const RESOURCE_W = 250
const RESOURCE_HEADER = 40
const RESOURCE_ROW = 24
export const resourceHeight = (r: ApiResource) => RESOURCE_HEADER + Math.max(r.fields.length, 1) * RESOURCE_ROW + 30

export interface ApiExample {
  id: string
  label: string
  description: string
  text: string
}

export const API_EXAMPLES: ApiExample[] = [
  {
    id: 'boutique',
    label: 'API de boutique en ligne',
    description: 'Catalogue, commandes, authentification et pagination.',
    text: `@title API Boutique
@version 1.0.0
@description Catalogue de produits et commandes.
@server https://api.boutique.dev
@auth bearer

schema Product -- un article du catalogue
  id: uuid
  name: string
  price: number
  stock: int
  category: enum(book|music|game)
  createdAt: datetime

schema ProductInput
  name: string
  price: number
  stock: int
  category: enum(book|music|game)

schema OrderLine
  productId: uuid
  quantity: int

schema Order
  id: uuid
  status: enum(pending|paid|shipped|cancelled)
  lines: OrderLine[]
  total: number
  createdAt: datetime

schema OrderInput
  lines: OrderLine[]

/products
  GET Lister les produits [paginated] -> 200 Product[]
    ? category: string?
    ? q: string?
    ? sort: enum(price|name|createdAt)?
  POST Créer un produit [auth]
    < ProductInput
    > 201 Product
    > 400
    > 401
    > 403
  /{id:uuid}
    GET Détail d'un produit -> 200 Product, 404
    PUT Modifier un produit [auth]
      < ProductInput
      > 200 Product
      > 400
      > 401
      > 403
      > 404
    DELETE Supprimer un produit [auth] -> 204, 401, 403, 404
/orders
  GET Mes commandes [auth] [paginated] -> 200 Order[], 401
    ? status: enum(pending|paid|shipped|cancelled)?
  POST Passer une commande [auth]
    < OrderInput
    > 201 Order
    > 400
    > 401
    > 403
  /{id:uuid}
    GET Suivre une commande [auth] -> 200 Order, 401, 404
    DELETE Annuler une commande [auth] -> 204, 401, 403, 404`,
  },
  {
    id: 'taches',
    label: 'API de gestion de tâches',
    description: 'Projets et tâches imbriquées, filtres et en-têtes.',
    text: `@title API Tâches
@version 2.1.0
@server https://api.taches.dev/v2
@auth bearer

schema Project
  id: int
  name: string
  archived: bool

schema ProjectInput
  name: string

schema Task
  id: int
  title: string
  done: bool
  dueDate: date?
  priority: enum(low|normal|high)

schema TaskInput
  title: string
  dueDate: date?
  priority: enum(low|normal|high)?

/projects
  GET Lister les projets [auth] [paginated] -> 200 Project[], 401
    ? archived: bool?
  POST Créer un projet [auth]
    < ProjectInput
    > 201 Project
    > 400
    > 401
    > 403
  /{projectId:int}
    GET Détail du projet [auth] -> 200 Project, 401, 404
    DELETE Supprimer le projet [auth] -> 204, 401, 403, 404
    /tasks
      GET Lister les tâches [auth] [paginated] -> 200 Task[], 401, 404
        ? done: bool?
        ? priority: enum(low|normal|high)?
        @ If-None-Match: string?
      POST Ajouter une tâche [auth]
        < TaskInput
        > 201 Task
        > 400
        > 401
        > 403
        > 404
      /{taskId:int}
        PATCH Modifier une tâche [auth]
          < TaskInput
          > 200 Task
          > 400
          > 401
          > 403
          > 404
        DELETE Supprimer une tâche [auth] -> 204, 401, 403, 404`,
  },
  {
    id: 'auth',
    label: 'API d’authentification',
    description: 'Inscription, connexion, jetons et profil.',
    text: `@title API Auth
@version 1.0.0
@server https://auth.exemple.dev
@auth bearer

schema Credentials
  email: email
  password: string

schema Registration -- inscription
  email: email
  password: string
  name: string

schema Tokens
  accessToken: string
  refreshToken: string
  expiresIn: int

schema Profile
  id: uuid
  email: email
  name: string
  createdAt: datetime

schema Problem -- erreur normalisée
  status: int
  title: string
  detail: string?

/auth
  /register
    POST Créer un compte
      < Registration
      > 201 Profile
      > 400 Problem
      > 409 Problem -- e-mail déjà utilisé
  /login
    POST Se connecter
      < Credentials
      > 200 Tokens
      > 400 Problem
      > 401 Problem -- identifiants incorrects
      > 429 Problem -- trop de tentatives
  /refresh
    POST Renouveler le jeton
      < Tokens
      > 200 Tokens
      > 401 Problem
  /logout
    POST Se déconnecter [auth] -> 204, 401
/me
  GET Mon profil [auth] -> 200 Profile, 401
  PATCH Modifier mon profil [auth]
    < Registration
    > 200 Profile
    > 400 Problem
    > 401 Problem
    > 403 Problem`,
  },
]

type RouteGroup = { root: string; endpoints: ApiEndpoint[] }
type Clipboard = { kind: 'routes'; groups: RouteGroup[] } | { kind: 'resources'; items: ApiResource[] }

export const useApiStore = defineStore('api', () => {
  const doc = ref<ApiDocument>(emptyApi())
  const selection = ref<string[]>([])
  const editingEndpointId = ref<string | null>(null)
  const editingResourceId = ref<string | null>(null)
  const showInfoModal = ref(false)
  const showTextPanel = ref(typeof window !== 'undefined' && window.innerWidth >= 1024)
  const highlightId = ref<string | null>(null)
  const view = ref('routes')
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let clipboard: Clipboard | null = null

  const schema = computed<ApiDocument>(() => doc.value)
  const endpoints = computed(() => doc.value.endpoints)
  const resources = computed(() => doc.value.resources)
  const tree = computed(() => buildPathTree(doc.value.endpoints))
  const issues = computed(() => lintApi(doc.value))
  const endpointById = computed(() => new Map(doc.value.endpoints.map((e) => [e.id, e])))
  const resourceById = computed(() => new Map(doc.value.resources.map((r) => [r.id, r])))

  /** Nombre d'autres schémas qui citent chaque schéma dans un de leurs champs. */
  const schemaUsage = computed(() => {
    const out = new Map<string, number>()
    for (const r of doc.value.resources) for (const n of new Set(r.fields.flatMap((f) => refsOf(f.type)))) if (n !== r.name) out.set(n, (out.get(n) ?? 0) + 1)
    return out
  })

  /** Nombre de routes qui utilisent chaque schéma (corps ou réponse). */
  const usage = computed(() => {
    const out = new Map<string, number>()
    for (const e of doc.value.endpoints) for (const n of new Set([e.body?.type, ...e.responses.map((r) => r.type)].flatMap(refsOf))) out.set(n, (out.get(n) ?? 0) + 1)
    return out
  })

  // --- Vue « routes » : arbre des chemins, de gauche à droite --------------------------
  const positions = computed(() => layoutHorizontalTree(tree.value, routeHeight, ROUTE_W, { x: 70, y: 18 }))
  const routeNodes = computed<Node[]>(() =>
    tree.value.map((n) => ({
      id: n.id,
      type: 'route',
      position: positions.value.get(n.id) ?? { x: 0, y: 0 },
      data: { node: n, title: n.id === ROOT_PATH ? doc.value.info.title : undefined },
      selected: selection.value.includes(n.id),
      draggable: false,
      connectable: false,
    })),
  )
  const routeEdges = computed<Edge[]>(() =>
    tree.value
      .filter((n) => n.parentId)
      .map((n) => ({ id: `e:${n.id}`, source: n.parentId!, target: n.id, type: 'smoothstep', selectable: false, focusable: false })),
  )

  // --- Vue « schémas » : cartes en colonnes, reliées par leurs références ------------------
  const resourceNodes = computed<Node[]>(() => {
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(doc.value.resources.length))))
    const heights = Array<number>(cols).fill(0)
    return doc.value.resources.map((r) => {
      const c = heights.indexOf(Math.min(...heights))
      const position = { x: c * (RESOURCE_W + 60), y: heights[c] }
      heights[c] += resourceHeight(r) + 24
      return { id: r.id, type: 'resource', position, data: { resource: r, used: usage.value.get(r.name) ?? 0, usedBySchemas: schemaUsage.value.get(r.name) ?? 0 }, selected: selection.value.includes(r.id), draggable: false, connectable: false }
    })
  })
  const resourceEdges = computed<Edge[]>(() => {
    const byName = new Map(doc.value.resources.map((r) => [r.name, r.id]))
    return doc.value.resources.flatMap((r) =>
      [...new Set(r.fields.flatMap((f) => refsOf(f.type)))]
        .filter((n) => byName.has(n) && byName.get(n) !== r.id)
        .map((n) => ({ id: `e:${r.id}:${n}`, source: r.id, target: byName.get(n)!, type: 'smoothstep', selectable: false, focusable: false, style: { strokeDasharray: '5 4' } })),
    )
  })

  // --- Actions générales -----------------------------------------------------------
  function flash(id: string) {
    clearTimeout(highlightTimer)
    highlightId.value = id
    highlightTimer = setTimeout(() => (highlightId.value = null), 2200)
  }

  const newEndpoint = (method: HttpMethod, path: string): ApiEndpoint => ({ id: uid(), method, path, params: pathParams(path), responses: [{ status: 200 }] })

  /** Insère une route à la suite de celles de son chemin (ou de son sous-arbre), pour garder l'arbre groupé. */
  function insertEndpoint(e: ApiEndpoint, at = e.path) {
    const list = doc.value.endpoints
    let last = -1
    list.forEach((x, i) => {
      if (x.path === at || x.path.startsWith(`${at === ROOT_PATH ? '' : at}/`)) last = i
    })
    list.splice(last + 1 || list.length, 0, e)
  }

  /** Nouvelle route sur `path` (la racine par défaut) ; la fenêtre d'édition s'ouvre dessus. */
  function addEndpoint(path = ROOT_PATH, method: HttpMethod = 'GET'): ApiEndpoint {
    const e = newEndpoint(method, path)
    insertEndpoint(e)
    selection.value = [path]
    editingEndpointId.value = e.id
    return e
  }

  /** Nouvelle route sur un sous-chemin : `{id}` si le chemin n'a pas encore de paramètre en dessous, sinon `nouveau`. */
  function addSubPath(parent = ROOT_PATH): ApiEndpoint {
    const base = parent === ROOT_PATH ? '' : parent
    const taken = (p: string) => doc.value.endpoints.some((e) => e.path === p || e.path.startsWith(`${p}/`))
    let seg = '{id}'
    if (parent === ROOT_PATH || segmentsOf(parent).at(-1)?.startsWith('{') || taken(`${base}/${seg}`)) {
      seg = 'nouveau'
      for (let n = 2; taken(`${base}/${seg}`); n++) seg = `nouveau-${n}`
    }
    return addEndpoint(`${base}/${seg}`)
  }

  function setEndpoint(next: ApiEndpoint) {
    const i = doc.value.endpoints.findIndex((e) => e.id === next.id)
    if (i >= 0) doc.value.endpoints[i] = next
  }

  function removeEndpoint(id: string) {
    doc.value.endpoints = doc.value.endpoints.filter((e) => e.id !== id)
    if (editingEndpointId.value === id) editingEndpointId.value = null
    selection.value = selection.value.filter((p) => p === ROOT_PATH || doc.value.endpoints.some((e) => e.path === p || e.path.startsWith(`${p}/`)))
  }

  /** Supprime les chemins et tout ce qui est en dessous (la racine : seulement ses propres routes). */
  function removePaths(paths: string[]) {
    const gone = new Set(paths.flatMap((p) => (p === ROOT_PATH ? doc.value.endpoints.filter((e) => e.path === ROOT_PATH) : endpointsUnder(doc.value.endpoints, p)).map((e) => e.id)))
    doc.value.endpoints = doc.value.endpoints.filter((e) => !gone.has(e.id))
    if (editingEndpointId.value && gone.has(editingEndpointId.value)) editingEndpointId.value = null
    selection.value = selection.value.filter((p) => !paths.includes(p))
  }

  function addResource(): ApiResource {
    const names = new Set(doc.value.resources.map((r) => r.name))
    let n = 1
    while (names.has(n === 1 ? 'Nouveau' : `Nouveau${n}`)) n++
    const r: ApiResource = { id: uid(), name: n === 1 ? 'Nouveau' : `Nouveau${n}`, fields: [{ name: 'id', type: 'uuid' }] }
    doc.value.resources.push(r)
    selection.value = [r.id]
    editingResourceId.value = r.id
    return r
  }

  function setResource(next: ApiResource) {
    const i = doc.value.resources.findIndex((r) => r.id === next.id)
    if (i < 0) return
    const old = doc.value.resources[i]
    doc.value.resources[i] = next
    // Renommer un schéma met à jour les routes et champs qui le citent.
    if (old.name !== next.name && next.name) renameRefs(old.name, next.name)
  }

  function renameRefs(from: string, to: string) {
    const swap = (t: string | undefined) => (t && refsOf(t)[0] === from ? t.replace(from, to) : t)
    for (const r of doc.value.resources) for (const f of r.fields) f.type = swap(f.type)!
    for (const e of doc.value.endpoints) {
      if (e.body) e.body.type = swap(e.body.type)!
      for (const r of e.responses) if (r.type) r.type = swap(r.type)
    }
  }

  function removeResources(ids: string[]) {
    const gone = new Set(ids)
    doc.value.resources = doc.value.resources.filter((r) => !gone.has(r.id))
    selection.value = selection.value.filter((id) => !gone.has(id))
    if (editingResourceId.value && gone.has(editingResourceId.value)) editingResourceId.value = null
  }

  function setInfo(info: ApiDocument['info']) {
    doc.value.info = info
  }

  // --- Copier / coller / dupliquer ---------------------------------------------------
  /** Chemins sélectionnés dont aucun ancêtre n'est sélectionné, racine exclue. */
  const topPaths = (paths: string[]) => paths.filter((p) => p !== ROOT_PATH && !paths.some((o) => o !== p && p.startsWith(`${o === ROOT_PATH ? '' : o}/`)))

  function copy(): boolean {
    if (view.value === 'schemas') {
      const items = doc.value.resources.filter((r) => selection.value.includes(r.id)).map((r) => clone(r))
      clipboard = items.length ? { kind: 'resources', items } : null
    } else {
      const groups = topPaths(selection.value).map((root) => ({ root, endpoints: clone(endpointsUnder(doc.value.endpoints, root)) }))
      clipboard = groups.length ? { kind: 'routes', groups } : null
    }
    return !!clipboard
  }

  /** Recopie un groupe de routes sous `parent` ; ajoute « -copie » au besoin pour ne pas créer de doublon. */
  function pasteGroup(group: RouteGroup, parent: string, forceSuffix = false): string {
    const seg = segmentsOf(group.root).at(-1) ?? 'copie'
    const keys = new Set(doc.value.endpoints.map(routeKey))
    const base = parent === ROOT_PATH ? '' : parent
    let root = `${base}/${seg}${forceSuffix ? '-copie' : ''}`
    const collides = (r: string) => group.endpoints.some((e) => keys.has(routeKey({ method: e.method, path: r + e.path.slice(group.root.length) })))
    for (let n = 2; collides(root); n++) root = `${base}/${seg}-copie${n > 2 ? `-${n}` : ''}`
    for (const e of group.endpoints) {
      const path = root + e.path.slice(group.root.length)
      const types = Object.fromEntries(e.params.filter((p) => p.in === 'path').map((p) => [p.name, p.type]))
      insertEndpoint({ ...clone(e), id: uid(), path, params: [...pathParams(path, types), ...e.params.filter((p) => p.in !== 'path')] }, root)
    }
    return root
  }

  function paste(): boolean {
    if (!clipboard) return false
    if (clipboard.kind === 'resources') {
      const names = new Set(doc.value.resources.map((r) => r.name))
      const added = clipboard.items.map((r) => {
        let name = r.name
        while (names.has(name)) name = `${name}Copie`
        names.add(name)
        return { ...clone(r), id: uid(), name }
      })
      doc.value.resources.push(...added)
      selection.value = added.map((r) => r.id)
      return true
    }
    const target = selection.value.find((p) => p === ROOT_PATH || doc.value.endpoints.some((e) => e.path === p || e.path.startsWith(`${p}/`))) ?? ROOT_PATH
    selection.value = clipboard.groups.map((g) => pasteGroup(g, target))
    return true
  }

  function duplicate() {
    if (!copy()) return
    if (clipboard?.kind === 'resources') return void paste()
    const groups = clipboard!.kind === 'routes' ? clipboard!.groups : []
    selection.value = groups.map((g) => pasteGroup(g, g.root.slice(0, g.root.lastIndexOf('/')) || ROOT_PATH, true))
  }

  function selectAll() {
    selection.value = view.value === 'schemas' ? doc.value.resources.map((r) => r.id) : tree.value.map((n) => n.id)
  }

  // --- Chargement ----------------------------------------------------------------
  function load(s: ApiDocument) {
    doc.value = s
    const alive = new Set([...s.resources.map((r) => r.id), ...buildPathTree(s.endpoints).map((n) => n.id)])
    selection.value = selection.value.filter((id) => alive.has(id))
    if (editingEndpointId.value && !s.endpoints.some((e) => e.id === editingEndpointId.value)) editingEndpointId.value = null
    if (editingResourceId.value && !s.resources.some((r) => r.id === editingResourceId.value)) editingResourceId.value = null
  }

  const importSchema = (raw: unknown) => load(sanitizeApi(raw, uid))
  const reset = () => load(emptyApi())
  function loadExample(id: string) {
    const ex = API_EXAMPLES.find((e) => e.id === id)
    if (ex) load(parseApiText(ex.text, uid).api)
  }

  // --- Sauvegarde locale et historique ------------------------------------------
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) load(sanitizeApi(JSON.parse(raw), uid))
    else loadExample(API_EXAMPLES[0].id)
  } catch {
    loadExample(API_EXAMPLES[0].id)
  }
  usePersistence(schema, STORAGE_KEY)
  const { undo, redo, canUndo, canRedo } = useHistory({ state: schema, load })

  return {
    doc, selection, editingEndpointId, editingResourceId, showInfoModal, showTextPanel, highlightId, view,
    schema, endpoints, resources, tree, issues, endpointById, resourceById, usage,
    routeNodes, routeEdges, resourceNodes, resourceEdges,
    flash, addEndpoint, addSubPath, setEndpoint, removeEndpoint, removePaths, addResource, setResource, removeResources, setInfo,
    copy, paste, duplicate, selectAll, load, importSchema, reset, loadExample,
    undo, redo, canUndo, canRedo,
  }
})

export type { PathNode }

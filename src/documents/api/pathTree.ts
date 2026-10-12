/**
 * Arbre des chemins : `/users`, `/users/{id}`, `/users/{id}/orders`… Chaque nœud est un morceau de chemin et porte
 * les routes (méthodes) qui s'y terminent. L'arbre se déduit des routes, il n'est jamais stocké.
 */
import { childrenOf, type TreeItem } from '../../core/tree'
import { segmentsOf, type ApiEndpoint } from './model'

export interface PathNode extends TreeItem {
  /** Chemin complet du nœud : `/users/{id}` (la racine est `/`). */
  id: string
  /** Dernier morceau : `users`, `{id}` ; `/` pour la racine. */
  segment: string
  parentId?: string
  endpoints: ApiEndpoint[]
}

export const ROOT_PATH = '/'

/**
 * Construit l'arbre dans l'ordre d'apparition des routes (les ancêtres avant leurs descendants).
 * La racine `/` est toujours présente dès qu'il y a au moins une route.
 */
export function buildPathTree(endpoints: ApiEndpoint[]): PathNode[] {
  if (!endpoints.length) return []
  const nodes = new Map<string, PathNode>([[ROOT_PATH, { id: ROOT_PATH, segment: '/', endpoints: [] }]])
  for (const e of endpoints) {
    let parent = ROOT_PATH
    let path = ''
    for (const seg of segmentsOf(e.path)) {
      path += `/${seg}`
      if (!nodes.has(path)) nodes.set(path, { id: path, segment: seg, parentId: parent, endpoints: [] })
      parent = path
    }
    nodes.get(parent)!.endpoints.push(e)
  }
  return [...nodes.values()]
}

/** Routes situées dans le sous-arbre d'un chemin (lui compris). */
export const endpointsUnder = (endpoints: ApiEndpoint[], path: string) =>
  endpoints.filter((e) => path === ROOT_PATH || e.path === path || e.path.startsWith(`${path}/`))

/**
 * Échange un chemin (avec tout son sous-arbre) avec son voisin de même niveau. L'ordre des chemins est celui de la
 * première route de chacun : on déplace donc le bloc de routes du chemin juste avant (`dir` -1) ou juste après (+1)
 * celles du voisin. `null` pour la racine ou s'il n'y a pas de voisin de ce côté.
 */
export function movePath(endpoints: ApiEndpoint[], path: string, dir: -1 | 1): ApiEndpoint[] | null {
  if (path === ROOT_PATH) return null
  const nodes = buildPathTree(endpoints)
  const node = nodes.find((n) => n.id === path)
  if (!node) return null
  const siblings = childrenOf(nodes, node.parentId)
  const other = siblings[siblings.indexOf(node) + dir]
  if (!other) return null

  const mine = new Set(endpointsUnder(endpoints, path).map((e) => e.id))
  const block = endpoints.filter((e) => mine.has(e.id))
  const rest = endpoints.filter((e) => !mine.has(e.id))
  const theirs = rest.flatMap((e, i) => (endpointsUnder([e], other.id).length ? [i] : []))
  rest.splice(dir < 0 ? Math.min(...theirs) : Math.max(...theirs) + 1, 0, ...block)
  return rest
}

/** Échange une route avec la précédente (`dir` -1) ou la suivante (+1) du même chemin ; `null` s'il n'y en a pas. */
export function moveEndpoint(endpoints: ApiEndpoint[], id: string, dir: -1 | 1): ApiEndpoint[] | null {
  const e = endpoints.find((x) => x.id === id)
  if (!e) return null
  const same = endpoints.filter((x) => x.path === e.path)
  const other = same[same.indexOf(e) + dir]
  if (!other) return null
  const next = [...endpoints]
  const [i, j] = [endpoints.indexOf(e), endpoints.indexOf(other)]
  next[i] = other
  next[j] = e
  return next
}

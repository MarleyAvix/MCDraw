/**
 * Arbre des chemins : `/users`, `/users/{id}`, `/users/{id}/orders`… Chaque nœud est un morceau de chemin et porte
 * les routes (méthodes) qui s'y terminent. L'arbre se déduit des routes, il n'est jamais stocké.
 */
import type { TreeItem } from '../../core/tree'
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

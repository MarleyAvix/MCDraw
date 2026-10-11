// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseApiText } from '../text'
import { buildPathTree, moveEndpoint, movePath } from '../pathTree'
import { useApiStore } from '../apiStore'
import type { ApiEndpoint } from '../model'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}
const eps = (text: string) => parseApiText(text, counter()).api.endpoints
const order = (list: ApiEndpoint[], parent = '/') =>
  buildPathTree(list)
    .filter((n) => n.parentId === parent)
    .map((n) => n.id)
const routes = (list: ApiEndpoint[]) => list.map((e) => `${e.method} ${e.path}`)

const TEXT = `/a
  GET
  /{id}
    GET
/b
  GET
  POST
/c
  GET`

describe('movePath', () => {
  it('monte un chemin avant son voisin, sous-arbre compris', () => {
    const next = movePath(eps(TEXT), '/b', -1)!
    expect(order(next)).toEqual(['/b', '/a', '/c'])
    expect(routes(next)).toEqual(['GET /b', 'POST /b', 'GET /a', 'GET /a/{id}', 'GET /c'])
  })

  it('descend un chemin après son voisin', () => {
    const next = movePath(eps(TEXT), '/a', 1)!
    expect(order(next)).toEqual(['/b', '/a', '/c'])
    expect(routes(next).slice(-3)).toEqual(['GET /a', 'GET /a/{id}', 'GET /c'])
    expect(order(movePath(eps(TEXT), '/b', 1)!)).toEqual(['/a', '/c', '/b'])
  })

  it('déplace un chemin imbriqué parmi ses seuls voisins', () => {
    const list = eps('/x\n  GET\n  /p\n    GET\n  /q\n    GET\n/y\n  GET')
    const next = movePath(list, '/x/q', -1)!
    expect(order(next, '/x')).toEqual(['/x/q', '/x/p'])
    expect(order(next)).toEqual(['/x', '/y']) // le reste ne bouge pas
  })

  it('un chemin sans route propre (seulement des descendants) se déplace aussi', () => {
    const list = eps('/a\n  /b\n    GET\n/c\n  GET')
    expect(order(movePath(list, '/c', -1)!)).toEqual(['/c', '/a'])
  })

  it('ne perd et ne duplique aucune route, et ne modifie pas l’entrée', () => {
    const list = eps(TEXT)
    const before = routes(list)
    const next = movePath(list, '/c', -1)!
    expect(routes(list)).toEqual(before)
    expect(routes(next).sort()).toEqual([...before].sort())
  })

  it('renvoie null pour la racine, le premier, le dernier et l’inconnu', () => {
    const list = eps(TEXT)
    expect(movePath(list, '/', 1)).toBeNull()
    expect(movePath(list, '/a', -1)).toBeNull()
    expect(movePath(list, '/c', 1)).toBeNull()
    expect(movePath(list, '/zzz', 1)).toBeNull()
  })

  it('deux déplacements successifs reviennent à l’ordre de départ', () => {
    const start = eps(TEXT)
    const there = movePath(start, '/b', -1)!
    expect(order(movePath(there, '/b', 1)!)).toEqual(order(start))
  })
})

describe('moveEndpoint', () => {
  it('échange une route avec sa voisine du même chemin, sans toucher aux autres', () => {
    const list = eps(TEXT)
    const post = list.find((e) => e.method === 'POST')!
    const next = moveEndpoint(list, post.id, -1)!
    expect(routes(next)).toEqual(['GET /a', 'GET /a/{id}', 'POST /b', 'GET /b', 'GET /c'])
  })

  it('renvoie null s’il n’y a pas de voisine de ce côté', () => {
    const list = eps(TEXT)
    const get = list.find((e) => e.path === '/b' && e.method === 'GET')!
    expect(moveEndpoint(list, get.id, -1)).toBeNull()
    expect(moveEndpoint(list, list.find((e) => e.path === '/c')!.id, 1)).toBeNull()
    expect(moveEndpoint(list, 'inconnu', 1)).toBeNull()
  })
})

describe('dans le store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('déplace chemins et routes, avec leur disponibilité', () => {
    const s = useApiStore()
    s.load(parseApiText(TEXT, counter()).api)
    expect(s.canMovePath('/a', -1)).toBe(false)
    expect(s.canMovePath('/a', 1)).toBe(true)
    expect(s.movePathBy('/a', 1)).toBe(true)
    expect(s.tree.filter((n) => n.parentId === '/').map((n) => n.id)).toEqual(['/b', '/a', '/c'])
    expect(s.movePathBy('/', 1)).toBe(false)

    const post = s.endpoints.find((e) => e.method === 'POST')!
    expect(s.canMoveEndpoint(post.id, -1)).toBe(true)
    expect(s.moveEndpointBy(post.id, -1)).toBe(true)
    expect(s.endpoints[0].method).toBe('POST')
    expect(s.canMoveEndpoint(undefined, 1)).toBe(false)
  })

  it('le texte suit le nouvel ordre', async () => {
    const { apiToText } = await import('../text')
    const s = useApiStore()
    s.load(parseApiText(TEXT, counter()).api)
    s.movePathBy('/c', -1)
    s.movePathBy('/c', -1)
    expect(apiToText(s.doc).split('\n')[0]).toBe('/c')
  })
})

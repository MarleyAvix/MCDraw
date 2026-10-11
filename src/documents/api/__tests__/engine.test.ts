import { describe, expect, it } from 'vitest'
import { emptyApi, isParamType, normalizePath, normalizeType, pathShape, sanitizeApi, parseTypeExpr, type ApiDocument } from '../model'
import { apiToText, mergeApi, parseApiText } from '../text'
import { buildPathTree, endpointsUnder } from '../pathTree'
import { lintApi } from '../lint'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}

const TEXT = `@title Boutique
@version 1.0.0
@server https://api.exemple.fr
@auth bearer

schema User -- un utilisateur
  id: uuid
  email: email
  role: enum(admin|user)?
  orders: Order[]?

schema Order
  id: int
  total: number

/users
  GET Lister [auth] [paginated] -> 200 User[], 401
    ? role: string?
    @ X-Request-Id: uuid?
  POST Créer
    < User
    > 201 User
    > 409 -- e-mail déjà utilisé
  /{id:uuid}
    GET Détail -> 200 User, 404
    /orders
      GET Commandes -> 200 Order[]`

const parse = (t = TEXT) => parseApiText(t, counter())
const api = (t = TEXT) => parse(t).api
const ep = (doc: ApiDocument, method: string, path: string) => doc.endpoints.find((e) => e.method === method && e.path === path)!

describe('types', () => {
  it('lit les primitives, alias, listes, énumérations et références', () => {
    expect(normalizeType('string')).toBe('string')
    expect(parseTypeExpr('Integer')).toEqual({ kind: 'ref', name: 'Integer', array: false }) // majuscule : un schéma, pas une primitive
    expect(normalizeType('integer')).toBe('int')
    expect(normalizeType('boolean')).toBe('bool')
    expect(normalizeType('date-time')).toBe('datetime')
    expect(normalizeType('User[]')).toBe('User[]')
    expect(normalizeType('enum( a | b )')).toBe('enum(a|b)')
    expect(parseTypeExpr('User')).toEqual({ kind: 'ref', name: 'User', array: false })
  })

  it('refuse ce qui n’est pas un type', () => {
    for (const bad of ['', 'machin', 'string[][]', 'enum()', 'enum(a b)', '[]', 'User?']) expect(normalizeType(bad)).toBeNull()
  })

  it('un paramètre est une valeur simple', () => {
    expect(isParamType('int')).toBe(true)
    expect(isParamType('enum(a|b)')).toBe(true)
    expect(isParamType('User')).toBe(false)
    expect(isParamType('string[]')).toBe(false)
  })
})

describe('chemins', () => {
  it('normalise et relève les types des paramètres', () => {
    expect(normalizePath('/users/{id:uuid}/')).toEqual({ path: '/users/{id}', types: { id: 'uuid' } })
    expect(normalizePath('/')).toEqual({ path: '/', types: {} })
    expect(normalizePath('/a/{b').error).toBeTruthy()
    expect(normalizePath('/a b').error).toBeTruthy()
  })

  it('/users/{id} et /users/{userId} ont la même forme', () => {
    expect(pathShape('/users/{id}')).toBe(pathShape('/users/{userId}'))
    expect(pathShape('/users/{id}')).not.toBe(pathShape('/users'))
  })
})

describe('saisie texte', () => {
  it('construit les informations, les ressources et les routes', () => {
    const { api: doc, errors } = parse()
    expect(errors).toEqual([])
    expect(doc.info).toEqual({ title: 'Boutique', version: '1.0.0', server: 'https://api.exemple.fr', auth: 'bearer' })
    expect(doc.resources.map((r) => r.name)).toEqual(['User', 'Order'])
    expect(doc.resources[0]).toMatchObject({ description: 'un utilisateur' })
    expect(doc.resources[0].fields).toEqual([
      { name: 'id', type: 'uuid' },
      { name: 'email', type: 'email' },
      { name: 'role', type: 'enum(admin|user)', optional: true },
      { name: 'orders', type: 'Order[]', optional: true },
    ])
    expect(doc.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /users', 'POST /users', 'GET /users/{id}', 'GET /users/{id}/orders'])
  })

  it('lit les drapeaux, réponses, paramètres de requête et en-têtes', () => {
    const list = ep(api(), 'GET', '/users')
    expect(list).toMatchObject({ summary: 'Lister', auth: true, paginated: true })
    expect(list.responses).toEqual([{ status: 200, type: 'User[]' }, { status: 401 }])
    expect(list.params).toEqual([
      { name: 'role', in: 'query', type: 'string', optional: true },
      { name: 'X-Request-Id', in: 'header', type: 'uuid', optional: true },
    ])
  })

  it('lit le corps, les réponses détaillées avec leur note', () => {
    const post = ep(api(), 'POST', '/users')
    expect(post.body).toEqual({ type: 'User' })
    expect(post.responses).toEqual([{ status: 201, type: 'User' }, { status: 409, description: 'e-mail déjà utilisé' }])
  })

  it('type les paramètres de chemin, y compris pour les routes imbriquées', () => {
    const doc = api()
    expect(ep(doc, 'GET', '/users/{id}').params).toEqual([{ name: 'id', in: 'path', type: 'uuid' }])
    expect(ep(doc, 'GET', '/users/{id}/orders').params).toEqual([{ name: 'id', in: 'path', type: 'uuid' }])
    expect(api('/a/{x}\n  GET').endpoints[0].params).toEqual([{ name: 'x', in: 'path', type: 'string' }])
  })

  it('accepte un chemin sur une seule ligne, la racine, les tabulations et les commentaires', () => {
    const doc = api('// api\n/users/{id}/orders\n\tGET Liste -> 200\n\n/\n  GET Santé -> 200')
    expect(doc.endpoints.map((e) => e.path)).toEqual(['/users/{id}/orders', '/'])
  })

  it('aller-retour texte → modèle → texte', () => {
    expect(apiToText(api())).toBe(TEXT)
  })

  it('aller-retour avec la racine et une route sans réponse', () => {
    const t = '/\n  GET Santé -> 200\n  /status\n    GET\n    /{code:int}\n      DELETE Retirer [auth] -> 204'
    expect(apiToText(api(t))).toBe(t)
  })

  it('une carte vide donne un texte vide', () => {
    expect(apiToText(emptyApi())).toBe('')
    expect(parse('').api).toEqual(emptyApi())
  })
})

describe('erreurs de saisie', () => {
  const errs = (t: string) => parse(t).errors

  it('signale une route sans chemin, avec la ligne', () => {
    expect(errs('GET Lister')).toEqual([{ line: 1, message: expect.stringContaining('sous un chemin') }])
  })

  it('signale les types inconnus et les codes invalides', () => {
    expect(errs('schema U\n  a: machin')[0]).toMatchObject({ line: 2 })
    expect(errs('/a\n  GET -> 999')[0].message).toContain('Réponse invalide')
    expect(errs('/a\n  GET -> 200 truc')[0].message).toContain('Type de réponse inconnu')
    expect(errs('/a\n  GET\n    > 20')[0].line).toBe(3)
    expect(errs('/a\n  GET\n    ? q: User')[0].message).toContain('valeur simple')
  })

  it('signale les doublons (champ, code, paramètre, corps)', () => {
    expect(errs('schema U\n  a: int\n  a: int')[0].message).toContain('existe déjà')
    expect(errs('/a\n  GET -> 200, 200')[0].message).toContain('déjà décrit')
    expect(errs('/a\n  GET\n    ? q: int\n    ? Q: int')[0].message).toContain('déjà déclaré')
    expect(errs('/a\n  POST\n    < User\n    < User')[0].message).toContain('déjà un corps')
  })

  it('signale les directives et schémas invalides sans perdre le reste', () => {
    const { api: doc, errors } = parse('@bidule 1\n@auth magie\nschema user\n  a: int\n/ok\n  GET -> 200')
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3])
    expect(doc.endpoints).toHaveLength(1)
    expect(doc.resources).toHaveLength(0) // le schéma invalide et ses champs sont écartés sans autre erreur
  })

  it('signale un chemin invalide et ignore ses sous-lignes', () => {
    const { api: doc, errors } = parse('/a/{b\n  GET -> 200\n/c\n  GET -> 200')
    expect(errors).toHaveLength(1)
    expect(doc.endpoints.map((e) => e.path)).toEqual(['/c'])
  })

  it('une ligne inconnue sous un chemin est signalée', () => {
    expect(errs('/a\n  TRUC')[0].message).toContain('Attendu')
  })
})

describe('fusion', () => {
  it('garde les identifiants des routes et ressources inchangées', () => {
    const before = api()
    const merged = mergeApi(before, api(TEXT + '\n    /{orderId}\n      GET Une commande -> 200 Order, 404'))
    expect(merged.endpoints).toHaveLength(5)
    for (const old of before.endpoints) expect(merged.endpoints.find((e) => e.method === old.method && e.path === old.path)!.id).toBe(old.id)
    expect(merged.resources.map((r) => r.id)).toEqual(before.resources.map((r) => r.id))
    expect(merged.endpoints[4].id).not.toBe(before.endpoints[0].id)
  })

  it('apparie les doublons dans l’ordre', () => {
    const before = api('/a\n  GET\n  GET')
    const merged = mergeApi(before, api('/a\n  GET\n  GET\n  GET'))
    expect(merged.endpoints.slice(0, 2).map((e) => e.id)).toEqual(before.endpoints.map((e) => e.id))
  })
})

describe('arbre des chemins', () => {
  it('construit la racine et les ancêtres, dans l’ordre d’apparition', () => {
    const tree = buildPathTree(api().endpoints)
    expect(tree.map((n) => n.id)).toEqual(['/', '/users', '/users/{id}', '/users/{id}/orders'])
    expect(tree[1]).toMatchObject({ parentId: '/', segment: 'users' })
    expect(tree[1].endpoints.map((e) => e.method)).toEqual(['GET', 'POST'])
    expect(tree[2].parentId).toBe('/users')
    expect(buildPathTree([])).toEqual([])
  })

  it('crée les nœuds intermédiaires sans route', () => {
    const tree = buildPathTree(api('/a/b/c\n  GET').endpoints)
    expect(tree.map((n) => n.id)).toEqual(['/', '/a', '/a/b', '/a/b/c'])
    expect(tree[1].endpoints).toEqual([])
  })

  it('endpointsUnder garde le sous-arbre', () => {
    const doc = api()
    expect(endpointsUnder(doc.endpoints, '/users/{id}').map((e) => e.path)).toEqual(['/users/{id}', '/users/{id}/orders'])
    expect(endpointsUnder(doc.endpoints, '/')).toHaveLength(4)
    expect(endpointsUnder(doc.endpoints, '/user')).toEqual([]) // pas de simple préfixe de texte
  })
})

describe('validation d’une source externe', () => {
  it('normalise, complète et écarte l’invalide', () => {
    const doc = sanitizeApi(
      {
        info: { title: 'T', auth: 'magie', server: 5 },
        resources: [{ id: 'r', name: 'User', fields: [{ name: 'a', type: 'integer' }, { name: '', type: 'int' }, { name: 'b', type: 'n’importe quoi' }] }, 'x'],
        endpoints: [
          { id: 'e', method: 'get', path: '/users/{id:int}/', params: [{ name: 'q', in: 'query', type: 'User' }], responses: [{ status: 200, type: 'User[]' }, { status: 200 }, { status: 42 }, { status: 404 }] },
          { id: 'e', method: 'FETCH', path: '/x' },
          { id: 'e', method: 'POST', path: 'sans-slash', body: { type: 'User' } },
          { method: 'GET' },
        ],
      },
      counter(),
    )
    expect(doc.info).toEqual({ title: 'T', server: '5' })
    expect(doc.resources[0].fields).toEqual([{ name: 'a', type: 'int' }, { name: 'b', type: 'any' }])
    expect(doc.endpoints).toHaveLength(2)
    expect(new Set(doc.endpoints.map((e) => e.id)).size).toBe(2)
    expect(doc.endpoints[0]).toMatchObject({ method: 'GET', path: '/users/{id}' })
    expect(doc.endpoints[0].params).toEqual([{ name: 'id', in: 'path', type: 'int' }, { name: 'q', in: 'query', type: 'string' }])
    expect(doc.endpoints[0].responses).toEqual([{ status: 200, type: 'User[]' }, { status: 404 }])
    expect(doc.endpoints[1]).toMatchObject({ method: 'POST', path: '/sans-slash', body: { type: 'User' } })
  })

  it('refuse une structure sans liste de routes', () => {
    for (const bad of [null, 'x', [], { pages: [] }, { endpoints: 'non' }]) expect(() => sanitizeApi(bad, counter())).toThrow()
  })

  it('un document produit par le texte survit à la validation', () => {
    const doc = api()
    expect(sanitizeApi(JSON.parse(JSON.stringify(doc)), counter())).toEqual(doc)
  })
})

describe('linter', () => {
  const rules = (t: string) => lintApi(api(t)).map((i) => i.rule)
  const has = (t: string, rule: string) => expect(rules(t)).toContain(rule)
  const not = (t: string, rule: string) => expect(rules(t)).not.toContain(rule)

  it('une API soignée ne déclenche ni erreur ni avertissement', () => {
    const clean = `@auth bearer
schema User
  id: int
/users
  GET Lister [auth] [paginated] -> 200 User[], 401
  POST Créer [auth]
    < User
    > 201 User
    > 400
    > 401
    > 403
  /{id}
    GET Détail [auth] -> 200 User, 401, 404
    DELETE Retirer [auth] -> 204, 401, 403, 404`
    expect(lintApi(api(clean)).filter((i) => i.severity !== 'info')).toEqual([])
  })

  it('doublons et conflits de routes', () => {
    has('/a\n  GET -> 200\n  GET -> 200', 'duplicate-route')
    has('/a/{id}\n  GET -> 200, 404\n/a/{aId}\n  GET -> 200, 404', 'duplicate-route')
    has('/a/{id}\n  GET -> 200, 404\n/a/{aId}\n  PUT -> 200, 404', 'param-name')
    not('/a/{id}\n  GET -> 200, 404\n  PUT -> 200, 404', 'param-name')
  })

  it('types inconnus et ressources en double ou inutilisées', () => {
    has('/a\n  GET -> 200 Fantome', 'unknown-type')
    has('schema A\n  b: Fantome', 'unknown-type')
    has('schema A\n  x: int\nschema A\n  y: int', 'duplicate-resource')
    has('schema A\n  x: int\n/a\n  GET -> 200', 'unused-resource')
    not('schema A\n  x: int\n/a\n  GET -> 200 A', 'unused-resource')
  })

  it('nommage des chemins', () => {
    has('/getUsers\n  GET -> 200', 'verb-in-path')
    has('/users/create-user\n  GET -> 200', 'verb-in-path')
    has('/Users\n  GET -> 200', 'path-case')
    has('/user_list\n  GET -> 200', 'path-case')
    has('/user/{id}\n  GET -> 200, 404', 'plural')
    not('/users/{id}\n  GET -> 200, 404', 'plural')
    not('/users/{id}\n  GET -> 200, 404', 'verb-in-path')
  })

  it('codes HTTP', () => {
    has('/a\n  GET', 'no-response')
    has('/a\n  GET -> 404', 'no-success')
    has('/a/{id}\n  GET -> 200', 'missing-404')
    not('/a/{id}\n  GET -> 200, 404', 'missing-404')
    not('/a\n  GET -> 200', 'missing-404')
    has('/a\n  POST\n    < string\n    > 201', 'missing-400')
    has('/a\n  POST -> 200', 'post-status')
    not('/a\n  POST -> 201', 'post-status')
    has('/a/{id}\n  DELETE -> 200, 404', 'delete-status')
    not('/a/{id}\n  DELETE -> 204, 404', 'delete-status')
  })

  it('corps de requête incohérents', () => {
    has('/a\n  GET\n    < string\n    > 200', 'get-body')
    has('/a/{id}\n  DELETE\n    < string\n    > 204', 'delete-body')
  })

  it('authentification et pagination', () => {
    has('@auth bearer\n/a\n  GET [auth] -> 200', 'auth-401')
    has('/a\n  GET [auth] -> 200, 401', 'auth-undeclared')
    has('@auth bearer\n/a\n  POST -> 201', 'public-write')
    has('/a\n  GET -> 200 string[]', 'unpaginated-list')
    not('/a\n  GET [paginated] -> 200 string[]', 'unpaginated-list')
    not('/a/{id}\n  GET -> 200 string[], 404', 'unpaginated-list')
    has('/a\n  GET [paginated] -> 200 string[]\n    ? page: int?', 'paginated-params')
  })

  it('classe les anomalies par gravité et désigne la route concernée', () => {
    const issues = lintApi(api('/a\n  GET\n    < string\n    > 200 Fantome\n  GET'))
    const sev = issues.map((i) => i.severity)
    expect(sev).toEqual([...sev].sort((x, y) => ['error', 'warning', 'info'].indexOf(x) - ['error', 'warning', 'info'].indexOf(y)))
    expect(issues.every((i) => i.endpointId || i.resourceId)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { parseApiText } from '../text'
import { buildOpenApi, jsonSchemaOf, openApiToJson, openApiToYaml } from '../openapi'
import { toYaml } from '../yaml'
import { apiToHttpFile } from '../httpFile'
import { apiToMarkdown } from '../markdown'
import { sampleOf } from '../sample'

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
  friend: User?

/users
  GET Lister [auth] [paginated] -> 200 User[], 401
    ? role: string?
    ? q: string
    @ X-Request-Id: uuid?
  POST Créer
    < User -- données du compte
    > 201 User
    > 409 -- e-mail déjà utilisé
  /{id:uuid}
    GET Détail [auth] -> 200 User, 404
/health
  GET -> 200`

const api = parseApiText(TEXT, counter()).api
// biome-ignore lint: l'objet OpenAPI est volontairement non typé
const spec = buildOpenApi(api) as any

describe('schémas JSON', () => {
  it('traduit les types', () => {
    expect(jsonSchemaOf('int')).toEqual({ type: 'integer' })
    expect(jsonSchemaOf('uuid')).toEqual({ type: 'string', format: 'uuid' })
    expect(jsonSchemaOf('datetime')).toEqual({ type: 'string', format: 'date-time' })
    expect(jsonSchemaOf('url')).toEqual({ type: 'string', format: 'uri' })
    expect(jsonSchemaOf('User')).toEqual({ $ref: '#/components/schemas/User' })
    expect(jsonSchemaOf('User[]')).toEqual({ type: 'array', items: { $ref: '#/components/schemas/User' } })
    expect(jsonSchemaOf('enum(a|b)')).toEqual({ type: 'string', enum: ['a', 'b'] })
    expect(jsonSchemaOf('any')).toEqual({})
  })
})

describe('OpenAPI 3.1', () => {
  it('décrit les informations, le serveur et la sécurité', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info).toEqual({ title: 'Boutique', version: '1.0.0' })
    expect(spec.servers).toEqual([{ url: 'https://api.exemple.fr' }])
    expect(spec.components.securitySchemes).toEqual({ bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } })
  })

  it('regroupe les méthodes par chemin avec un operationId unique', () => {
    expect(Object.keys(spec.paths)).toEqual(['/users', '/users/{id}', '/health'])
    expect(Object.keys(spec.paths['/users'])).toEqual(['get', 'post'])
    expect(spec.paths['/users'].get.operationId).toBe('getUsers')
    expect(spec.paths['/users/{id}'].get.operationId).toBe('getUsersById')
    expect(spec.paths['/health'].get.operationId).toBe('getHealth')
    expect(spec.paths['/users'].get.tags).toEqual(['users'])
  })

  it('rend uniques deux operationId identiques', () => {
    const a = parseApiText('/a\n  GET\n/a/\n  GET', counter()).api
    const ids = Object.values(buildOpenApi(a).paths as Record<string, any>).flatMap((p) => Object.values(p).map((o: any) => o.operationId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('paramètres : chemin typé et obligatoire, requête facultative ou non, en-tête, pagination ajoutée', () => {
    const byName = (op: any, name: string) => op.parameters.find((p: any) => p.name === name)
    expect(spec.paths['/users/{id}'].get.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }])
    const list = spec.paths['/users'].get
    expect(byName(list, 'role')).toMatchObject({ in: 'query', required: false, schema: { type: 'string' } })
    expect(byName(list, 'q').required).toBe(true)
    expect(byName(list, 'X-Request-Id')).toMatchObject({ in: 'header', required: false })
    expect(byName(list, 'page').schema).toEqual({ type: 'integer', minimum: 1, default: 1 })
    expect(byName(list, 'limit').schema).toEqual({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  })

  it('n’ajoute pas page et limit s’ils sont déjà déclarés', () => {
    const a = parseApiText('/a\n  GET [paginated] -> 200\n    ? page: int?', counter()).api
    const params = (buildOpenApi(a).paths as any)['/a'].get.parameters
    expect(params.filter((p: any) => p.name === 'page')).toHaveLength(1)
    expect(params.map((p: any) => p.name)).toEqual(['page', 'limit'])
  })

  it('corps et réponses, avec l’en-tête de total sur les listes paginées', () => {
    const post = spec.paths['/users'].post
    expect(post.requestBody).toEqual({ required: true, description: 'données du compte', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } })
    expect(post.responses['201'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/User' })
    expect(post.responses['409']).toEqual({ description: 'e-mail déjà utilisé' })
    const list = spec.paths['/users'].get.responses
    expect(list['200'].headers['X-Total-Count'].schema).toEqual({ type: 'integer' })
    expect(list['401']).toEqual({ description: 'Non authentifié' })
    expect(post.responses['201'].headers).toBeUndefined()
  })

  it('une route protégée référence le schéma de sécurité, une route publique non', () => {
    expect(spec.paths['/users'].get.security).toEqual([{ bearerAuth: [] }])
    expect(spec.paths['/users'].post.security).toBeUndefined()
  })

  it('une route sans réponse décrite reçoit un 200 pour rester valide', () => {
    const a = parseApiText('/a\n  GET', counter()).api
    expect((buildOpenApi(a).paths as any)['/a'].get.responses).toEqual({ '200': { description: 'OK' } })
  })

  it('ressources : propriétés, champs obligatoires, descriptions', () => {
    expect(spec.components.schemas.User).toEqual({
      type: 'object',
      description: 'un utilisateur',
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        role: { type: 'string', enum: ['admin', 'user'] },
        friend: { $ref: '#/components/schemas/User' },
      },
      required: ['id', 'email'],
    })
  })

  it('choisit le schéma de sécurité de l’API (clé d’API, Basic)', () => {
    const key = buildOpenApi(parseApiText('@auth apikey\n/a\n  GET [auth] -> 200', counter()).api) as any
    expect(key.components.securitySchemes.apiKeyAuth).toEqual({ type: 'apiKey', in: 'header', name: 'X-API-Key' })
    expect(key.paths['/a'].get.security).toEqual([{ apiKeyAuth: [] }])
    const basic = buildOpenApi(parseApiText('@auth basic\n/a\n  GET [auth] -> 200', counter()).api) as any
    expect(basic.components.securitySchemes.basicAuth).toEqual({ type: 'http', scheme: 'basic' })
  })

  it('un document vide reste un OpenAPI valide', () => {
    expect(buildOpenApi({ info: {}, resources: [], endpoints: [] })).toEqual({ openapi: '3.1.0', info: { title: 'API', version: '1.0.0' }, paths: {} })
  })

  it('JSON : sérialisation fidèle de l’objet', () => {
    expect(JSON.parse(openApiToJson(api))).toEqual(JSON.parse(JSON.stringify(spec)))
  })
})

describe('YAML', () => {
  it('écrit objets, listes, scalaires et conteneurs vides', () => {
    expect(toYaml({ a: 1, b: 'x', c: true, d: { e: [] , f: {} }, g: [1, 'deux', { h: 3, i: [4] }] })).toBe(
      ['a: 1', 'b: x', 'c: true', 'd:', '  e: []', '  f: {}', 'g:', '  - 1', '  - deux', '  - h: 3', '    i:', '      - 4', ''].join('\n'),
    )
  })

  it('met entre guillemets ce qui serait ambigu', () => {
    const y = toYaml({ '200': { description: 'OK' }, s: 'true', n: '12', ref: '#/x', c: 'a: b', e: '', '/users/{id}': 1, $ref: 'x' })
    expect(y).toContain('"200":')
    expect(y).toContain('s: "true"')
    expect(y).toContain('"n": "12"') // « n » est un booléen en YAML 1.1
    expect(y).toContain('ref: "#/x"')
    expect(y).toContain('c: "a: b"')
    expect(y).toContain('e: ""')
    expect(y).toContain('"/users/{id}": 1')
    expect(y).toContain('$ref: x')
  })

  it('le document OpenAPI en YAML garde sa structure', () => {
    const y = openApiToYaml(api)
    expect(y.startsWith('openapi: "3.1.0"\n')).toBe(true)
    expect(y).toContain('  "/users":\n    get:\n      operationId: getUsers')
    expect(y).toContain('$ref: "#/components/schemas/User"')
    expect(y).toContain('        "201":')
    expect(y).toContain('    - bearerAuth: []')
  })
})

describe('exemples', () => {
  it('valeurs d’exemple, listes et énumérations', () => {
    expect(sampleOf('int', api)).toBe(1)
    expect(sampleOf('enum(a|b)', api)).toBe('a')
    expect(sampleOf('string[]', api)).toEqual(['exemple'])
    expect(sampleOf('Inconnu', api)).toEqual({})
  })

  it('une référence circulaire s’arrête', () => {
    expect(sampleOf('User', api)).toEqual({ id: '00000000-0000-4000-8000-000000000000', email: 'exemple@exemple.fr', role: 'admin', friend: {} })
  })
})

describe('fichier .http', () => {
  const http = apiToHttpFile(api)

  it('déclare les variables : serveur, paramètres de chemin, jeton', () => {
    expect(http.startsWith('@baseUrl = https://api.exemple.fr\n@id = 00000000-0000-4000-8000-000000000000\n@token = <votre-jeton>\n')).toBe(true)
  })

  it('une requête par route, dans l’ordre de l’arbre, séparées par ###', () => {
    expect(http.match(/^###/gm)).toHaveLength(4)
    expect(http.indexOf('### Lister')).toBeLessThan(http.indexOf('### Détail'))
    expect(http).toContain('### GET /health')
  })

  it('requête : paramètres obligatoires et pagination dans l’URL, en-têtes, jeton', () => {
    expect(http).toContain('GET {{baseUrl}}/users?q=exemple&page=1&limit=20\nAuthorization: Bearer {{token}}\nAccept: application/json')
    expect(http).toContain('# Paramètres facultatifs : role (string)')
    expect(http).toContain('# En-tête facultatif : X-Request-Id (uuid)')
    expect(http).toContain('GET {{baseUrl}}/users/{{id}}\n')
  })

  it('corps JSON d’exemple avec son type de contenu', () => {
    expect(http).toContain('POST {{baseUrl}}/users\nContent-Type: application/json\nAccept: application/json\n\n{\n  "id":')
  })

  it('clé d’API et Basic, et valeur par défaut du serveur', () => {
    expect(apiToHttpFile(parseApiText('@auth apikey\n/a\n  GET [auth]', counter()).api)).toContain('X-API-Key: {{apiKey}}')
    const basic = apiToHttpFile(parseApiText('@auth basic\n/a\n  GET [auth]', counter()).api)
    expect(basic).toContain('Authorization: Basic {{credentials}}')
    expect(basic).toContain('@baseUrl = http://localhost:3000')
  })
})

describe('documentation Markdown', () => {
  const md = apiToMarkdown(api)

  it('en-tête, ressources et routes', () => {
    expect(md.startsWith('# Boutique\n\n**Version** : 1.0.0 · **Adresse** : `https://api.exemple.fr` · **Authentification** : jeton Bearer (JWT)\n')).toBe(true)
    expect(md).toContain('## Ressources\n\n### User\n\nun utilisateur\n')
    expect(md).toContain('| `role` | `enum(admin\\|user)` | non |') // la barre de l’énumération est échappée dans le tableau
    expect(md).toContain('## Routes')
    expect(md).toContain('### `GET /users` — Lister')
    expect(md).toContain('### `GET /health`')
  })

  it('protection, pagination, paramètres, corps et réponses', () => {
    expect(md).toContain('Authentification requise (jeton Bearer (JWT)) · Liste paginée')
    expect(md).toContain('| `page` | requête | `int` | non |')
    expect(md).toContain('| `id` | chemin | `uuid` | oui |')
    expect(md).toContain('**Corps de la requête** (JSON) : `User` — données du compte')
    expect(md).toContain('```json')
    expect(md).toContain('| `409` |  | e-mail déjà utilisé |')
    expect(md).toContain('| `401` |  | Non authentifié |')
  })

  it('un document vide donne une page minimale', () => {
    expect(apiToMarkdown({ info: {}, resources: [], endpoints: [] })).toBe('# API\n')
  })
})

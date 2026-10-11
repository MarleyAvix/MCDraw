import { describe, expect, it } from 'vitest'
import { API_EXAMPLES } from '../apiStore'
import { buildOpenApi, openApiToYaml } from '../openapi'
import { oneLine, openApiToApi, parseOpenApiSource } from '../importOpenApi'
import { apiToText, parseApiText } from '../text'
import { lintApi } from '../lint'
import type { ApiDocument } from '../model'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}

/** Le document sans ses identifiants techniques, pour comparer deux versions du même contenu. */
const strip = (d: ApiDocument) => ({
  ...d,
  resources: d.resources.map(({ id: _id, ...r }) => r),
  endpoints: d.endpoints.map(({ id: _id, ...e }) => e),
})

describe('aller-retour export → import', () => {
  for (const ex of API_EXAMPLES) {
    it(`« ${ex.label} » ressort identique après export OpenAPI (JSON) puis import`, () => {
      const original = parseApiText(ex.text, counter()).api
      const { api, notes } = openApiToApi(JSON.parse(JSON.stringify(buildOpenApi(original))), counter())
      expect(strip(api)).toEqual(strip(original))
      expect(notes).toEqual([])
    })

    it(`« ${ex.label} » ressort identique après export YAML puis import`, async () => {
      const original = parseApiText(ex.text, counter()).api
      const { api } = openApiToApi(await parseOpenApiSource(openApiToYaml(original)), counter())
      expect(strip(api)).toEqual(strip(original))
    })
  }
})

const YAML_DOC = `
openapi: 3.0.3
info:
  title: Animalerie
  version: "2.0"
  description: |
    Une API d'animalerie.
    Sur plusieurs lignes -- avec un tiret.
servers:
  - url: https://api.animalerie.test/v2
security:
  - oauth: [read]
paths:
  /pets:
    parameters:
      - $ref: '#/components/parameters/Trace'
    get:
      operationId: listPets
      summary: Lister les animaux -> tous [auth]
      parameters:
        - name: page
          in: query
          schema: { type: integer }
        - name: limit
          in: query
          schema: { type: integer }
        - name: filter[status]
          in: query
          schema: { type: string, enum: [available, sold] }
        - name: tags
          in: query
          schema: { type: array, items: { type: string } }
        - name: session
          in: cookie
          schema: { type: string }
      responses:
        "200":
          description: Une page
          headers:
            X-Total-Count: { schema: { type: integer } }
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Pet' }
        default:
          description: Erreur
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
    post:
      description: Ajoute un animal. Le reste est ignoré pour le résumé.
      security: []
      requestBody:
        description: L'animal à créer
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: { type: string }
                born: { type: string, format: date }
      responses:
        "201":
          description: Créé
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
        "4XX":
          description: Erreur client
    options:
      responses: { "200": { description: ok } }
  /pets/{pet-id}:
    get:
      parameters:
        - name: pet-id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Dog' }
        "404": { description: Introuvable }
components:
  securitySchemes:
    oauth:
      type: oauth2
      flows: {}
  parameters:
    Trace:
      name: X-Trace
      in: header
      schema: { type: string }
  schemas:
    Error:
      type: object
      properties:
        message: { type: string }
    Pet.Base:
      type: object
      required: [id]
      properties:
        id: { type: integer, description: "Identifiant -- unique" }
        owner: { $ref: '#/components/schemas/Owner' }
        nickname: { type: string, nullable: true }
        legacy: { oneOf: [{ type: string }, { type: integer }] }
        meta: { type: object, additionalProperties: true }
        matrix: { type: array, items: { type: array, items: { type: integer } } }
        kind: { type: string, enum: [cat, dog] }
        weight: { type: [number, "null"] }
        "first name": { type: string }
    Pet:
      allOf:
        - $ref: '#/components/schemas/Pet.Base'
        - type: object
          properties:
            tag: { type: string }
    Dog:
      allOf:
        - $ref: '#/components/schemas/Pet'
    Owner:
      type: object
      properties:
        name: { type: string }
        pets:
          type: array
          items: { $ref: '#/components/schemas/Pet' }
    Level:
      type: integer
      enum: [1, 2, 3]
`

describe('import d’un OpenAPI écrit à la main (YAML)', async () => {
  const { api, notes } = openApiToApi(await parseOpenApiSource(YAML_DOC), counter())
  const res = (n: string) => api.resources.find((r) => r.name === n)!
  const route = (m: string, p: string) => api.endpoints.find((e) => e.method === m && e.path === p)!

  it('reprend les informations, le serveur et l’authentification', () => {
    expect(api.info).toEqual({
      title: 'Animalerie',
      version: '2.0',
      description: "Une API d'animalerie. Sur plusieurs lignes – avec un tiret.",
      server: 'https://api.animalerie.test/v2',
      auth: 'bearer', // OAuth2 simplifié en jeton Bearer
    })
    expect(notes.some((n) => n.includes('OAuth2'))).toBe(true)
  })

  it('transforme les schémas nommés en ressources, avec des noms sûrs', () => {
    expect(api.resources.map((r) => r.name)).toEqual(['Error', 'PetBase', 'Owner', 'Pet', 'Dog', 'PostPetsRequest']) // le dernier vient de l'objet en ligne du POST
    expect(res('Pet').fields.map((f) => f.name)).toEqual(['id', 'owner', 'nickname', 'legacy', 'meta', 'matrix', 'kind', 'weight', 'first_name', 'tag']) // allOf fusionné
  })

  it('traduit les types : références, facultatifs, nullables, énumérations, simplifications', () => {
    const f = Object.fromEntries(res('Pet').fields.map((x) => [x.name, x]))
    expect(f.id).toEqual({ name: 'id', type: 'int', description: 'Identifiant – unique' })
    expect(f.owner).toMatchObject({ type: 'Owner', optional: true })
    expect(f.nickname).toMatchObject({ type: 'string', optional: true })
    expect(f.legacy.type).toBe('any')
    expect(f.meta.type).toBe('any')
    expect(f.matrix.type).toBe('any[]')
    expect(f.kind.type).toBe('enum(cat|dog)')
    expect(f.weight).toMatchObject({ type: 'number', optional: true })
    expect(res('Owner').fields[1]).toMatchObject({ name: 'pets', type: 'Pet[]' })
  })

  it('un schéma qui n’est pas un objet est remplacé par son type là où il est cité', () => {
    expect(api.resources.some((r) => r.name === 'Level')).toBe(false)
  })

  it('routes : méthodes prises en charge, chemins et paramètres', () => {
    expect(api.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /pets', 'POST /pets', 'GET /pets/{pet-id}'])
    expect(route('GET', '/pets/{pet-id}').params).toEqual([{ name: 'pet-id', in: 'path', type: 'uuid' }])
    const list = route('GET', '/pets')
    expect(list.params.map((p) => `${p.in}:${p.name}:${p.type}${p.optional ? '?' : ''}`)).toEqual(['query:filter[status]:enum(available|sold)?', 'query:tags:string?', 'header:X-Trace:string?'])
    expect(list.paginated).toBe(true) // page + limit deviennent [paginated]
  })

  it('résumés sur une ligne, sans séquences réservées', () => {
    expect(route('GET', '/pets').summary).toBe('Lister les animaux → tous (auth)')
    expect(route('POST', '/pets').summary).toBe('Ajoute un animal.')
  })

  it('authentification : globale, ou désactivée par security: []', () => {
    expect(route('GET', '/pets').auth).toBe(true)
    expect(route('POST', '/pets').auth).toBeUndefined()
  })

  it('corps et réponses, y compris les objets en ligne', () => {
    const post = route('POST', '/pets')
    expect(post.body).toEqual({ type: 'PostPetsRequest', description: "L'animal à créer" })
    expect(res('PostPetsRequest').fields).toEqual([{ name: 'name', type: 'string' }, { name: 'born', type: 'date', optional: true }])
    expect(post.responses).toEqual([{ status: 201, type: 'Pet' }]) // « Créé » est la description par défaut de 201
    expect(route('GET', '/pets').responses).toEqual([{ status: 200, type: 'Pet[]', description: 'Une page' }])
    expect(route('GET', '/pets/{pet-id}').responses).toEqual([{ status: 200, type: 'Dog' }, { status: 404 }]) // « Introuvable » est la description par défaut de 404
  })

  it('signale ce qui est simplifié ou ignoré', () => {
    for (const part of ['« default » ignorée', '« 4XX » ignorée', 'méthode OPTIONS ignorée', 'paramètre de cookie ignoré', 'oneOf / anyOf', 'liste de listes', 'objet libre', 'noms de champs', 'paramètre liste simplifié']) {
      expect(notes.some((n) => n.includes(part)), part).toBe(true)
    }
  })

  it('le résultat s’écrit en texte et se relit sans erreur, avec le même contenu', () => {
    const again = parseApiText(apiToText(api), counter())
    expect(again.errors).toEqual([])
    expect(strip(again.api)).toEqual(strip(api))
    expect(() => lintApi(api)).not.toThrow()
  })
})

describe('erreurs et cas limites', () => {
  const run = (v: unknown) => openApiToApi(v, counter())

  it('refuse ce qui n’est pas OpenAPI 3, avec un message utile', () => {
    expect(() => run(null)).toThrow('pas un document OpenAPI')
    expect(() => run([])).toThrow()
    expect(() => run({ swagger: '2.0', paths: {} })).toThrow('Swagger 2.0')
    expect(() => run({ info: {} })).toThrow('openapi')
    expect(() => run({ openapi: '2.9' })).toThrow('openapi')
    expect(() => run({ openapi: '3.1.0', paths: 'non' })).toThrow('paths')
  })

  it('un document sans routes ni composants donne une API vide', () => {
    expect(strip(run({ openapi: '3.1.0' }).api)).toEqual({ info: {}, resources: [], endpoints: [] })
  })

  it('résiste aux références circulaires, inconnues et externes', () => {
    const { api, notes } = run({
      openapi: '3.0.0',
      paths: { '/a': { get: { responses: { '200': { description: 'x', content: { 'application/json': { schema: { $ref: '#/components/schemas/Loop' } } } }, '201': { $ref: '#/components/responses/Nope' } } } } },
      components: { schemas: { Loop: { type: 'object', properties: { next: { $ref: '#/components/schemas/Loop' }, ext: { $ref: 'http://autre/x.json#/Y' }, ghost: { $ref: '#/components/schemas/Absent' } } } } },
    })
    expect(api.resources[0].fields.map((f) => f.type)).toEqual(['Loop', 'any', 'any'])
    expect(api.endpoints[0].responses[0]).toMatchObject({ status: 200, type: 'Loop' })
    expect(notes.some((n) => n.includes('référence externe ou inconnue'))).toBe(true)
  })

  it('un chemin invalide est écarté, pas fatal', () => {
    const { api, notes } = run({ openapi: '3.0.0', paths: { '/a b': { get: {} }, '/ok': { get: { responses: {} } } } })
    expect(api.endpoints.map((e) => e.path)).toEqual(['/ok'])
    expect(notes.some((n) => n.includes('chemin invalide'))).toBe(true)
  })

  it('deux schémas dont les noms se confondent restent distincts', () => {
    const { api } = run({ openapi: '3.0.0', components: { schemas: { 'a-b': { type: 'object', properties: { x: { type: 'string' } } }, 'a.b': { type: 'object', properties: { y: { type: 'string' } } } } } })
    expect(api.resources.map((r) => r.name)).toEqual(['AB', 'AB2'])
  })
})

describe('lecture du fichier', () => {
  it('reconnaît le JSON et le YAML, et refuse le reste', async () => {
    expect(await parseOpenApiSource('{"openapi":"3.0.0"}')).toEqual({ openapi: '3.0.0' })
    expect(await parseOpenApiSource('openapi: 3.0.0\npaths: {}')).toEqual({ openapi: '3.0.0', paths: {} })
    await expect(parseOpenApiSource('a: [1, 2\nb: : :')).rejects.toThrow('ni JSON ni YAML')
  })

  it('oneLine : une ligne, sans « -- », « -> » ni drapeaux, tronquée', () => {
    expect(oneLine('a\n  b -- c -> d [auth]')).toBe('a b – c → d (auth)')
    expect(oneLine('x'.repeat(300), 50)).toHaveLength(50)
    expect(oneLine(undefined)).toBe('')
  })
})

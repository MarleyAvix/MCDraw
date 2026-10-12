import { describe, expect, it } from 'vitest'
import { apiToText, parseApiText } from '../text'
import { buildOpenApi } from '../openapi'
import { openApiToApi } from '../importOpenApi'
import { apiToMarkdown } from '../markdown'
import { apiToTypeScript } from '../typescript'
import { sanitizeApi, tagsOf } from '../model'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}
const parse = (text: string) => parseApiText(text, counter())

const SRC = `/users
  GET Lister -> 200
    # Comptes, Admin
    ~ Renvoie tous les comptes, du plus récent au plus ancien -- sans pagination.
  DELETE Retirer [auth] [deprecated] -> 204
  /{id}
    GET Détail -> 200`

describe('description, groupes et obsolescence', () => {
  it('se lisent dans la saisie texte', () => {
    const { api, errors } = parse(SRC)
    expect(errors).toEqual([])
    const [list, del, detail] = api.endpoints
    expect(list.tags).toEqual(['Comptes', 'Admin'])
    expect(list.description).toBe('Renvoie tous les comptes, du plus récent au plus ancien -- sans pagination.')
    expect(del.deprecated).toBe(true)
    expect(del.auth).toBe(true)
    expect(detail.tags).toBeUndefined()
  })

  it('font l’aller-retour texte → document → texte', () => {
    const first = parse(SRC).api
    const again = parse(apiToText(first))
    expect(again.errors).toEqual([])
    expect(again.api.endpoints.map(({ id: _, ...e }) => e)).toEqual(first.endpoints.map(({ id: _, ...e }) => e))
  })

  it('signalent un groupe ou une description vides', () => {
    expect(parse('/a\n  GET -> 200\n    # ,').errors[0].message).toMatch(/Groupes/)
    expect(parse('/a\n  GET -> 200\n    ~').errors[0].message).toMatch(/Description/)
  })

  it('sont validées à l’ouverture d’un fichier', () => {
    const api = sanitizeApi({ endpoints: [{ method: 'GET', path: '/a', tags: ['x', ' x ', '', 3, 'a,b'], deprecated: 'oui', description: '  long  ' }] }, counter())
    expect(api.endpoints[0]).toMatchObject({ tags: ['x', '3'], description: 'long' })
    expect(api.endpoints[0].deprecated).toBeUndefined()
  })

  it('tagsOf déduit le groupe du chemin quand aucun n’est déclaré', () => {
    expect(tagsOf({ path: '/users/{id}' })).toEqual(['users'])
    expect(tagsOf({ path: '/users', tags: ['Comptes'] })).toEqual(['Comptes'])
    expect(tagsOf({ path: '/' })).toEqual([])
  })
})

describe('exports', () => {
  const api = parse(SRC).api

  it('OpenAPI : tags explicites, tag déduit sinon, description et deprecated', () => {
    const paths = buildOpenApi(api).paths as Record<string, Record<string, Record<string, unknown>>>
    expect(paths['/users'].get).toMatchObject({ tags: ['Comptes', 'Admin'], description: expect.stringContaining('Renvoie') })
    expect(paths['/users'].delete).toMatchObject({ deprecated: true, tags: ['users'] })
    expect(paths['/users'].get.deprecated).toBeUndefined()
    expect(paths['/users/{id}'].get.tags).toEqual(['users'])
  })

  it('OpenAPI : un aller-retour conserve groupes, description et obsolescence', () => {
    const plain = parse(SRC.replace(' -- sans pagination', ''))
    const back = openApiToApi(buildOpenApi(plain.api), counter()).api
    const strip = (a: typeof api) => a.endpoints.map(({ id: _, ...e }) => e)
    expect(strip(back)).toEqual(strip(plain.api))
  })

  it('import : un seul tag identique au chemin est déduit, pas stocké', () => {
    const { api: imported } = openApiToApi({ openapi: '3.0.0', paths: { '/pets': { get: { tags: ['pets'], summary: 'Liste', description: 'Toutes les bêtes.', deprecated: true, responses: { 200: { description: 'OK' } } } } } }, counter())
    expect(imported.endpoints[0]).toMatchObject({ description: 'Toutes les bêtes.', deprecated: true })
    expect(imported.endpoints[0].tags).toBeUndefined()
  })

  it('import : sans résumé, la description sert de résumé et n’est pas dupliquée', () => {
    const { api: imported } = openApiToApi({ openapi: '3.0.0', paths: { '/pets': { get: { description: 'Toutes les bêtes.', responses: { 200: { description: 'OK' } } } } } }, counter())
    expect(imported.endpoints[0].summary).toBe('Toutes les bêtes.')
    expect(imported.endpoints[0].description).toBeUndefined()
  })

  it('Markdown et TypeScript mentionnent l’obsolescence et la description', () => {
    expect(apiToMarkdown(api)).toContain('Obsolète')
    expect(apiToMarkdown(api)).toContain('Groupes : Comptes, Admin')
    const ts = apiToTypeScript(api)
    expect(ts).toContain('@deprecated')
    expect(ts).toContain('Renvoie tous les comptes')
  })
})

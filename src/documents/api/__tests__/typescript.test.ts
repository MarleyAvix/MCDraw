import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { API_EXAMPLES } from '../apiStore'
import { apiToTypeScript, tsType } from '../typescript'
import { parseApiText } from '../text'
import { emptyApi } from '../model'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}
const gen = (text: string) => apiToTypeScript(parseApiText(text, counter()).api)

/** Compile le code généré avec le vrai compilateur TypeScript, en mode strict ; renvoie les erreurs. */
function typeCheck(source: string): string[] {
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], noEmit: true, skipLibCheck: true, types: [] }
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, lang, ...rest) => (name === 'client.ts' ? ts.createSourceFile(name, source, lang) : original(name, lang, ...rest))
  host.fileExists = (name) => name === 'client.ts' || ts.sys.fileExists(name)
  host.readFile = (name) => (name === 'client.ts' ? source : ts.sys.readFile(name))
  const program = ts.createProgram(['client.ts'], options, host)
  return ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.getLineAndCharacterOfPosition(d.start ?? 0).line ?? '?'}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
}

/** Charge le client généré (transpilé en CommonJS) pour l'exécuter avec un faux `fetch`. */
function load(source: string) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}
  new Function('exports', js)(exports)
  return exports as { createClient: (o?: any) => Record<string, (a?: any) => Promise<any>>; ApiError: new (s: number, b: unknown) => Error & { status: number; body: unknown } }
}

interface Call {
  url: string
  method: string
  headers: Headers
  body?: string
}
function fake(status = 200, body: unknown = {}, headers: Record<string, string> = {}) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Headers, body: init.body as string | undefined })
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers })
  }
  return { calls, fetch }
}

describe('types', () => {
  const known = new Set(['User'])
  it('traduit chaque type', () => {
    expect(tsType('uuid', known)).toBe('string')
    expect(tsType('datetime', known)).toBe('string')
    expect(tsType('int', known)).toBe('number')
    expect(tsType('bool', known)).toBe('boolean')
    expect(tsType('any', known)).toBe('unknown')
    expect(tsType('User', known)).toBe('User')
    expect(tsType('Ghost', known)).toBe('unknown')
    expect(tsType('User[]', known)).toBe('User[]')
    expect(tsType('enum(a|b)', known)).toBe('"a" | "b"')
    expect(tsType('enum(a|b)[]', known)).toBe('("a" | "b")[]')
    expect(tsType('enum(a)[]', known)).toBe('"a"[]')
  })
})

describe('génération', () => {
  for (const ex of API_EXAMPLES) {
    it(`le client de « ${ex.label} » passe le compilateur TypeScript en mode strict`, () => {
      expect(typeCheck(gen(ex.text))).toEqual([])
    })
  }

  it('une API vide donne tout de même un client valide', () => {
    expect(typeCheck(apiToTypeScript(emptyApi()))).toEqual([])
  })

  it('déclare les interfaces avec champs facultatifs, énumérations et descriptions', () => {
    const src = gen('schema User -- un compte\n  id: uuid -- identifiant\n  role: enum(admin|user)?')
    expect(src).toContain('/** un compte */\nexport interface User {')
    expect(src).toContain('/** identifiant */\n  id: string')
    expect(src).toContain('role?: "admin" | "user"')
  })

  it('génère une méthode par route, nommée comme son operationId, avec ses paramètres typés', () => {
    const src = gen('@server https://api.test\n@auth bearer\nschema User\n  id: int\n/users\n  GET Lister [auth] [paginated] -> 200 User[]\n    ? role: string?\n  /{id:int}\n    GET Détail -> 200 User, 404\n    PUT Modifier [auth]\n      < User\n      > 200 User')
    expect(src).toContain('async getUsers(args: { query?: { role?: string; page?: number; limit?: number } } = {}): Promise<Paginated<User[]>>')
    expect(src).toContain('async getUsersById(args: { id: number }): Promise<User>')
    expect(src).toContain('async putUsersById(args: { id: number; body: User }): Promise<User>')
    expect(src).toContain('/** Lister — GET /users */')
  })

  it('un paramètre obligatoire rend l’argument obligatoire, un en-tête facultatif non', () => {
    const src = gen('/a\n  GET -> 200\n    ? q: string\n    @ X-Id: uuid?\n  POST -> 204\n    @ X-Id: uuid?')
    expect(src).toContain('async getA(args: { query: { q: string }; headers?: { "X-Id"?: string } }): Promise<void>')
    expect(src).toContain('async postA(args: { headers?: { "X-Id"?: string } } = {}): Promise<void>')
  })

  it('les noms de paramètres exotiques restent valides', () => {
    const src = gen('/a/{user-id}/{query}\n  GET -> 200\n    ? filter[status]: string?')
    expect(src).toContain('"user-id": string')
    expect(src).toContain('queryPath: string') // ne heurte pas le groupe « query »
    expect(typeCheck(src)).toEqual([])
  })

  it('ne cite jamais une dépendance externe', () => {
    expect(gen(API_EXAMPLES[0].text)).not.toMatch(/^import /m)
  })
})

describe('exécution du client généré', () => {
  const api = `@server https://api.test/v1/
@auth bearer
schema User
  id: int
/users
  GET Lister [auth] [paginated] -> 200 User[]
    ? role: string?
    @ X-Trace: string?
  POST Créer [auth]
    < User
    > 201 User
  /{id:int}
    GET Détail -> 200 User, 404
    DELETE Retirer [auth] -> 204
/ping
  GET -> 200 string`
  const mod = load(gen(api))

  it('construit l’URL avec l’adresse de base, le chemin encodé et la requête', async () => {
    const f = fake(200, { id: 1 })
    const c = mod.createClient({ fetch: f.fetch })
    await c.getUsersById({ id: 7 })
    expect(f.calls[0].url).toBe('https://api.test/v1/users/7')
    expect(f.calls[0].method).toBe('GET')

    await c.getUsers({ query: { role: 'admin', page: 2 } })
    expect(f.calls[1].url).toBe('https://api.test/v1/users?role=admin&page=2')
    await mod.createClient({ fetch: f.fetch, baseUrl: 'http://x' }).getPing()
    expect(f.calls[2].url).toBe('http://x/ping')
  })

  it('ajoute le jeton seulement aux routes protégées, fourni en valeur ou en fonction', async () => {
    const f = fake()
    const c = mod.createClient({ fetch: f.fetch, auth: () => Promise.resolve('secret') })
    await c.getUsers()
    await c.getUsersById({ id: 1 })
    expect(f.calls[0].headers.get('Authorization')).toBe('Bearer secret')
    expect(f.calls[1].headers.get('Authorization')).toBeNull()
    await mod.createClient({ fetch: f.fetch, auth: 'abc' }).deleteUsersById({ id: 1 })
    expect(f.calls[2].headers.get('Authorization')).toBe('Bearer abc')
  })

  it('envoie le corps en JSON avec son type de contenu, et les en-têtes demandés', async () => {
    const f = fake(201, { id: 3 })
    const c = mod.createClient({ fetch: f.fetch, headers: { 'X-App': 'demo' } })
    expect(await c.postUsers({ body: { id: 3 } })).toEqual({ id: 3 })
    expect(f.calls[0].body).toBe('{"id":3}')
    expect(f.calls[0].headers.get('Content-Type')).toBe('application/json')
    expect(f.calls[0].headers.get('X-App')).toBe('demo')
    await c.getUsers({ headers: { 'X-Trace': 't1' } })
    expect(f.calls[1].headers.get('X-Trace')).toBe('t1')
    expect(f.calls[1].headers.get('Content-Type')).toBeNull()
  })

  it('une liste paginée renvoie les éléments et le total de l’en-tête', async () => {
    const f = fake(200, [{ id: 1 }], { 'X-Total-Count': '42' })
    expect(await mod.createClient({ fetch: f.fetch }).getUsers()).toEqual({ items: [{ id: 1 }], total: 42 })
    const none = fake(200, [])
    expect(await mod.createClient({ fetch: none.fetch }).getUsers()).toEqual({ items: [], total: null })
  })

  it('une réponse sans contenu (204) se termine sans erreur', async () => {
    const f = fake(204)
    await expect(mod.createClient({ fetch: f.fetch }).deleteUsersById({ id: 1 })).resolves.toBeUndefined()
  })

  it('un échec HTTP lève une ApiError avec le code et le corps décodé', async () => {
    const f = fake(404, { message: 'nope' })
    const err = await mod.createClient({ fetch: f.fetch }).getUsersById({ id: 9 }).catch((e) => e)
    expect(err).toBeInstanceOf(mod.ApiError)
    expect(err).toMatchObject({ status: 404, body: { message: 'nope' }, name: 'ApiError' })
  })

  it('encode les valeurs de chemin', async () => {
    const m = load(gen('/files/{name}\n  GET -> 200'))
    const f = fake()
    await m.createClient({ fetch: f.fetch, baseUrl: 'http://x' }).getFilesByName({ name: 'a/b c' })
    expect(f.calls[0].url).toBe('http://x/files/a%2Fb%20c')
  })
})

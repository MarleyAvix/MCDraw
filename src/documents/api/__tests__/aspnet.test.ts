import { describe, expect, it } from 'vitest'
import { API_EXAMPLES } from '../apiStore'
import { apiToAspNet } from '../aspnet'
import { parseApiText } from '../text'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}
const gen = (text: string, options?: { namespace?: string }) => apiToAspNet(parseApiText(text, counter()).api, options)

const SRC = `@auth bearer
schema User
  id: uuid
  created_at: datetime
  role: enum(admin|in_progress)?
  class: string
/users
  GET Lister [auth] [paginated] -> 200 User[], 401
    ? role: string?
    ? filter[status]: string
    @ X-Request-Id: uuid?
  POST Créer -> 201 User, 422
    < User
    # Comptes
    ~ Crée un compte.
  /{user-id:uuid}
    GET Détail -> 200 User, 404
    DELETE Retirer [deprecated] -> 204
/files/{name}/{id:int}
  GET -> 200 string`

describe('export ASP.NET Core', () => {
  const src = gen(SRC)

  it('déclare un record par schéma, avec champs obligatoires, facultatifs et noms JSON d’origine', () => {
    expect(src).toContain('public record User')
    expect(src).toContain('public required Guid Id { get; init; }')
    expect(src).toContain('[JsonPropertyName("created_at")]\n    public required DateTime CreatedAt { get; init; }')
    expect(src).toContain('public UserRole? Role { get; init; }')
    expect(src).toContain('public required string Class { get; init; }')
  })

  it('transforme chaque route en endpoint avec son chemin typé', () => {
    expect(src).toContain('app.MapGet("/users", (')
    expect(src).toContain('app.MapPost("/users", (User body) =>')
    expect(src).toContain('app.MapGet("/users/{userId:guid}", (Guid userId) =>')
    expect(src).toContain('app.MapDelete("/users/{userId:guid}"')
    expect(src).toContain('app.MapGet("/files/{name}/{id:int}", (string name, int id) =>')
  })

  it('lie les paramètres de requête et d’en-tête, obligatoires avant facultatifs, pagination en dernier', () => {
    expect(src).toContain('([FromQuery(Name = "filter[status]")] string filterStatus, [FromQuery] string? role, [FromHeader(Name = "X-Request-Id")] Guid? xRequestId, int page = 1, int limit = 20)')
  })

  it('déclare nom, résumé, description, groupes, authentification et réponses', () => {
    expect(src).toContain('.WithName("getUsers")')
    expect(src).toContain('.WithSummary("Lister")')
    expect(src).toContain('.WithTags("Comptes")')
    expect(src).toContain('.WithTags("users")')
    expect(src).toContain('.WithDescription("Crée un compte.")')
    expect(src).toContain('.RequireAuthorization()')
    expect(src).toContain('.Produces<List<User>>(200)')
    expect(src).toContain('.ProducesProblem(401)')
    expect(src).toContain('.Produces(204);')
  })

  it('signale les routes obsolètes et ne protège que les routes marquées', () => {
    expect(src).toContain('// DELETE /users/{user-id} — Retirer (obsolète)')
    expect(src.match(/\.RequireAuthorization\(\)/g)).toHaveLength(1)
  })

  it('applique l’espace de noms demandé et échappe les guillemets', () => {
    expect(gen('/a\n  GET -> 200\n    ~ dit "oui"', { namespace: 'Boutique.Api' })).toContain('namespace Boutique.Api;')
    expect(gen('/a\n  GET -> 200\n    ~ dit "oui"')).toContain('.WithDescription("dit \\"oui\\"")')
  })

  it('protège les mots réservés C# dans les noms de paramètres', () => {
    expect(gen('/a\n  GET -> 200\n    ? class: string')).toContain("[FromQuery] string @class")
  })

  it('une API vide donne une classe valide', () => {
    expect(gen('')).toContain('// Aucune route décrite.')
  })

  for (const ex of API_EXAMPLES) {
    it(`« ${ex.label} » produit des endpoints équilibrés`, () => {
      const out = gen(ex.text)
      expect(out).toContain('MapApi')
      expect(out.split('{').length).toBe(out.split('}').length)
      expect(out.split('(').length).toBe(out.split(')').length)
    })
  }
})

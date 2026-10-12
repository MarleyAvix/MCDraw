/**
 * Export ASP.NET Core (Minimal API) : les schémas deviennent des `record`, les routes des endpoints prêts à remplir.
 * Chaque route garde sa méthode, son chemin typé (`{id:guid}`), ses paramètres liés (`[FromQuery]`, `[FromHeader]`, corps),
 * son nom, ses groupes, son authentification et ses réponses déclarées ; le corps du handler reste à écrire.
 */
import { camelIdent, CS_PRIMITIVE, csString, xml } from './csharp'
import { operationIds } from './openapi'
import { isParamSegment, parseTypeExpr, segmentsOf, tagsOf, type ApiDocument, type ApiEndpoint, type ApiParam } from './model'
import { pascal } from '../../engine/mldToEfCore'

export interface AspNetOptions {
  namespace: string
}
export const ASPNET_DEFAULTS: AspNetOptions = { namespace: 'MonApp.Api' }

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/
const ROUTE_CONSTRAINT: Record<string, string> = { int: ':int', uuid: ':guid', number: ':double', bool: ':bool' }

/** Type C# d'une expression de type de l'API. `enums` collecte les énumérations à déclarer. */
function csType(type: string, known: Set<string>, enumName?: string, enums?: Map<string, string[]>): string {
  const t = parseTypeExpr(type)
  if (!t) return 'object'
  let base: string
  if (t.kind === 'ref') base = known.has(t.name) ? t.name : 'object'
  else if (t.kind === 'enum') {
    if (enumName && enums) {
      enums.set(enumName, t.values)
      base = enumName
    } else base = 'string'
  } else base = CS_PRIMITIVE[t.name] ?? 'string'
  return t.array ? `List<${base}>` : base
}

/** Type d'un paramètre (valeur simple) : les énumérations restent des chaînes. */
const paramType = (p: ApiParam) => csType(p.type, new Set())

/** Écrit un enum C# dont les valeurs gardent leur forme dans le JSON (`in_progress`). */
function enumLines(name: string, values: string[]): string[] {
  const seen = new Set<string>()
  const out = [`[JsonConverter(typeof(JsonStringEnumConverter))]`, `public enum ${name}`, '{']
  values.forEach((v, i) => {
    let m = pascal(v)
    while (seen.has(m)) m += '_'
    seen.add(m)
    out.push(`    ${m}${i < values.length - 1 ? ',' : ''}`)
  })
  out.push('}')
  return out
}

export function apiToAspNet(api: ApiDocument, options: Partial<AspNetOptions> = {}): string {
  const o = { ...ASPNET_DEFAULTS, ...options }
  const known = new Set(api.resources.filter((r) => IDENT.test(r.name)).map((r) => r.name))
  const ids = operationIds(api.endpoints)
  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('using System;')
  w('using System.Collections.Generic;')
  w('using System.Text.Json.Serialization;')
  w('using Microsoft.AspNetCore.Builder;')
  w('using Microsoft.AspNetCore.Http;')
  w('using Microsoft.AspNetCore.Mvc;')
  w('using Microsoft.AspNetCore.Routing;')
  w()
  w(`namespace ${o.namespace};`)
  w()
  w(`// Généré par MCDraw${api.info.title ? ` — ${api.info.title}` : ''}. Branchez-le dans Program.cs avec : app.MapApi();`)
  if (api.endpoints.some((e) => e.auth)) {
    const scheme = { bearer: 'AddAuthentication().AddJwtBearer()', apiKey: 'une authentification par clé d’API (en-tête X-API-Key)', basic: 'une authentification Basic' }[api.info.auth ?? 'bearer']
    w(`// Les routes protégées appellent RequireAuthorization() : configurez ${scheme} puis app.UseAuthentication(); app.UseAuthorization();`)
  }
  w()

  // --- Contrats : un record par schéma ---------------------------------------------------
  const enums = new Map<string, string[]>()
  const records: string[] = []
  for (const r of api.resources) {
    if (!IDENT.test(r.name)) continue
    const out: string[] = []
    if (r.description) out.push(`/// <summary>${xml(r.description)}</summary>`)
    out.push(`public record ${r.name}`, '{')
    const taken = new Set<string>([r.name])
    for (const f of r.fields) {
      let prop = pascal(f.name)
      while (taken.has(prop)) prop += '_'
      taken.add(prop)
      const type = csType(f.type, known, `${r.name}${pascal(f.name)}`, enums)
      if (f.description) out.push(`    /// <summary>${xml(f.description)}</summary>`)
      if (f.name !== prop[0].toLowerCase() + prop.slice(1)) out.push(`    [JsonPropertyName(${csString(f.name)})]`)
      out.push(`    public ${f.optional ? '' : 'required '}${type}${f.optional ? '?' : ''} ${prop} { get; init; }`)
    }
    out.push('}')
    records.push(out.join('\n'))
  }
  if (enums.size) {
    w('// Énumérations : écrites en texte, avec la casse des noms C#. Pour reproduire exactement les valeurs de l’API (in_progress),')
    w('// enregistrez dans Program.cs : ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower))).')
    w()
  }
  for (const [name, values] of enums) w(enumLines(name, values).join('\n')), w()
  for (const r of records) w(r), w()

  // --- Endpoints ---------------------------------------------------------------------
  w('public static class ApiEndpoints')
  w('{')
  w('    public static IEndpointRouteBuilder MapApi(this IEndpointRouteBuilder app)')
  w('    {')
  if (!api.endpoints.length) w('        // Aucune route décrite.')
  for (const e of api.endpoints) lines.push(...endpointLines(e))
  w('        return app;')
  w('    }')
  w('}')
  return `${lines.join('\n')}\n`

  function endpointLines(e: ApiEndpoint): string[] {
    const taken = new Set<string>()
    const ident = (name: string) => {
      let id = camelIdent(name)
      while (taken.has(id)) id += '_'
      taken.add(id)
      return id
    }
    const pathNames = new Map<string, string>()
    for (const s of segmentsOf(e.path)) if (isParamSegment(s)) pathNames.set(s.slice(1, -1), ident(s.slice(1, -1)))

    const template = segmentsOf(e.path)
      .map((s) => {
        if (!isParamSegment(s)) return s
        const name = s.slice(1, -1)
        const t = parseTypeExpr(e.params.find((x) => x.in === 'path' && x.name === name)?.type ?? '')
        return `{${pathNames.get(name)!.replace(/^@/, '')}${(t?.kind === 'prim' && ROUTE_CONSTRAINT[t.name]) || ''}}`
      })
      .join('/')

    // Ordre imposé par C# : les paramètres obligatoires, puis ceux qui ont une valeur par défaut.
    const required: string[] = []
    const optional: string[] = []
    for (const p of e.params.filter((x) => x.in === 'path')) required.push(`${paramType(p)} ${pathNames.get(p.name)}`)
    for (const p of e.params.filter((x) => x.in !== 'path')) {
      const id = ident(p.name)
      const attr = p.in === 'query' ? 'FromQuery' : 'FromHeader'
      const name = id.replace(/^@/, '') !== p.name ? `(Name = ${csString(p.name)})` : ''
      const decl = `[${attr}${name}] ${paramType(p)}${p.optional ? '?' : ''} ${id}`
      ;(p.optional ? optional : required).push(decl)
    }
    if (e.body) required.push(`${csType(e.body.type, known)} ${ident('body')}`)
    if (e.paginated) {
      const declared = new Set(e.params.filter((x) => x.in === 'query').map((x) => x.name))
      if (!declared.has('page')) optional.push(`int ${ident('page')} = 1`)
      if (!declared.has('limit')) optional.push(`int ${ident('limit')} = 20`)
    }

    const name = ids.get(e.id)!
    const chain = [`.WithName(${csString(name)})`]
    if (e.summary) chain.push(`.WithSummary(${csString(e.summary)})`)
    if (e.description) chain.push(`.WithDescription(${csString(e.description)})`)
    const tags = tagsOf(e)
    if (tags.length) chain.push(`.WithTags(${tags.map(csString).join(', ')})`)
    if (e.auth) chain.push('.RequireAuthorization()')
    const list = e.responses.length ? e.responses : [{ status: 200 } as ApiEndpoint['responses'][number]]
    for (const r of list) {
      if (r.type) chain.push(`.Produces<${csType(r.type, known)}>(${r.status})`)
      else if (r.status >= 400) chain.push(`.ProducesProblem(${r.status})`)
      else chain.push(`.Produces(${r.status})`)
    }

    const out: string[] = []
    out.push(`        // ${e.method} ${e.path}${e.summary ? ` — ${e.summary}` : ''}${e.deprecated ? ' (obsolète)' : ''}`)
    if (e.paginated) out.push('        // Liste paginée : renvoyez aussi l’en-tête X-Total-Count.')
    out.push(`        app.Map${e.method[0]}${e.method.slice(1).toLowerCase()}(${csString(`/${template}`)}, (${[...required, ...optional].join(', ')}) =>`)
    out.push('            Results.StatusCode(StatusCodes.Status501NotImplemented)) // TODO : à implémenter')
    chain.forEach((c, i) => out.push(`            ${c}${i === chain.length - 1 ? ';' : ''}`))
    out.push('')
    return out
  }
}

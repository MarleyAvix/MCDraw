/**
 * Export OpenAPI 3.1 : le document décrit avec le vocabulaire du standard, prêt pour Swagger UI, Postman ou un
 * générateur de clients. `buildOpenApi` produit l'objet ; `openApiToJson` / `openApiToYaml` le sérialisent.
 */
import {
  isSuccess,
  parseTypeExpr,
  segmentsOf,
  statusText,
  isParamSegment,
  type ApiDocument,
  type ApiEndpoint,
  type ApiParam,
  type ApiResponse,
  type AuthScheme,
} from './model'
import { toYaml } from './yaml'

type Json = Record<string, unknown>

const PRIMITIVE_SCHEMA: Record<string, Json> = {
  string: { type: 'string' },
  int: { type: 'integer' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', format: 'date-time' },
  uuid: { type: 'string', format: 'uuid' },
  email: { type: 'string', format: 'email' },
  url: { type: 'string', format: 'uri' },
  any: {},
}

/** Schéma JSON d'une expression de type (`User[]`, `enum(a|b)`, `int`…). */
export function jsonSchemaOf(type: string): Json {
  const t = parseTypeExpr(type)
  if (!t) return {}
  const base: Json = t.kind === 'ref' ? { $ref: `#/components/schemas/${t.name}` } : t.kind === 'enum' ? { type: 'string', enum: t.values } : { ...PRIMITIVE_SCHEMA[t.name] }
  return t.array ? { type: 'array', items: base } : base
}

const SECURITY: Record<AuthScheme, { name: string; scheme: Json }> = {
  bearer: { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  apiKey: { name: 'apiKeyAuth', scheme: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
  basic: { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } },
}

const cap = (s: string) => s.replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase())

/** `getUsers`, `getUsersById`, `createUsers`… : unique dans tout le document. */
function operationIds(endpoints: ApiEndpoint[]): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const e of endpoints) {
    const parts = segmentsOf(e.path).map((s) => (isParamSegment(s) ? `By${cap(s.slice(1, -1))}` : cap(s)))
    const base = `${e.method.toLowerCase()}${parts.join('') || 'Root'}`
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`
    taken.add(id)
    out.set(e.id, id)
  }
  return out
}

const PAGINATION: ApiParam[] = [
  { name: 'page', in: 'query', type: 'int', optional: true, description: 'Numéro de page (à partir de 1).' },
  { name: 'limit', in: 'query', type: 'int', optional: true, description: 'Nombre d’éléments par page.' },
]

function parameter(p: ApiParam): Json {
  const schema = jsonSchemaOf(p.type)
  if (p.in === 'query' && p.name === 'page') Object.assign(schema, { minimum: 1, default: 1 })
  if (p.in === 'query' && p.name === 'limit') Object.assign(schema, { minimum: 1, maximum: 100, default: 20 })
  return { name: p.name, in: p.in, required: p.in === 'path' || !p.optional, ...(p.description ? { description: p.description } : {}), schema }
}

export function buildOpenApi(api: ApiDocument): Json {
  const ids = operationIds(api.endpoints)
  const usedAuth = new Set<AuthScheme>()
  const defaultAuth = api.info.auth ?? 'bearer'

  const paths: Record<string, Json> = {}
  for (const e of api.endpoints) {
    const declared = new Set(e.params.map((p) => `${p.in}:${p.name}`))
    const params = [...e.params, ...(e.paginated ? PAGINATION.filter((p) => !declared.has(`query:${p.name}`)) : [])]
    const tag = segmentsOf(e.path).find((s) => !isParamSegment(s))

    const responses: Record<string, Json> = {}
    const list: ApiResponse[] = e.responses.length ? e.responses : [{ status: 200 }]
    for (const r of list) {
      const withCount = e.paginated && isSuccess(r.status)
      responses[String(r.status)] = {
        description: r.description ?? statusText(r.status),
        ...(r.type ? { content: { 'application/json': { schema: jsonSchemaOf(r.type) } } } : {}),
        ...(withCount ? { headers: { 'X-Total-Count': { description: 'Nombre total d’éléments.', schema: { type: 'integer' } } } } : {}),
      }
    }

    if (e.auth) usedAuth.add(defaultAuth)
    const op: Json = {
      operationId: ids.get(e.id),
      ...(e.summary ? { summary: e.summary } : {}),
      ...(tag ? { tags: [tag] } : {}),
      ...(params.length ? { parameters: params.map(parameter) } : {}),
      ...(e.body ? { requestBody: { required: true, ...(e.body.description ? { description: e.body.description } : {}), content: { 'application/json': { schema: jsonSchemaOf(e.body.type) } } } } : {}),
      responses,
      ...(e.auth ? { security: [{ [SECURITY[defaultAuth].name]: [] }] } : {}),
    }
    ;(paths[e.path] ??= {})[e.method.toLowerCase()] = op
  }

  const schemas: Record<string, Json> = {}
  for (const r of api.resources) {
    const required = r.fields.filter((f) => !f.optional).map((f) => f.name)
    schemas[r.name] = {
      type: 'object',
      ...(r.description ? { description: r.description } : {}),
      properties: Object.fromEntries(r.fields.map((f) => [f.name, { ...jsonSchemaOf(f.type), ...(f.description ? { description: f.description } : {}) }])),
      ...(required.length ? { required } : {}),
    }
  }

  const schemes = new Set<AuthScheme>(usedAuth)
  if (api.info.auth) schemes.add(api.info.auth)
  return {
    openapi: '3.1.0',
    info: { title: api.info.title ?? 'API', version: api.info.version ?? '1.0.0', ...(api.info.description ? { description: api.info.description } : {}) },
    ...(api.info.server ? { servers: [{ url: api.info.server }] } : {}),
    paths,
    ...(Object.keys(schemas).length || schemes.size
      ? {
          components: {
            ...(Object.keys(schemas).length ? { schemas } : {}),
            ...(schemes.size ? { securitySchemes: Object.fromEntries([...schemes].map((a) => [SECURITY[a].name, SECURITY[a].scheme])) } : {}),
          },
        }
      : {}),
  }
}

export const openApiToJson = (api: ApiDocument) => `${JSON.stringify(buildOpenApi(api), null, 2)}\n`
export const openApiToYaml = (api: ApiDocument) => toYaml(buildOpenApi(api))

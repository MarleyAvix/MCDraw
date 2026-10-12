/**
 * Export d'un fichier `.http` : une requête par route, exécutable depuis VS Code (REST Client) ou les IDE JetBrains.
 * Les paramètres de chemin et les secrets deviennent des variables en tête de fichier, à renseigner une fois.
 */
import { walkTree } from '../../core/tree'
import type { ApiDocument, ApiEndpoint } from './model'
import { buildPathTree } from './pathTree'
import { sampleOf, sampleText } from './sample'

export function apiToHttpFile(api: ApiDocument): string {
  const order = walkTree(buildPathTree(api.endpoints)).flatMap(({ item }) => item.endpoints)
  const out: string[] = []

  const vars = new Map<string, string>([['baseUrl', api.info.server ?? 'http://localhost:3000']])
  for (const e of order) for (const p of e.params.filter((p) => p.in === 'path')) if (!vars.has(p.name)) vars.set(p.name, sampleText(p.type, api))
  const usesAuth = order.some((e) => e.auth)
  if (usesAuth) {
    if (api.info.auth === 'apiKey') vars.set('apiKey', '<votre-clé>')
    else if (api.info.auth === 'basic') vars.set('credentials', '<utilisateur:motdepasse en base64>')
    else vars.set('token', '<votre-jeton>')
  }
  out.push(...[...vars].map(([k, v]) => `@${k} = ${v}`), '')

  for (const e of order) out.push(...requestLines(e, api), '')
  return `${out.join('\n').trimEnd()}\n`
}

function requestLines(e: ApiEndpoint, api: ApiDocument): string[] {
  const lines = [`### ${e.summary ?? `${e.method} ${e.path}`}`]
  const note: string[] = []
  if (e.deprecated) note.push('Route obsolète')
  if (e.description) note.push(e.description)

  const url = `{{baseUrl}}${e.path.replace(/\{([^}]+)\}/g, (_, n: string) => `{{${n}}}`)}`
  const query = e.params.filter((p) => p.in === 'query')
  const required = query.filter((p) => !p.optional).map((p) => `${p.name}=${sampleText(p.type, api)}`)
  if (e.paginated && !query.some((p) => p.name === 'page')) required.push('page=1')
  if (e.paginated && !query.some((p) => p.name === 'limit')) required.push('limit=20')
  const optional = query.filter((p) => p.optional).map((p) => `${p.name} (${p.type})`)
  if (optional.length) note.push(`Paramètres facultatifs : ${optional.join(', ')}`)

  const headers: string[] = []
  if (e.auth) {
    if (api.info.auth === 'apiKey') headers.push('X-API-Key: {{apiKey}}')
    else if (api.info.auth === 'basic') headers.push('Authorization: Basic {{credentials}}')
    else headers.push('Authorization: Bearer {{token}}')
  }
  for (const h of e.params.filter((p) => p.in === 'header')) {
    if (h.optional) note.push(`En-tête facultatif : ${h.name} (${h.type})`)
    else headers.push(`${h.name}: ${sampleText(h.type, api)}`)
  }
  if (e.body) headers.push('Content-Type: application/json')
  headers.push('Accept: application/json')

  lines.push(...note.map((n) => `# ${n}`))
  lines.push(`${e.method} ${url}${required.length ? `?${required.join('&')}` : ''}`, ...headers)
  if (e.body) lines.push('', JSON.stringify(sampleOf(e.body.type, api), null, 2))
  return lines
}

/**
 * Documentation Markdown de l'API, pour un README ou un wiki : informations générales, ressources, puis chaque route
 * avec ses paramètres, son corps et ses réponses.
 */
import { walkTree } from '../../core/tree'
import { statusText, type ApiDocument, type ApiEndpoint } from './model'
import { buildPathTree } from './pathTree'
import { sampleOf } from './sample'

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const code = (s: string) => `\`${cell(s)}\``
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)]

const AUTH_LABEL = { bearer: 'jeton Bearer (JWT)', apiKey: 'clé d’API (en-tête `X-API-Key`)', basic: 'authentification Basic' }

function endpointSection(e: ApiEndpoint, api: ApiDocument): string[] {
  const out = [`### ${code(`${e.method} ${e.path}`)}${e.summary ? ` — ${e.summary}` : ''}`, '']
  const flags = [e.auth ? `Authentification requise${api.info.auth ? ` (${AUTH_LABEL[api.info.auth]})` : ''}` : '', e.paginated ? 'Liste paginée (`page`, `limit`, en-tête de réponse `X-Total-Count`)' : ''].filter(Boolean)
  if (flags.length) out.push(flags.join(' · '), '')

  const params = [
    ...e.params,
    ...(e.paginated
      ? [
          { name: 'page', in: 'query' as const, type: 'int', optional: true, description: 'Numéro de page (à partir de 1, défaut 1).' },
          { name: 'limit', in: 'query' as const, type: 'int', optional: true, description: 'Éléments par page (défaut 20, maximum 100).' },
        ].filter((p) => !e.params.some((x) => x.in === 'query' && x.name === p.name))
      : []),
  ]
  if (params.length) {
    out.push('**Paramètres**', '', ...table(['Nom', 'Emplacement', 'Type', 'Obligatoire', 'Description'], params.map((p) => [code(p.name), { path: 'chemin', query: 'requête', header: 'en-tête' }[p.in], code(p.type), p.in === 'path' || !p.optional ? 'oui' : 'non', cell(p.description)])), '')
  }
  if (e.body) out.push(`**Corps de la requête** (JSON) : ${code(e.body.type)}${e.body.description ? ` — ${e.body.description}` : ''}`, '', '```json', JSON.stringify(sampleOf(e.body.type, api), null, 2), '```', '')
  if (e.responses.length) out.push('**Réponses**', '', ...table(['Code', 'Type', 'Description'], e.responses.map((r) => [code(String(r.status)), r.type ? code(r.type) : '', cell(r.description ?? statusText(r.status))])), '')
  return out
}

export function apiToMarkdown(api: ApiDocument): string {
  const out = [`# ${api.info.title ?? 'API'}`, '']
  if (api.info.description) out.push(api.info.description, '')
  const facts = [api.info.version ? `**Version** : ${api.info.version}` : '', api.info.server ? `**Adresse** : ${code(api.info.server)}` : '', api.info.auth ? `**Authentification** : ${AUTH_LABEL[api.info.auth]}` : ''].filter(Boolean)
  if (facts.length) out.push(facts.join(' · '), '')

  if (api.resources.length) {
    out.push('## Ressources', '')
    for (const r of api.resources) {
      out.push(`### ${r.name}`, '')
      if (r.description) out.push(r.description, '')
      out.push(...table(['Champ', 'Type', 'Obligatoire', 'Description'], r.fields.map((f) => [code(f.name), code(f.type), f.optional ? 'non' : 'oui', cell(f.description)])), '')
    }
  }

  const routes = walkTree(buildPathTree(api.endpoints)).flatMap(({ item }) => item.endpoints)
  if (routes.length) {
    out.push('## Routes', '')
    for (const e of routes) out.push(...endpointSection(e, api))
  }
  return `${out.join('\n').trimEnd()}\n`
}

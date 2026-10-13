/**
 * Passerelle API → séquence : le diagramme d'une route de l'API décrite dans l'onglet « API REST ».
 * Le client appelle l'API, qui vérifie l'authentification si la route en exige une, interroge la base de données, puis répond ;
 * chaque réponse déclarée (succès, 404, 422…) devient une section d'un bloc `alt`.
 */
import { isSuccess, segmentsOf, isParamSegment, statusText, type ApiDocument, type ApiEndpoint } from '../api/model'
import type { BlockSection, Participant, SeqDocument, SeqItem, SeqMessage } from './model'

export interface FromApiOptions {
  /** Ajoute la base de données et les échanges avec elle. */
  database: boolean
}

/** Table concernée : le dernier segment fixe du chemin (`/users/{id}/orders` → `orders`). */
const tableOf = (path: string) => [...segmentsOf(path)].reverse().find((s) => !isParamSegment(s)) ?? 'ressource'
const isItem = (e: ApiEndpoint) => segmentsOf(e.path).at(-1)?.startsWith('{') ?? false

/** Requête SQL évoquée pour la route, sur une ligne. */
function operationOf(e: ApiEndpoint): string {
  const table = tableOf(e.path)
  switch (e.method) {
    case 'GET':
      return isItem(e) ? `SELECT … FROM ${table} WHERE id` : `SELECT … FROM ${table}${e.paginated ? ' LIMIT / OFFSET' : ''}`
    case 'POST':
      return `INSERT INTO ${table}`
    case 'PUT':
    case 'PATCH':
      return `UPDATE ${table} WHERE id`
    case 'DELETE':
      return `DELETE FROM ${table} WHERE id`
  }
}

const AUTH_TEXT = { bearer: 'Vérifier le jeton', apiKey: 'Vérifier la clé d’API', basic: 'Vérifier les identifiants' }

/** Une ligne d'un message : sans retour à la ligne, sans les séquences qui ont un sens dans la saisie texte. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

export function seqFromEndpoint(api: ApiDocument, e: ApiEndpoint, options: FromApiOptions, makeId: () => string): SeqDocument {
  const msg = (from: string, to: string, text: string, extra: Partial<SeqMessage> = {}): SeqMessage => ({ id: makeId(), kind: 'message', from, to, text, arrow: 'sync', ...extra })
  const participants: Participant[] = [
    { name: 'Client', kind: 'actor' },
    { name: 'API', ...(api.info.title ? { label: oneLine(api.info.title) } : {}), kind: 'participant' },
  ]
  if (e.auth) participants.push({ name: 'Auth', label: 'Authentification', kind: 'participant' })
  if (options.database) participants.push({ name: 'DB', label: 'Base de données', kind: 'database' })

  const items: SeqItem[] = []
  const request = [`${e.method} ${e.path}`, e.paginated ? '?page&limit' : '', e.body ? `<br>corps : ${e.body.type}` : ''].join('').replace('<br>', '\n')
  items.push(msg('Client', 'API', request, { activate: true }))

  if (e.auth) {
    items.push(msg('API', 'Auth', AUTH_TEXT[api.info.auth ?? 'bearer']), msg('Auth', 'API', 'Identité de l’appelant', { arrow: 'reply' }))
  }
  if (options.database) {
    items.push(msg('API', 'DB', operationOf(e), { activate: true }), msg('DB', 'API', e.method === 'GET' ? 'Résultat' : 'Confirmation', { arrow: 'reply', deactivate: true }))
  }

  // Réponses : le succès d'abord, puis les erreurs dans l'ordre déclaré.
  const responses = e.responses.length ? e.responses : [{ status: 200 }]
  const ordered = [...responses].sort((a, b) => Number(isSuccess(b.status)) - Number(isSuccess(a.status)))
  const reply = (r: (typeof ordered)[number], last: boolean): SeqMessage =>
    msg('API', 'Client', `${r.status} ${r.type ?? statusText(r.status)}`, { arrow: 'reply', ...(last ? { deactivate: true } : {}) })

  if (ordered.length === 1) items.push(reply(ordered[0], true))
  else {
    const sections: BlockSection[] = ordered.map((r, i) => ({
      id: makeId(),
      label: `${r.status} ${r.description ?? statusText(r.status)}`.trim(),
      items: [reply(r, i === ordered.length - 1)],
    }))
    items.push({ id: makeId(), kind: 'block', type: 'alt', sections })
  }

  const title = e.summary ? `${e.method} ${e.path} — ${oneLine(e.summary)}` : `${e.method} ${e.path}`
  return { title, autonumber: true, participants, items }
}

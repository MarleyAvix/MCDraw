import { describe, expect, it } from 'vitest'
import { parseApiText } from '../../api/text'
import { API_EXAMPLES } from '../../api/apiStore'
import { seqFromEndpoint } from '../fromApi'
import { seqToText, parseSeqText } from '../text'
import { seqToMermaid } from '../mermaid'
import { layoutSequence } from '../layout'
import type { SeqBlock, SeqDocument } from '../model'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}
const api = (text: string) => parseApiText(text, counter()).api
const gen = (text: string, route: string, database = true): SeqDocument => {
  const a = api(text)
  const e = a.endpoints.find((x) => `${x.method} ${x.path}` === route)!
  return seqFromEndpoint(a, e, { database }, counter())
}

const SHOP = `@title Boutique
@auth bearer
schema Order
  id: uuid
/orders
  GET Lister [auth] [paginated] -> 200 Order[], 401
  POST Créer [auth]
    < Order
    > 201 Order
    > 422
  /{id}
    GET Détail -> 200 Order, 404
    DELETE Retirer [auth] -> 204, 404`

describe('diagramme d’une route de l’API', () => {
  it('place le client, l’API et la base, avec le titre et l’adresse de la route', () => {
    const d = gen(SHOP, 'GET /orders/{id}')
    expect(d.title).toBe('GET /orders/{id} — Détail')
    expect(d.participants.map((p) => [p.name, p.kind, p.label])).toEqual([
      ['Client', 'actor', undefined],
      ['API', 'participant', 'Boutique'],
      ['DB', 'database', 'Base de données'],
    ])
    expect(d.autonumber).toBe(true)
  })

  it('une route protégée ajoute le participant d’authentification et la vérification du jeton', () => {
    const d = gen(SHOP, 'POST /orders')
    expect(d.participants.map((p) => p.name)).toEqual(['Client', 'API', 'Auth', 'DB'])
    expect(seqToText(d)).toContain('API ->> Auth: Vérifier le jeton')
    expect(seqToText(gen(SHOP, 'GET /orders/{id}'))).not.toContain('Auth')
  })

  it('le corps de la requête et la pagination figurent dans le premier message', () => {
    expect(seqToText(gen(SHOP, 'POST /orders'))).toContain('Client ->>+ API: POST /orders<br/>corps : Order')
    expect(seqToText(gen(SHOP, 'GET /orders'))).toContain('GET /orders?page&limit')
  })

  it('évoque l’opération en base selon la méthode', () => {
    expect(seqToText(gen(SHOP, 'GET /orders'))).toContain('SELECT … FROM orders LIMIT / OFFSET')
    expect(seqToText(gen(SHOP, 'GET /orders/{id}'))).toContain('SELECT … FROM orders WHERE id')
    expect(seqToText(gen(SHOP, 'POST /orders'))).toContain('INSERT INTO orders')
    expect(seqToText(gen(SHOP, 'DELETE /orders/{id}'))).toContain('DELETE FROM orders WHERE id')
  })

  it('chaque réponse déclarée devient une section d’un bloc alt, le succès en premier', () => {
    const d = gen(SHOP, 'POST /orders')
    const alt = d.items.at(-1) as SeqBlock
    expect(alt.type).toBe('alt')
    expect(alt.sections.map((s) => s.label)).toEqual(['201 Créé', '422 Données non valides'])
    expect(seqToText(d)).toContain('API -->>- Client: 422 Données non valides')
    expect(seqToText(d)).toContain('API -->> Client: 201 Order')
  })

  it('une seule réponse donne un simple retour, sans bloc', () => {
    const d = gen('/ping\n  GET -> 200 string', 'GET /ping')
    expect(d.items.some((i) => i.kind === 'block')).toBe(false)
    expect(seqToText(d)).toContain('API -->>- Client: 200 string')
  })

  it('sans base de données, ni participant ni échange avec elle', () => {
    const d = gen(SHOP, 'GET /orders/{id}', false)
    expect(d.participants.map((p) => p.name)).toEqual(['Client', 'API'])
    expect(seqToText(d)).not.toContain('DB')
  })

  it('les activations sont équilibrées : chaque barre ouverte est refermée', () => {
    for (const ex of API_EXAMPLES) {
      const a = api(ex.text)
      for (const e of a.endpoints) {
        const l = layoutSequence(seqFromEndpoint(a, e, { database: true }, counter()))
        expect(l.activations.every((bar) => bar.y2 < l.lifelineBottom), `${ex.label} ${e.method} ${e.path}`).toBe(true)
      }
    }
  })

  it('le texte produit se relit sans erreur et s’exporte en Mermaid, pour toutes les routes des modèles', () => {
    for (const ex of API_EXAMPLES) {
      const a = api(ex.text)
      for (const e of a.endpoints) {
        const d = seqFromEndpoint(a, e, { database: true }, counter())
        const back = parseSeqText(seqToText(d), counter())
        expect(back.errors, `${ex.label} ${e.method} ${e.path}`).toEqual([])
        expect(seqToMermaid(d)).toContain('sequenceDiagram')
      }
    }
  })
})

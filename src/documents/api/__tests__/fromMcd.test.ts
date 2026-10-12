import { describe, expect, it } from 'vitest'
import { parseMcdText } from '../../../engine/textToMcd'
import { apiFromMcd, apiTypeOf, plural } from '../fromMcd'
import { lintApi } from '../lint'
import { apiToText, parseApiText } from '../text'
import { sanitizeApi, type ApiDocument } from '../model'

const counter = () => {
  let n = 0
  return () => `i${++n}`
}

const MCD = `Client: #id_client, nom, email:VARCHAR(120)
Commande: #id_commande, date_commande:DATE, total:DECIMAL(10,2)
Produit: #id_produit, libelle, actif:BOOLEAN
Passer: Client 0,n -- Commande 1,1
Contenir (quantite:INT): Commande 1,n -- Produit 0,n
Hotel: #id_hotel, nom
Chambre: #numero, etage
Posseder: Hotel 0,n -- Chambre 1,1 CIF`

const gen = (text = MCD) => {
  const parsed = parseMcdText(text, counter())
  expect(parsed.errors).toEqual([])
  return apiFromMcd(parsed.schema, counter())
}
const routes = (api: ApiDocument) => api.endpoints.map((e) => `${e.method} ${e.path}`)
const find = (api: ApiDocument, method: string, path: string) => api.endpoints.find((e) => e.method === method && e.path === path)!

describe('petits outils', () => {
  it('met au pluriel', () => {
    expect(plural('client')).toBe('clients')
    expect(plural('adresses')).toBe('adresses')
    expect(plural('category')).toBe('categories')
    expect(plural('day')).toBe('days')
  })

  it('traduit les types de colonnes', () => {
    const col = (sqlType: string, name = 'c') => apiTypeOf({ name, sqlType })
    expect(col('INT')).toBe('int')
    expect(col('VARCHAR(255)')).toBe('string')
    expect(col('VARCHAR(255)', 'email_pro')).toBe('email')
    expect(col('DECIMAL(10,2)')).toBe('number')
    expect(col('BOOLEAN')).toBe('bool')
    expect(col('DATE')).toBe('date')
    expect(col('DATETIME')).toBe('datetime')
    expect(apiTypeOf({ name: 'x', sqlType: 'TEXT', dataType: 'INT' })).toBe('int')
  })
})

describe('génération depuis le MCD', () => {
  const { api, notes } = gen()

  it('une ressource et un schéma d’entrée par entité, champs en camelCase', () => {
    const names = api.resources.map((r) => r.name)
    for (const n of ['Client', 'ClientInput', 'Commande', 'CommandeInput', 'Produit', 'Hotel', 'Chambre', 'ChambreInput']) expect(names).toContain(n)
    const client = api.resources.find((r) => r.name === 'Client')!
    expect(client.fields.map((f) => f.name)).toEqual(['idClient', 'nom', 'email'])
    expect(client.fields[2].type).toBe('email')
    expect(api.resources.find((r) => r.name === 'ClientInput')!.fields.map((f) => f.name)).toEqual(['nom', 'email']) // l'identifiant est généré
    expect(api.resources.find((r) => r.name === 'Commande')!.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['idCommande:int', 'dateCommande:date', 'total:number', 'idClient:int'])
  })

  it('le CRUD de chaque entité, avec codes HTTP, authentification et pagination', () => {
    expect(routes(api)).toEqual(expect.arrayContaining(['GET /clients', 'POST /clients', 'GET /clients/{clientId}', 'PUT /clients/{clientId}', 'DELETE /clients/{clientId}']))
    const list = find(api, 'GET', '/clients')
    expect(list).toMatchObject({ paginated: true, responses: [{ status: 200, type: 'Client[]' }] })
    const post = find(api, 'POST', '/clients')
    expect(post).toMatchObject({ auth: true, body: { type: 'ClientInput' } })
    expect(post.responses.map((r) => r.status)).toEqual([201, 400, 401, 403])
    expect(find(api, 'DELETE', '/clients/{clientId}').responses.map((r) => r.status)).toEqual([204, 401, 403, 404])
    expect(find(api, 'GET', '/clients/{clientId}').params).toEqual([{ name: 'clientId', in: 'path', type: 'int' }])
  })

  it('liste les enfants d’une relation 1–n sous leur parent', () => {
    expect(routes(api)).toContain('GET /clients/{clientId}/commandes')
    expect(find(api, 'GET', '/clients/{clientId}/commandes').responses[0]).toEqual({ status: 200, type: 'Commande[]' })
  })

  it('une association n–n devient des routes de rattachement des deux côtés', () => {
    expect(routes(api)).toEqual(
      expect.arrayContaining([
        'GET /commandes/{commandeId}/produits',
        'GET /produits/{produitId}/commandes',
        'PUT /commandes/{commandeId}/produits/{produitId}',
        'DELETE /commandes/{commandeId}/produits/{produitId}',
      ]),
    )
    const put = find(api, 'PUT', '/commandes/{commandeId}/produits/{produitId}')
    expect(put.body).toEqual({ type: 'CommandeProduitInput' }) // la quantité voyage dans le corps
    expect(api.resources.find((r) => r.name === 'CommandeProduitInput')!.fields).toEqual([{ name: 'quantite', type: 'int', optional: true }])
    expect(find(api, 'DELETE', '/commandes/{commandeId}/produits/{produitId}').body).toBeUndefined()
  })

  it('un identifiant relatif (CIF) imbrique la ressource sous son parent', () => {
    expect(routes(api)).toEqual(expect.arrayContaining(['GET /hotels/{hotelId}/chambres', 'POST /hotels/{hotelId}/chambres', 'GET /hotels/{hotelId}/chambres/{numero}', 'DELETE /hotels/{hotelId}/chambres/{numero}']))
    expect(find(api, 'GET', '/hotels/{hotelId}/chambres').responses.map((r) => r.status)).toContain(404)
    expect(api.resources.find((r) => r.name === 'ChambreInput')!.fields.map((f) => f.name)).toEqual(['numero', 'etage']) // la clé du parent vient du chemin
    expect(routes(api)).not.toContain('GET /hotels/{hotelId}/chambres/{numero}/chambres')
  })

  it('le résultat est un document sans erreur de conception ni de validation', () => {
    expect(lintApi(api).filter((i) => i.severity === 'error')).toEqual([])
    expect(sanitizeApi(JSON.parse(JSON.stringify(api)), counter())).toEqual(api)
    // et il survit à un aller-retour par le texte
    const again = parseApiText(apiToText(api), counter())
    expect(again.errors).toEqual([])
    expect(again.api.endpoints).toHaveLength(api.endpoints.length)
    expect(notes).toEqual([])
  })

  it('une contrainte d’unicité ajoute la réponse 409', () => {
    const parsed = parseMcdText('Compte: #id_compte, login\n', counter())
    expect(find(apiFromMcd(parsed.schema, counter()).api, 'POST', '/comptes').responses.map((r) => r.status)).not.toContain(409)
    parsed.schema.entities[0].attributes[1].unique = true
    expect(find(apiFromMcd(parsed.schema, counter()).api, 'POST', '/comptes').responses.map((r) => r.status)).toContain(409)
  })

  it('ignore avec une note ce qui ne se traduit pas', () => {
    const r = gen('A: #id_a\nB: #id_b\nC: #id_c\nLier: A 0,n -- B 0,n -- C 0,n\n')
    expect(r.notes.some((n) => n.includes('n-aire'))).toBe(true)
    const refl = gen('Employe: #id_e, nom\nDiriger: Employe 0,n chef -- Employe 0,1 subordonne\n')
    expect(refl.api.endpoints.length).toBeGreaterThan(0)
  })

  it('un MCD vide donne une API vide', () => {
    const r = apiFromMcd({ entities: [], relations: [], links: [] }, counter())
    expect(r.api.endpoints).toEqual([])
    expect(r.api.resources).toEqual([])
  })
})

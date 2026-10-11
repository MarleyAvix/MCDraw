// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useApiStore } from '../apiStore'
import { apiToText, parseApiText } from '../text'

const load = (text: string) => {
  const s = useApiStore()
  s.load(parseApiText(text, () => Math.random().toString(36).slice(2, 10)).api)
  return s
}
const paths = (s: ReturnType<typeof useApiStore>) => s.endpoints.map((e) => `${e.method} ${e.path}`)

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => vi.useRealTimers())

describe('démarrage', () => {
  it('charge le premier modèle de départ', () => {
    const s = useApiStore()
    expect(s.doc.info.title).toBe('API Boutique')
    expect(s.endpoints.length).toBeGreaterThan(0)
    expect(s.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('chaque modèle est valide et sans erreur de conception', () => {
    for (const id of ['boutique', 'taches', 'auth']) {
      const s = useApiStore()
      s.loadExample(id)
      expect(s.endpoints.length).toBeGreaterThan(3)
      expect(s.issues.filter((i) => i.severity !== 'info'), id).toEqual([])
      expect(parseApiText(apiToText(s.doc), () => 'x').errors, id).toEqual([])
    }
  })
})

describe('routes', () => {
  it('une nouvelle route se range avec celles de son chemin et ouvre la fenêtre d’édition', () => {
    const s = load('/a\n  GET\n/b\n  GET')
    const e = s.addEndpoint('/a', 'POST')
    expect(paths(s)).toEqual(['GET /a', 'POST /a', 'GET /b'])
    expect(s.editingEndpointId).toBe(e.id)
    expect(s.selection).toEqual(['/a'])
  })

  it('un sous-chemin prend {id} sous une collection, « nouveau » à la racine ou sous un paramètre', () => {
    const s = load('/users\n  GET')
    expect(s.addSubPath('/users').path).toBe('/users/{id}')
    expect(s.addSubPath('/users').path).toBe('/users/nouveau')
    expect(s.addSubPath('/users/{id}').path).toBe('/users/{id}/nouveau')
    expect(s.addSubPath('/').path).toBe('/nouveau')
    expect(s.addSubPath('/').path).toBe('/nouveau-2')
  })

  it('une première route sur une API vide est à la racine', () => {
    const s = useApiStore()
    s.reset()
    expect(s.addSubPath('/').path).toBe('/nouveau')
  })

  it('supprimer un chemin retire tout son sous-arbre, supprimer la racine seulement ses routes', () => {
    const s = load('/\n  GET\n/a\n  GET\n  /{id}\n    GET\n/b\n  GET')
    s.removePaths(['/a'])
    expect(paths(s)).toEqual(['GET /', 'GET /b'])
    s.removePaths(['/'])
    expect(paths(s)).toEqual(['GET /b'])
  })

  it('supprimer une route la retire seule', () => {
    const s = load('/a\n  GET\n  POST')
    s.removeEndpoint(s.endpoints[0].id)
    expect(paths(s)).toEqual(['POST /a'])
  })

  it('remplacer une route la met à jour sur place', () => {
    const s = load('/a\n  GET Ancien')
    s.setEndpoint({ ...s.endpoints[0], summary: 'Nouveau' })
    expect(s.endpoints[0].summary).toBe('Nouveau')
    expect(s.endpoints).toHaveLength(1)
  })
})

describe('schémas', () => {
  it('un nouveau schéma a un nom libre et ouvre la fenêtre d’édition', () => {
    const s = load('schema Nouveau\n  id: int')
    const r = s.addResource()
    expect(r.name).toBe('Nouveau2')
    expect(s.editingResourceId).toBe(r.id)
  })

  it('renommer un schéma met à jour les champs, corps et réponses qui le citent', () => {
    const s = load('schema User\n  id: int\nschema Team\n  members: User[]\n/a\n  POST\n    < User\n    > 201 User\n    > 200 User[]')
    const user = s.resources.find((r) => r.name === 'User')!
    s.setResource({ ...user, name: 'Account' })
    expect(s.resources.find((r) => r.name === 'Team')!.fields[0].type).toBe('Account[]')
    expect(s.endpoints[0].body!.type).toBe('Account')
    expect(s.endpoints[0].responses.map((r) => r.type)).toEqual(['Account', 'Account[]'])
    expect(s.issues.filter((i) => i.rule === 'unknown-type')).toEqual([])
  })

  it('ne renomme pas un schéma dont le nom n’est qu’un préfixe', () => {
    const s = load('schema User\n  id: int\nschema UserInput\n  name: string\nschema Team\n  a: UserInput\n  b: User')
    s.setResource({ ...s.resources[0], name: 'Account' })
    expect(s.resources[2].fields.map((f) => f.type)).toEqual(['UserInput', 'Account'])
  })

  it('supprimer un schéma le retire de la sélection', () => {
    const s = load('schema A\n  id: int')
    s.selection = [s.resources[0].id]
    s.removeResources([s.resources[0].id])
    expect(s.resources).toEqual([])
    expect(s.selection).toEqual([])
  })
})

describe('copier / coller / dupliquer', () => {
  it('dupliquer un chemin copie son sous-arbre à côté, avec « -copie »', () => {
    const s = load('/users\n  GET Liste\n  /{id}\n    GET Détail')
    s.selection = ['/users']
    s.duplicate()
    expect(paths(s)).toEqual(['GET /users', 'GET /users/{id}', 'GET /users-copie', 'GET /users-copie/{id}'])
    expect(s.selection).toEqual(['/users-copie'])
    s.selection = ['/users']
    s.duplicate()
    expect(paths(s).filter((p) => p.endsWith('{id}'))).toHaveLength(3)
    expect(new Set(paths(s)).size).toBe(paths(s).length) // jamais de doublon
  })

  it('coller sous un autre chemin déplace le préfixe et garde les types des paramètres', () => {
    const s = load('/a\n  GET\n/b/{id:uuid}\n  GET Détail\n/c\n  GET')
    s.selection = ['/b/{id}']
    expect(s.copy()).toBe(true)
    s.selection = ['/c']
    expect(s.paste()).toBe(true)
    const pasted = s.endpoints.find((e) => e.path === '/c/{id}')!
    expect(pasted.summary).toBe('Détail')
    expect(pasted.params).toEqual([{ name: 'id', in: 'path', type: 'uuid' }])
    expect(s.endpoints.map((e) => e.id).length).toBe(new Set(s.endpoints.map((e) => e.id)).size)
  })

  it('coller sans sélection se range à la racine ; la racine ne se copie pas', () => {
    const s = load('/\n  GET\n/a\n  GET')
    s.selection = ['/']
    expect(s.copy()).toBe(false)
    s.selection = ['/a']
    s.copy()
    s.selection = []
    s.paste()
    expect(paths(s)).toContain('GET /a-copie')
  })

  it('dupliquer un schéma crée « …Copie » sans toucher à l’original', () => {
    const s = load('schema A\n  id: int')
    s.view = 'schemas'
    s.selection = [s.resources[0].id]
    s.duplicate()
    expect(s.resources.map((r) => r.name)).toEqual(['A', 'ACopie'])
    expect(s.resources[1].id).not.toBe(s.resources[0].id)
  })

  it('tout sélectionner dépend de la vue', () => {
    const s = load('schema A\n  id: int\n/a\n  GET')
    s.selectAll()
    expect(s.selection).toEqual(['/', '/a'])
    s.view = 'schemas'
    s.selectAll()
    expect(s.selection).toEqual([s.resources[0].id])
  })
})

describe('chargement', () => {
  it('importe un fichier, refuse le reste, et nettoie la sélection devenue sans objet', () => {
    const s = load('/a\n  GET\n/b\n  GET')
    s.selection = ['/a', '/b']
    s.importSchema({ endpoints: [{ method: 'GET', path: '/a' }] })
    expect(s.selection).toEqual(['/a'])
    expect(() => s.importSchema('x')).toThrow()
  })

  it('annuler / rétablir restaure l’API', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const s = load('/a\n  GET')
    await nextTick()
    vi.setSystemTime(Date.now() + 5000) // au-delà du regroupement des modifications rapprochées
    s.addEndpoint('/a', 'POST')
    await nextTick()
    expect(s.canUndo).toBe(true)
    s.undo()
    expect(paths(s)).toEqual(['GET /a'])
    s.redo()
    expect(paths(s)).toEqual(['GET /a', 'POST /a'])
  })
})

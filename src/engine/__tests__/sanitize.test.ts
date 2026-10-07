import { describe, expect, it } from 'vitest'
import { sanitizeSchema } from '../sanitize'

const ids = () => {
  let n = 0
  return () => `new${++n}`
}

describe('sanitizeSchema', () => {
  it('refuse une structure inutilisable', () => {
    expect(() => sanitizeSchema(null, ids())).toThrow(/Fichier invalide/)
    expect(() => sanitizeSchema({ entities: [] }, ids())).toThrow(/Fichier invalide/)
    expect(() => sanitizeSchema([], ids())).toThrow(/Fichier invalide/)
  })

  it('complète les champs manquants et remplace les valeurs inconnues', () => {
    const s = sanitizeSchema(
      {
        entities: [{ id: 'e1', name: 'Client', x: '12', attributes: [{ name: 'nom', type: 'STRING', size: 30 }, 'bruit'] }],
        relations: [{ id: 'r1', name: 'Passer' }],
        links: [{ id: 'l1', relationId: 'r1', entityId: 'e1', cardinality: '2,n', onDelete: 'DROP', entityHandle: 'x' }],
      },
      ids(),
    )
    expect(s.entities[0]).toEqual({
      id: 'e1',
      name: 'Client',
      x: 12,
      y: 0,
      attributes: [{ id: 'new1', name: 'nom', type: 'VARCHAR', isPrimaryKey: false, size: '30' }],
    })
    expect(s.relations[0]).toEqual({ id: 'r1', name: 'Passer', attributes: [], x: 0, y: 0 })
    expect(s.links[0]).toEqual({ id: 'l1', relationId: 'r1', entityId: 'e1', cardinality: '0,n' })
  })

  it('retire les pattes et les liens « est un » cassés', () => {
    const s = sanitizeSchema(
      {
        entities: [{ id: 'e1', parentId: 'fantome' }, { id: 'e2', parentId: 'e1' }, { id: 'e3', parentId: 'e3' }],
        relations: [{ id: 'r1' }],
        links: [
          { id: 'ok', relationId: 'r1', entityId: 'e1' },
          { id: 'sans_entite', relationId: 'r1', entityId: 'fantome' },
          { id: 'inverse', relationId: 'e1', entityId: 'r1' },
        ],
      },
      ids(),
    )
    expect(s.entities.map((e) => e.parentId)).toEqual([undefined, 'e1', undefined])
    expect(s.links.map((l) => l.id)).toEqual(['ok'])
  })

  it('régénère les identifiants manquants ou en double', () => {
    const s = sanitizeSchema(
      {
        entities: [{ id: 'x', name: 'A' }, { id: 'x', name: 'B' }, { name: 'C' }],
        relations: [],
        links: [],
      },
      ids(),
    )
    expect(new Set(s.entities.map((e) => e.id)).size).toBe(3)
    expect(s.entities[0].id).toBe('x')
  })

  it("ne garde l'identifiant relatif (CIF) que sur une patte 1,1", () => {
    const s = sanitizeSchema(
      {
        entities: [{ id: 'e1' }],
        relations: [{ id: 'r1' }],
        links: [
          { id: 'a', relationId: 'r1', entityId: 'e1', cardinality: '0,n', identifying: true },
          { id: 'b', relationId: 'r1', entityId: 'e1', cardinality: '1,1', identifying: true },
        ],
      },
      ids(),
    )
    expect(s.links.map((l) => !!l.identifying)).toEqual([false, true])
  })
})

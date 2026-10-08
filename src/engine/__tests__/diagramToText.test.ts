import { describe, expect, it } from 'vitest'
import { diagramToText } from '../diagramToText'
import type { Cardinality, Entity, Link, MeriseSchema, Relation } from '../../types/schema'

const entity = (name: string, extra: Partial<Entity> = {}): Entity => ({
  id: name,
  name,
  attributes: [
    { id: `${name}.id`, name: 'id', type: 'INT', isPrimaryKey: true },
    { id: `${name}.nom`, name: 'nom', type: 'VARCHAR', size: '255', isPrimaryKey: false },
  ],
  x: 0,
  y: 0,
  ...extra,
})
const relation = (name: string, withAttr = false): Relation => ({
  id: name,
  name,
  attributes: withAttr ? [{ id: `${name}.q`, name: 'quantité', type: 'INT', isPrimaryKey: false }] : [],
  x: 0,
  y: 0,
})
const link = (rel: string, ent: string, cardinality: Cardinality): Link => ({
  id: `${rel}-${ent}`,
  relationId: rel,
  entityId: ent,
  cardinality,
})

// Un client passe de 1 à n commandes ; une commande appartient à exactement un client.
const schema: MeriseSchema = {
  entities: [entity('Client'), entity('Commande')],
  relations: [relation('passe')],
  links: [link('passe', 'Client', '0,n'), link('passe', 'Commande', '1,1')],
}

describe('diagramToText', () => {
  it('Mermaid ERD : entités, clés et pattes de corbeau', () => {
    const t = diagramToText(schema, { language: 'mermaid', notation: 'erd' })
    expect(t.startsWith('erDiagram')).toBe(true)
    expect(t).toContain('INT id PK')
    expect(t).toContain('VARCHAR(255) nom')
    expect(t).toContain('Client ||--o{ Commande : "passe"')
  })

  it('Mermaid UML : multiplicités aux extrémités', () => {
    const t = diagramToText(schema, { language: 'mermaid', notation: 'uml' })
    expect(t).toContain('classDiagram')
    expect(t).toContain('Client "1" -- "0..*" Commande : passe')
    expect(t).toContain('+VARCHAR nom')
  })

  it('PlantUML ERD : clé primaire séparée des autres colonnes', () => {
    const t = diagramToText(schema, { language: 'plantuml', notation: 'erd' })
    expect(t).toContain('@startuml')
    expect(t).toContain('* id : INT <<PK>>')
    expect(t).toContain('--\n  nom : VARCHAR(255)')
    expect(t).toContain('Client ||--o{ Commande : passe')
    expect(t.endsWith('@enduml')).toBe(true)
  })

  it('PlantUML UML : classe d’association accrochée aux deux classes', () => {
    const s: MeriseSchema = {
      entities: [entity('Client'), entity('Produit')],
      relations: [relation('achète', true)],
      links: [link('achète', 'Client', '0,n'), link('achète', 'Produit', '0,n')],
    }
    const t = diagramToText(s, { language: 'plantuml', notation: 'uml' })
    expect(t).toContain('class "achète" as achete')
    expect(t).toContain('(Client, Produit) .. achete')
  })

  it('noms avec accents ou espaces : identifiants sûrs, libellé conservé en PlantUML', () => {
    const s: MeriseSchema = { entities: [entity('Élève scolaire')], relations: [], links: [] }
    expect(diagramToText(s, { language: 'mermaid', notation: 'erd' })).toContain('Eleve_scolaire {')
    expect(diagramToText(s, { language: 'plantuml', notation: 'erd' })).toContain('entity "Élève scolaire" as Eleve_scolaire {')
  })

  it('héritage : flèche de la fille vers la mère', () => {
    const s: MeriseSchema = { entities: [entity('Personne'), entity('Eleve', { parentId: 'Personne' })], relations: [], links: [] }
    expect(diagramToText(s, { language: 'mermaid', notation: 'uml' })).toContain('Personne <|-- Eleve')
  })

  it('bloc Markdown pour un README', () => {
    const t = diagramToText(schema, { language: 'mermaid', notation: 'erd', fence: true })
    expect(t.startsWith('```mermaid\nerDiagram')).toBe(true)
    expect(t.endsWith('\n```')).toBe(true)
  })

  it('schéma vide : ne plante pas', () => {
    const empty: MeriseSchema = { entities: [], relations: [], links: [] }
    expect(diagramToText(empty, { language: 'mermaid', notation: 'erd' })).toBe('erDiagram')
  })
})

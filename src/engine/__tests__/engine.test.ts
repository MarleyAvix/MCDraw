import { describe, expect, it } from 'vitest'
import { meriseToMld, slug } from '../meriseToMld'
import { mldToSql } from '../mldToSql'
import { mldToEfCore } from '../mldToEfCore'
import type { Attribute, Cardinality, Entity, Link, MeriseSchema, Relation } from '../../types/schema'

const attr = (name: string, pk = false, type: Attribute['type'] = 'INT'): Attribute => ({
  id: name,
  name,
  type,
  isPrimaryKey: pk,
})
const entity = (name: string, attrs: Attribute[] = [attr(`id_${name}`, true)]): Entity => ({
  id: name,
  name,
  attributes: attrs,
  x: 0,
  y: 0,
})
const relation = (name: string, attrs: Attribute[] = []): Relation => ({ id: name, name, attributes: attrs, x: 0, y: 0 })
const link = (rel: string, ent: string, cardinality: Cardinality, role?: string): Link => ({
  id: `${rel}-${ent}-${cardinality}-${role ?? ''}`,
  relationId: rel,
  entityId: ent,
  cardinality,
  role,
})

const build = (s: Partial<MeriseSchema>) => meriseToMld({ entities: [], relations: [], links: [], ...s })
const table = (r: ReturnType<typeof build>, name: string) => r.tables.find((t) => t.name === name)!
const col = (t: ReturnType<typeof table>, name: string) => t.columns.find((c) => c.name === name)!

describe('slug', () => {
  it('retire accents, espaces et caractères spéciaux', () => {
    expect(slug('Éléve & Classe')).toBe('eleve_classe')
    expect(slug('  ')).toBe('sans_nom')
    expect(slug('3D')).toBe('_3d')
  })
})

describe('entités', () => {
  it('produit une table avec sa clé primaire et des colonnes nullables', () => {
    const r = build({ entities: [entity('Client', [attr('id', true), attr('nom', false, 'VARCHAR')])] })
    const t = table(r, 'client')
    expect(t.primaryKey).toEqual(['id'])
    expect(col(t, 'id').nullable).toBe(false)
    expect(col(t, 'nom')).toMatchObject({ nullable: true, sqlType: 'VARCHAR(255)' })
    expect(r.warnings).toEqual([])
  })

  it("avertit quand l'entité n'a pas de clé primaire", () => {
    const r = build({ entities: [entity('Client', [attr('nom')])] })
    expect(r.warnings).toHaveLength(1)
  })

  it('dédoublonne les noms de tables et de colonnes', () => {
    const r = build({ entities: [entity('A', [attr('x', true), attr('x')]), entity('a')] })
    expect(r.tables.map((t) => t.name)).toEqual(['a', 'a_2'])
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(['x', 'x_2'])
  })
})

describe('associations binaires avec patte de cardinalité max 1', () => {
  const base = {
    entities: [entity('client'), entity('commande')],
    relations: [relation('passer', [attr('date_passage', false, 'DATE')])],
  }

  it('0,n – 1,1 : la clé migre côté 1,1, NOT NULL, avec les propriétés', () => {
    const r = build({ ...base, links: [link('passer', 'client', '0,n'), link('passer', 'commande', '1,1')] })
    expect(r.tables).toHaveLength(2)
    const t = table(r, 'commande')
    expect(col(t, 'id_client')).toMatchObject({ isForeignKey: true, nullable: false })
    expect(t.foreignKeys).toEqual([{ columns: ['id_client'], refTable: 'client', refColumns: ['id_client'] }])
    expect(t.columns.map((c) => c.name)).toContain('date_passage')
  })

  it('0,n – 0,1 : la clé migre côté 0,1 et est nullable', () => {
    const r = build({ ...base, links: [link('passer', 'client', '0,n'), link('passer', 'commande', '0,1')] })
    expect(col(table(r, 'commande'), 'id_client').nullable).toBe(true)
  })

  it('1,1 – 0,1 : la clé migre côté 1,1', () => {
    const r = build({ ...base, links: [link('passer', 'client', '0,1'), link('passer', 'commande', '1,1')] })
    expect(table(r, 'commande').foreignKeys).toHaveLength(1)
    expect(table(r, 'client').foreignKeys).toHaveLength(0)
  })
})

describe('associations n–n', () => {
  it('crée une table dédiée à clé primaire composée', () => {
    const r = build({
      entities: [entity('commande'), entity('produit')],
      relations: [relation('contenir', [attr('quantite')])],
      links: [link('contenir', 'commande', '1,n'), link('contenir', 'produit', '0,n')],
    })
    const t = table(r, 'contenir')
    expect(t.origin).toBe('association')
    expect(t.primaryKey).toEqual(['id_commande', 'id_produit'])
    expect(t.foreignKeys).toHaveLength(2)
    expect(col(t, 'quantite').isPrimaryKey).toBe(false)
  })
})

describe('associations n-aires', () => {
  const s = (c3: Cardinality) => ({
    entities: [entity('a'), entity('b'), entity('c')],
    relations: [relation('r')],
    links: [link('r', 'a', '0,n'), link('r', 'b', '0,n'), link('r', 'c', c3)],
  })

  it('toutes pattes n : toutes les clés étrangères sont dans la clé primaire', () => {
    expect(table(build(s('0,n')), 'r').primaryKey).toEqual(['id_a', 'id_b', 'id_c'])
  })

  it('une patte max 1 est exclue de la clé primaire mais reste clé étrangère', () => {
    const t = table(build(s('1,1')), 'r')
    expect(t.primaryKey).toEqual(['id_a', 'id_b'])
    expect(t.foreignKeys).toHaveLength(3)
  })
})

describe('associations réflexives', () => {
  it('préfixe la clé étrangère avec le rôle', () => {
    const r = build({
      entities: [entity('employe')],
      relations: [relation('diriger')],
      links: [link('diriger', 'employe', '0,n', 'chef'), link('diriger', 'employe', '0,1', 'sub')],
    })
    const t = table(r, 'employe')
    expect(t.foreignKeys).toEqual([{ columns: ['chef_id_employe'], refTable: 'employe', refColumns: ['id_employe'] }])
    expect(col(t, 'chef_id_employe').nullable).toBe(true)
  })

  it('n–n réflexive : colonnes distinctes grâce aux rôles', () => {
    const r = build({
      entities: [entity('personne')],
      relations: [relation('connaitre')],
      links: [link('connaitre', 'personne', '0,n', 'a'), link('connaitre', 'personne', '0,n', 'b')],
    })
    expect(table(r, 'connaitre').columns.map((c) => c.name)).toEqual(['a_id_personne', 'b_id_personne'])
  })
})

describe('cas dégradés', () => {
  it('ignore une association à une seule patte avec un avertissement', () => {
    const r = build({
      entities: [entity('a')],
      relations: [relation('r')],
      links: [link('r', 'a', '0,n')],
    })
    expect(r.tables).toHaveLength(1)
    expect(r.warnings).toHaveLength(1)
  })

  it("ignore l'association si une entité reliée n'a pas de clé primaire", () => {
    const r = build({
      entities: [entity('a'), entity('b', [attr('nom')])],
      relations: [relation('r')],
      links: [link('r', 'a', '0,n'), link('r', 'b', '1,1')],
    })
    expect(r.tables.every((t) => t.foreignKeys.length === 0)).toBe(true)
    expect(r.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('ignore les pattes vers des entités supprimées', () => {
    const r = build({
      entities: [entity('a')],
      relations: [relation('r')],
      links: [link('r', 'a', '0,n'), link('r', 'fantome', '0,n')],
    })
    expect(r.warnings).toHaveLength(1)
  })
})

describe('mldToSql', () => {
  const schema = {
    entities: [entity('client'), entity('commande')],
    relations: [relation('passer')],
    links: [link('passer', 'client', '0,n'), link('passer', 'commande', '1,1')],
  }

  it('crée les tables référencées avant les autres', () => {
    // commande est déclarée avant client dans le schéma
    const sql = mldToSql(build({ ...schema, entities: [schema.entities[1], schema.entities[0]] }))
    expect(sql.indexOf('CREATE TABLE client')).toBeLessThan(sql.indexOf('CREATE TABLE commande'))
    expect(sql).toContain('PRIMARY KEY (id_commande)')
    expect(sql).toContain('FOREIGN KEY (id_client) REFERENCES client (id_client)')
  })

  it('traite les cycles de dépendances avec ALTER TABLE', () => {
    const r = build({
      entities: [entity('a'), entity('b')],
      relations: [relation('r1'), relation('r2')],
      links: [link('r1', 'a', '1,1'), link('r1', 'b', '0,n'), link('r2', 'b', '1,1'), link('r2', 'a', '0,n')],
    })
    const sql = mldToSql(r)
    expect(sql).toContain('ALTER TABLE')
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(2)
  })

  it("applique l'auto-incrément selon le dialecte, sans l'appliquer aux clés étrangères", () => {
    const r = build(schema)
    expect(mldToSql(r, { dialect: 'mysql', autoIncrement: true })).toContain('id_client INT NOT NULL AUTO_INCREMENT')
    expect(mldToSql(r, { dialect: 'postgresql', autoIncrement: true })).toContain('id_client SERIAL')
    expect(mldToSql(r, { dialect: 'sqlserver', autoIncrement: true })).toContain('IDENTITY(1,1)')
    const sqlite = mldToSql(r, { dialect: 'sqlite', autoIncrement: true })
    expect(sqlite).toContain('id_client INTEGER PRIMARY KEY AUTOINCREMENT')
    // la clé étrangère id_client de commande reste un INT simple
    const mysql = mldToSql(r, { dialect: 'mysql', autoIncrement: true })
    expect(mysql.match(/AUTO_INCREMENT/g)).toHaveLength(2)
    expect(mysql).toMatch(/id_client INT NOT NULL,/)
  })

  it('indique quand il n’y a aucune table', () => {
    expect(mldToSql(build({}))).toContain('Aucune table')
  })
})

describe('mldToEfCore', () => {
  const r = build({
    entities: [entity('client', [attr('id_client', true), attr('nom', false, 'VARCHAR')]), entity('commande'), entity('produit')],
    relations: [relation('passer'), relation('contenir', [attr('quantite')])],
    links: [
      link('passer', 'client', '0,n'),
      link('passer', 'commande', '1,1'),
      link('contenir', 'commande', '1,n'),
      link('contenir', 'produit', '0,n'),
    ],
  })
  const cs = mldToEfCore(r, { namespace: 'Demo', contextName: 'ShopContext' })

  it('génère classes, propriétés typées et DbSet', () => {
    expect(cs).toContain('namespace Demo;')
    expect(cs).toContain('public class Client')
    expect(cs).toContain('public string? Nom { get; set; }')
    expect(cs).toContain('public int IdClient { get; set; }')
    expect(cs).toContain('public class ShopContext : DbContext')
    expect(cs).toContain('public DbSet<Commande> Commandes { get; set; } = null!;')
  })

  it('génère navigations, collections inverses et clés', () => {
    expect(cs).toContain('public Client Client { get; set; } = null!;')
    expect(cs).toContain('public ICollection<Commande> Commandes { get; set; }')
    expect(cs).toContain('e.HasOne(x => x.Client).WithMany(y => y.Commandes).HasForeignKey(x => x.IdClient)')
    expect(cs).toContain('e.HasKey(x => new { x.IdCommande, x.IdProduit });')
    expect(cs).toContain('.HasColumnName("id_client")')
  })

  it('gère une auto-référence sans collision de noms', () => {
    const refl = build({
      entities: [entity('employe')],
      relations: [relation('diriger')],
      links: [link('diriger', 'employe', '0,n', 'chef'), link('diriger', 'employe', '0,1', 'sub')],
    })
    const out = mldToEfCore(refl)
    expect(out).toContain('public Employe? Chef { get; set; }')
    expect(out).toContain('ICollection<Employe> Employes')
  })
})

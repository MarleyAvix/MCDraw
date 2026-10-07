import { describe, expect, it } from 'vitest'
import { meriseToMld, normalizeSize, slug, sqlTypeOf } from '../meriseToMld'
import { mldToSql, quoteIdent } from '../mldToSql'
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
    expect(t.foreignKeys).toMatchObject([{ columns: ['id_client'], refTable: 'client', refColumns: ['id_client'] }])
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
    const t = table(r, 'commande_produit') // contraction des tables, pas le verbe « contenir »
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
    expect(table(build(s('0,n')), 'a_b_c').primaryKey).toEqual(['id_a', 'id_b', 'id_c'])
  })

  it('une patte max 1 est exclue de la clé primaire mais reste clé étrangère', () => {
    const t = table(build(s('1,1')), 'a_b_c')
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
    expect(t.foreignKeys).toMatchObject([{ columns: ['chef_id_employe'], refTable: 'employe', refColumns: ['id_employe'] }])
    expect(col(t, 'chef_id_employe').nullable).toBe(true)
  })

  it('n–n réflexive : colonnes distinctes grâce aux rôles', () => {
    const r = build({
      entities: [entity('personne')],
      relations: [relation('connaitre')],
      links: [link('connaitre', 'personne', '0,n', 'a'), link('connaitre', 'personne', '0,n', 'b')],
    })
    expect(table(r, 'personne_personne').columns.map((c) => c.name)).toEqual(['a_id_personne', 'b_id_personne'])
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

describe('entités faibles (identifiant relatif, CIF)', () => {
  const cif = (c: Link): Link => ({ ...c, identifying: true })
  const base = {
    entities: [entity('commande'), entity('ligne', [attr('no_ligne', true), attr('quantite')])],
    relations: [relation('contenir')],
  }

  it("la clé du parent entre dans la clé primaire de l'entité faible", () => {
    const r = build({ ...base, links: [link('contenir', 'commande', '0,n'), cif(link('contenir', 'ligne', '1,1'))] })
    const t = table(r, 'ligne')
    expect(t.primaryKey).toEqual(['id_commande', 'no_ligne'])
    expect(col(t, 'id_commande')).toMatchObject({ isPrimaryKey: true, isForeignKey: true, nullable: false })
    expect(t.foreignKeys).toMatchObject([{ columns: ['id_commande'], refTable: 'commande', refColumns: ['id_commande'] }])
    expect(r.warnings).toEqual([])
  })

  it('une entité faible sans identifiant propre est identifiée uniquement par le parent', () => {
    const r = build({
      entities: [entity('commande'), entity('detail', [attr('quantite')])],
      relations: [relation('contenir')],
      links: [link('contenir', 'commande', '0,n'), cif(link('contenir', 'detail', '1,1'))],
    })
    expect(table(r, 'detail').primaryKey).toEqual(['id_commande'])
    expect(r.warnings).toEqual([])
  })

  it('propage la clé en chaîne (A ← B ← C), quel que soit l\'ordre des associations', () => {
    const r = build({
      entities: [entity('a'), entity('b', [attr('no_b', true)]), entity('c', [attr('no_c', true)])],
      relations: [relation('r2'), relation('r1')],
      links: [
        link('r2', 'b', '0,n'),
        cif(link('r2', 'c', '1,1')),
        link('r1', 'a', '0,n'),
        cif(link('r1', 'b', '1,1')),
      ],
    })
    expect(table(r, 'b').primaryKey).toEqual(['id_a', 'no_b'])
    expect(table(r, 'c').primaryKey).toEqual(['id_a', 'no_b', 'no_c'])
    expect(table(r, 'c').foreignKeys[0].columns).toEqual(['id_a', 'no_b'])
  })

  it('ignore le CIF si la cardinalité n’est pas 1,1', () => {
    const r = build({ ...base, links: [link('contenir', 'commande', '0,n'), cif(link('contenir', 'ligne', '0,1'))] })
    expect(table(r, 'ligne').primaryKey).toEqual(['no_ligne'])
  })

  it('génère une clé primaire composée dans le SQL', () => {
    const r = build({ ...base, links: [link('contenir', 'commande', '0,n'), cif(link('contenir', 'ligne', '1,1'))] })
    expect(mldToSql(r)).toContain('PRIMARY KEY (id_commande, no_ligne)')
  })
})

describe('nom personnalisé des tables d’association', () => {
  const s = (tableName?: string) => ({
    entities: [entity('commande'), entity('produit')],
    relations: [{ ...relation('contenir'), tableName }],
    links: [link('contenir', 'commande', '1,n'), link('contenir', 'produit', '0,n')],
  })

  it('utilise le nom saisi (converti en identifiant SQL)', () => {
    const r = build(s('Ligne de commande'))
    expect(r.tables.map((t) => t.name)).toEqual(['commande', 'produit', 'ligne_de_commande'])
    expect(mldToSql(r)).toContain('CREATE TABLE ligne_de_commande')
  })

  it('retombe sur la contraction des tables si le nom est vide', () => {
    expect(table(build(s('  ')), 'commande_produit')).toBeTruthy()
  })
})

describe('héritage (est un)', () => {
  const hierarchy = (inheritance?: Entity['inheritance']) => {
    const v: Entity = { ...entity('Vehicule', [attr('id_v', true), attr('marque', false, 'VARCHAR')]), inheritance }
    const car: Entity = { ...entity('Voiture', [attr('nb_portes')]), parentId: 'Vehicule' }
    const truck: Entity = { ...entity('Camion', [attr('charge')]), parentId: 'Vehicule' }
    return [v, car, truck]
  }

  it('une table par classe : la clé de la fille est aussi une clé étrangère vers la mère', () => {
    const r = build({ entities: hierarchy('class') })
    expect(r.tables.map((t) => t.name)).toEqual(['vehicule', 'voiture', 'camion'])
    const car = table(r, 'voiture')
    expect(car.primaryKey).toEqual(['id_v'])
    expect(car.foreignKeys).toMatchObject([{ columns: ['id_v'], refTable: 'vehicule', refColumns: ['id_v'], onDelete: 'CASCADE' }])
    expect(car.columns.map((c) => c.name)).toEqual(['nb_portes', 'id_v'])
    expect(r.warnings).toEqual([])
  })

  it('une seule table : filles absorbées, colonnes nullables et discriminant', () => {
    const r = build({
      entities: [...hierarchy('single'), entity('Garage')],
      relations: [relation('Garer')],
      links: [link('Garer', 'Garage', '0,n'), link('Garer', 'Voiture', '1,1')],
    })
    expect(r.tables.map((t) => t.name)).toEqual(['vehicule', 'garage'])
    const v = table(r, 'vehicule')
    expect(v.columns.map((c) => c.name)).toEqual(['id_v', 'marque', 'type_vehicule', 'nb_portes', 'charge', 'id_garage'])
    expect(col(v, 'nb_portes').nullable).toBe(true)
    // la patte 1,1 sur une sous-classe est relâchée : la clé étrangère devient facultative
    expect(col(v, 'id_garage').nullable).toBe(true)
    expect(v.foreignKeys).toMatchObject([{ columns: ['id_garage'], refTable: 'garage', refColumns: ['id_garage'] }])
  })

  it('une table par classe fille : la mère disparaît et les filles recopient ses attributs', () => {
    const r = build({ entities: hierarchy('concrete') })
    expect(r.tables.map((t) => t.name)).toEqual(['voiture', 'camion'])
    expect(r.tables[0].columns.map((c) => c.name)).toEqual(['id_v', 'marque', 'nb_portes'])
    expect(r.tables[0].primaryKey).toEqual(['id_v'])
    expect(r.tables[1].columns.map((c) => c.name)).toEqual(['id_v', 'marque', 'charge'])
  })

  it('concret : une association de la mère est dupliquée pour chaque fille', () => {
    const r = build({
      entities: [...hierarchy('concrete'), entity('Garage')],
      relations: [relation('Garer')],
      links: [link('Garer', 'Garage', '0,n'), link('Garer', 'Vehicule', '0,n')],
    })
    expect(r.tables.map((t) => t.name).sort()).toEqual(['camion', 'garage', 'garage_camion', 'garage_voiture', 'voiture'])
    expect(table(r, 'garage_camion').primaryKey).toEqual(['id_garage', 'id_v'])
    expect(table(r, 'garage_voiture').foreignKeys.map((f) => f.refTable).sort()).toEqual(['garage', 'voiture'])
  })

  it('concret : une patte 1,1 sur la mère reste 1,1 sur chaque fille', () => {
    const r = build({
      entities: [...hierarchy('concrete'), entity('Garage')],
      relations: [relation('Garer')],
      links: [link('Garer', 'Garage', '0,n'), link('Garer', 'Vehicule', '1,1')],
    })
    expect(col(table(r, 'voiture'), 'id_garage').nullable).toBe(false)
    expect(col(table(r, 'camion'), 'id_garage').nullable).toBe(false)
  })

  it('hiérarchie à plusieurs niveaux (une table par classe, une seule table)', () => {
    const base = [
      { ...entity('A', [attr('id_a', true)]), inheritance: 'class' as const },
      { ...entity('B', [attr('b')]), parentId: 'A' },
      { ...entity('C', [attr('c')]), parentId: 'B' },
    ]
    const r = build({ entities: base })
    expect(table(r, 'c').primaryKey).toEqual(['id_a'])
    expect(table(r, 'c').foreignKeys[0].refTable).toBe('b')
    const one = build({ entities: base.map((e) => (e.id === 'A' ? { ...e, inheritance: 'single' as const } : e)) })
    expect(one.tables.map((t) => t.name)).toEqual(['a'])
    expect(one.tables[0].columns.map((c) => c.name)).toEqual(['id_a', 'type_a', 'b', 'c'])
  })

  it('ignore une dépendance circulaire sans planter', () => {
    const r = build({ entities: [{ ...entity('A'), parentId: 'B' }, { ...entity('B'), parentId: 'A' }] })
    expect(r.tables).toHaveLength(2)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("le nom d'une table de jointure dupliquée reste renommable via l'association d'origine", () => {
    const r = build({
      entities: [...hierarchy('concrete'), entity('Garage')],
      relations: [relation('Garer')],
      links: [link('Garer', 'Garage', '0,n'), link('Garer', 'Vehicule', '0,n')],
    })
    expect(r.tables.filter((t) => t.origin === 'association').every((t) => t.sourceId === 'Garer')).toBe(true)
  })
})

describe('contraintes de colonne', () => {
  const client = entity('Client', [
    attr('id', true),
    { ...attr('email', false, 'VARCHAR'), unique: true, notNull: true },
    { ...attr('statut', false, 'VARCHAR'), defaultValue: "it's" },
    { ...attr('age'), check: 'age >= 0', defaultValue: '18' },
    { ...attr('actif', false, 'BOOLEAN'), defaultValue: 'true' },
    { ...attr('cree_le', false, 'DATETIME'), defaultValue: 'current_timestamp' },
  ])
  const mld = () => build({ entities: [client] })

  it('propage NOT NULL, UNIQUE, DEFAULT et CHECK vers les colonnes du MLD', () => {
    const t = table(mld(), 'client')
    expect(col(t, 'email')).toMatchObject({ nullable: false, unique: true })
    expect(col(t, 'age')).toMatchObject({ nullable: true, check: 'age >= 0', defaultValue: '18' })
  })

  it('génère les contraintes en SQL (MySQL)', () => {
    const sql = mldToSql(mld(), { dialect: 'mysql' })
    expect(sql).toContain('email VARCHAR(255) NOT NULL UNIQUE')
    expect(sql).toContain("statut VARCHAR(255) DEFAULT 'it''s'")
    expect(sql).toContain('age INT DEFAULT 18 CHECK (age >= 0)')
    expect(sql).toContain('actif BOOLEAN DEFAULT TRUE')
    expect(sql).toContain('cree_le DATETIME DEFAULT CURRENT_TIMESTAMP')
  })

  it('adapte les booléens au dialecte', () => {
    expect(mldToSql(mld(), { dialect: 'sqlserver' })).toContain('actif BIT DEFAULT 1')
    expect(mldToSql(mld(), { dialect: 'sqlite' })).toContain('actif INTEGER DEFAULT 1')
  })

  it("n'ajoute pas UNIQUE à une clé primaire simple", () => {
    const r = build({ entities: [entity('A', [{ ...attr('id', true), unique: true }])] })
    expect(mldToSql(r)).not.toContain('UNIQUE')
  })

  it('les sous-classes absorbées par une table unique restent facultatives', () => {
    const r = build({
      entities: [
        { ...entity('V'), inheritance: 'single' },
        { ...entity('C', [{ ...attr('portes'), notNull: true }]), parentId: 'V' },
      ],
    })
    expect(col(table(r, 'v'), 'portes').nullable).toBe(true)
  })

  it('génère unique, valeur par défaut et check en EF Core', () => {
    const cs = mldToEfCore(mld())
    expect(cs).toContain('e.Property(x => x.Email).HasColumnName("email").IsRequired().HasMaxLength(255);')
    expect(cs).toContain('e.HasIndex(x => x.Email).IsUnique();')
    expect(cs).toContain('.HasDefaultValueSql("18")')
    expect(cs).toContain('HasCheckConstraint("ck_client_age", "age >= 0")')
  })
})

describe('actions référentielles', () => {
  const shop = (onDelete?: Link['onDelete'], onUpdate?: Link['onUpdate']) =>
    build({
      entities: [entity('Client'), entity('Commande')],
      relations: [relation('Passer')],
      links: [{ ...link('Passer', 'Client', '0,n'), onDelete, onUpdate }, link('Passer', 'Commande', '1,1')],
    })

  it("lit l'action sur la patte de l'entité référencée", () => {
    const fk = table(shop('CASCADE', 'RESTRICT'), 'commande').foreignKeys[0]
    expect(fk).toMatchObject({ refTable: 'client', onDelete: 'CASCADE', onUpdate: 'RESTRICT' })
    expect(fk.linkId).toBe('Passer-Client-0,n-')
  })

  it('génère ON DELETE / ON UPDATE en SQL, sans clause par défaut', () => {
    expect(mldToSql(shop('CASCADE', 'SET NULL'))).toContain('REFERENCES client (id_client) ON DELETE CASCADE ON UPDATE SET NULL')
    expect(mldToSql(shop())).not.toContain('ON DELETE')
  })

  it('SQL Server remplace RESTRICT par NO ACTION', () => {
    expect(mldToSql(shop('RESTRICT'), { dialect: 'sqlserver' })).toContain('ON DELETE NO ACTION')
  })

  it('avertit pour SET NULL sur une clé obligatoire', () => {
    expect(shop('SET NULL').warnings.some((w) => w.includes('SET NULL'))).toBe(true)
  })

  it('passe le comportement de suppression à EF Core', () => {
    expect(mldToEfCore(shop('CASCADE'))).toContain('DeleteBehavior.Cascade')
    expect(mldToEfCore(shop())).toContain('DeleteBehavior.Restrict')
  })
})

describe('associations 1–1', () => {
  const s = (c1: Cardinality, c2: Cardinality) =>
    build({
      entities: [entity('personne'), entity('passeport')],
      relations: [relation('posseder')],
      links: [link('posseder', 'personne', c1), link('posseder', 'passeport', c2)],
    })

  it('0,1 – 1,1 : la clé étrangère migre côté 1,1 et est UNIQUE', () => {
    const r = s('0,1', '1,1')
    expect(col(table(r, 'passeport'), 'id_personne')).toMatchObject({ nullable: false, unique: true, isForeignKey: true })
    expect(table(r, 'passeport').foreignKeys[0].unique).toBe(true)
    expect(mldToSql(r)).toContain('id_personne INT NOT NULL UNIQUE')
  })

  it('0,n – 1,1 : la clé étrangère reste non unique (relation 1–n)', () => {
    expect(col(table(s('0,n', '1,1'), 'passeport'), 'id_personne').unique).toBeUndefined()
  })

  it('SQL Server : une clé 1–1 facultative passe par un index unique filtré', () => {
    const sql = mldToSql(s('0,1', '0,1'), { dialect: 'sqlserver' })
    expect(sql).not.toMatch(/id_passeport INT UNIQUE/)
    expect(sql).toContain('CREATE UNIQUE INDEX uq_personne_id_passeport ON personne (id_passeport) WHERE id_passeport IS NOT NULL;')
    expect(mldToSql(s('0,1', '0,1'), { dialect: 'postgresql' })).toContain('id_passeport INT UNIQUE')
  })

  it('clé composée : contrainte UNIQUE de table', () => {
    const r = build({
      entities: [entity('commande'), entity('ligne', [attr('no_ligne', true)]), entity('litige')],
      relations: [relation('contenir'), relation('concerner')],
      links: [
        link('contenir', 'commande', '0,n'),
        { ...link('contenir', 'ligne', '1,1'), identifying: true },
        link('concerner', 'ligne', '0,1'),
        link('concerner', 'litige', '1,1'),
      ],
    })
    const t = table(r, 'litige')
    expect(t.foreignKeys[0]).toMatchObject({ columns: ['id_commande', 'no_ligne'], unique: true })
    expect(t.columns.every((c) => !c.unique)).toBe(true)
    expect(mldToSql(r)).toContain('CONSTRAINT uq_litige_id_commande_no_ligne UNIQUE (id_commande, no_ligne)')
    expect(mldToEfCore(r)).toContain('e.HasIndex(x => new { x.IdCommande, x.NoLigne }).IsUnique();')
  })

  it('EF Core : navigation 1–1 (WithOne) et référence inverse simple', () => {
    const cs = mldToEfCore(s('0,1', '1,1'))
    expect(cs).toContain('public Passeport? Passeport { get; set; }')
    expect(cs).toContain('e.HasOne(x => x.Personne).WithOne(y => y.Passeport).HasForeignKey<Passeport>(x => x.IdPersonne)')
  })

  it('EF Core : héritage (une table par classe) traduit en 1–1', () => {
    const cs = mldToEfCore(
      build({ entities: [{ ...entity('Vehicule'), inheritance: 'class' }, { ...entity('Voiture', [attr('portes')]), parentId: 'Vehicule' }] }),
    )
    expect(cs).toContain('WithOne(y => y.Voiture).HasForeignKey<Voiture>(x => x.IdVehicule)')
    expect(cs).not.toContain('ICollection<Voiture>')
  })
})

describe('validité du script SQL', () => {
  const shop = build({
    entities: [entity('Order', [attr('id', true), attr('key', false, 'VARCHAR')]), entity('User', [attr('id_user', true)])],
    relations: [relation('Passer')],
    links: [link('Passer', 'User', '0,n'), link('Passer', 'Order', '1,1')],
  })

  it('délimite les mots réservés selon le dialecte', () => {
    expect(quoteIdent('order', 'mysql')).toBe('`order`')
    expect(quoteIdent('order', 'sqlserver')).toBe('[order]')
    expect(quoteIdent('order', 'postgresql')).toBe('"order"')
    expect(quoteIdent('commande', 'postgresql')).toBe('commande')
    const pg = mldToSql(shop, { dialect: 'postgresql' })
    expect(pg).toContain('CREATE TABLE "order" (')
    expect(pg).toContain('  "key" VARCHAR(255)')
    expect(pg).toContain('REFERENCES "user" (id_user)')
    expect(mldToSql(shop, { dialect: 'mysql' })).toContain('CREATE TABLE `order` (')
  })

  it('SQLite : pas de ALTER TABLE ADD CONSTRAINT (non supporté), les cycles restent en ligne', () => {
    const r = build({
      entities: [entity('a'), entity('b')],
      relations: [relation('r1'), relation('r2')],
      links: [link('r1', 'a', '1,1'), link('r1', 'b', '0,n'), link('r2', 'b', '1,1'), link('r2', 'a', '0,n')],
    })
    const sql = mldToSql(r, { dialect: 'sqlite' })
    expect(sql).not.toContain('ALTER TABLE')
    expect(sql.match(/FOREIGN KEY/g)).toHaveLength(2)
  })

  it('noms de contraintes uniques dans tout le script et limités à 63 caractères', () => {
    const long = 'x'.repeat(40)
    const r = build({
      entities: [entity(`${long}_a`), entity(`${long}_b`)],
      relations: [relation('r1'), relation('r2')],
      links: [link('r1', `${long}_a`, '1,1'), link('r1', `${long}_b`, '0,n'), link('r2', `${long}_a`, '0,1'), link('r2', `${long}_b`, '0,n')],
    })
    const names = [...mldToSql(r).matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1])
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    expect(names.every((n) => n.length <= 63)).toBe(true)
  })
})

describe('tailles de type', () => {
  it('normalise les tailles valides', () => {
    expect(sqlTypeOf({ type: 'DECIMAL', size: ' 10 , 2 ' })).toBe('DECIMAL(10,2)')
    expect(sqlTypeOf({ type: 'DECIMAL', size: '12' })).toBe('DECIMAL(12)')
    expect(sqlTypeOf({ type: 'VARCHAR', size: '50' })).toBe('VARCHAR(50)')
  })

  it('retombe sur la taille par défaut si la saisie est invalide', () => {
    expect(normalizeSize({ type: 'VARCHAR', size: 'abc' })).toBeNull()
    expect(sqlTypeOf({ type: 'VARCHAR', size: 'abc' })).toBe('VARCHAR(255)')
    expect(normalizeSize({ type: 'DECIMAL', size: '2,5' })).toBeNull() // échelle > précision
    expect(sqlTypeOf({ type: 'DECIMAL', size: '8.2' })).toBe('DECIMAL(10,2)')
    expect(normalizeSize({ type: 'INT', size: 'abc' })).toBe('') // sans objet pour INT
  })

  it('EF Core accepte une précision sans échelle', () => {
    const r = build({ entities: [entity('p', [attr('id', true), { ...attr('prix', false, 'DECIMAL'), size: '12' }])] })
    expect(mldToEfCore(r)).toContain('.HasPrecision(12)')
  })
})

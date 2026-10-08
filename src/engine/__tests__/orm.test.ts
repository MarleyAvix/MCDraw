import { describe, expect, it } from 'vitest'
import { meriseToMld } from '../meriseToMld'
import { mldToPrisma } from '../mldToPrisma'
import { mldToTypeOrm } from '../mldToTypeOrm'
import type { Attribute, Cardinality, Entity, Link, MeriseSchema, Relation } from '../../types/schema'

const attr = (name: string, pk = false, type: Attribute['type'] = 'INT'): Attribute => ({ id: name, name, type, isPrimaryKey: pk })
const entity = (name: string, attrs: Attribute[] = [attr(`id_${name}`, true)]): Entity => ({ id: name, name, attributes: attrs, x: 0, y: 0 })
const relation = (name: string, attrs: Attribute[] = []): Relation => ({ id: name, name, attributes: attrs, x: 0, y: 0 })
const link = (rel: string, ent: string, cardinality: Cardinality, role?: string): Link => ({
  id: `${rel}-${ent}-${cardinality}-${role ?? ''}`,
  relationId: rel,
  entityId: ent,
  cardinality,
  role,
})
const build = (s: Partial<MeriseSchema>) => meriseToMld({ entities: [], relations: [], links: [], ...s })

const shop = build({
  entities: [entity('client', [attr('id_client', true), attr('nom', false, 'VARCHAR')]), entity('commande'), entity('produit')],
  relations: [relation('passer'), relation('contenir', [attr('quantite')])],
  links: [
    link('passer', 'client', '0,n'),
    link('passer', 'commande', '1,1'),
    link('contenir', 'commande', '1,n'),
    link('contenir', 'produit', '0,n'),
  ],
})
const refl = build({
  entities: [entity('employe')],
  relations: [relation('diriger')],
  links: [link('diriger', 'employe', '0,n', 'chef'), link('diriger', 'employe', '0,1', 'sub')],
})

describe('mldToPrisma', () => {
  const prisma = mldToPrisma(shop, { dialect: 'postgresql', autoIncrement: true })

  it('déclare générateur, source de données et modèles', () => {
    expect(prisma).toContain('provider = "postgresql"')
    expect(prisma).toContain('model Client {')
    expect(prisma).toMatch(/idClient\s+Int\s+@id @default\(autoincrement\(\)\) @map\("id_client"\)/)
    expect(prisma).toMatch(/nom\s+String\?\s+@db\.VarChar\(255\)/)
  })

  it('adapte le générateur et la source de données à la version de Prisma', () => {
    const v7 = mldToPrisma(shop, { version: '7' })
    expect(v7).toContain('provider = "prisma-client"\n')
    expect(v7).toContain('output   = "../generated/prisma"')
    expect(v7).not.toContain('url ')
    const v6 = mldToPrisma(shop, { version: '6' })
    expect(v6).toContain('provider = "prisma-client-js"')
    expect(v6).toContain('url      = env("DATABASE_URL")')
  })

  it('génère relation, collection inverse et clé composite', () => {
    expect(prisma).toContain('@relation(fields: [idClient], references: [idClient], onDelete: Restrict)')
    expect(prisma).toMatch(/commandes\s+Commande\[\]/)
    expect(prisma).toContain('@@id([idCommande, idProduit])')
  })

  it("nomme les relations d'une auto-référence", () => {
    const out = mldToPrisma(refl)
    expect(out).toContain('@relation("Employe_chef"')
    expect(out).toMatch(/Employe\[\]\s+@relation\("Employe_chef"\)/)
  })

  it("omet les attributs natifs pour SQLite et mappe l'action de suppression", () => {
    expect(mldToPrisma(shop, { dialect: 'sqlite' })).not.toContain('@db.')
    const cascade = structuredClone(shop)
    cascade.tables.find((t) => t.name === 'commande')!.foreignKeys[0].onDelete = 'CASCADE'
    expect(mldToPrisma(cascade)).toContain('onDelete: Cascade')
  })

  it('indique quand il n’y a aucune table', () => {
    expect(mldToPrisma(build({}))).toContain('Aucune table')
  })
})

describe('mldToTypeOrm', () => {
  const orm = mldToTypeOrm(shop, { dialect: 'postgresql', autoIncrement: true })

  it('génère entités, colonnes typées et imports utiles', () => {
    expect(orm).toContain("@Entity('client')")
    expect(orm).toContain("@PrimaryGeneratedColumn({ name: 'id_client' })")
    expect(orm).toContain("@Column({ name: 'nom', type: 'varchar', length: 255, nullable: true })")
    expect(orm).toContain('nom!: string | null')
    expect(orm).toMatch(/^import \{ .*JoinColumn.*ManyToOne.*OneToMany.*\} from 'typeorm'/)
  })

  it('génère relations et clés composites', () => {
    expect(orm).toContain("@ManyToOne(() => Client, (x) => x.commandes, { nullable: false, onDelete: 'RESTRICT' })")
    expect(orm).toContain("@JoinColumn({ name: 'id_client', referencedColumnName: 'idClient' })")
    expect(orm).toContain('commandes!: Relation<Commande[]>')
    expect(orm).toContain("@PrimaryColumn({ name: 'id_commande', type: 'int' })")
  })

  it('gère une auto-référence sans collision de noms', () => {
    const out = mldToTypeOrm(refl)
    expect(out).toContain('chef!: Relation<Employe> | null')
    expect(out).toContain('employes!: Relation<Employe[]>')
  })

  it('adapte les types au dialecte', () => {
    const dt = build({ entities: [entity('a', [attr('id', true), attr('quand', false, 'DATETIME')])] })
    expect(mldToTypeOrm(dt, { dialect: 'postgresql' })).toContain("type: 'timestamp'")
    expect(mldToTypeOrm(dt, { dialect: 'sqlserver' })).toContain("type: 'datetime2'")
    expect(mldToTypeOrm(dt, { dialect: 'mysql' })).toContain("type: 'datetime'")
  })
})

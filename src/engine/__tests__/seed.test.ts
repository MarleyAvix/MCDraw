import { describe, expect, it } from 'vitest'
import { meriseToMld } from '../meriseToMld'
import { planSeed, seedData, seedToSql, type SeedData } from '../mldToSeed'
import { seedToBogus, seedToFaker } from '../seedScripts'
import { runSeedJob } from '../seedJob'
import { faker } from '@faker-js/faker/locale/fr'
import type { Attribute, Cardinality, Entity, Link, MeriseSchema, Relation } from '../../types/schema'

const attr = (name: string, type: Attribute['type'] = 'VARCHAR', pk = false, extra: Partial<Attribute> = {}): Attribute => ({
  id: name,
  name,
  type,
  isPrimaryKey: pk,
  ...extra,
})
const entity = (name: string, attrs: Attribute[], extra: Partial<Entity> = {}): Entity => ({ id: name, name, attributes: attrs, x: 0, y: 0, ...extra })
const relation = (name: string, attrs: Attribute[] = []): Relation => ({ id: name, name, attributes: attrs, x: 0, y: 0 })
const link = (rel: string, ent: string, cardinality: Cardinality): Link => ({ id: `${rel}-${ent}`, relationId: rel, entityId: ent, cardinality })

const shop: MeriseSchema = {
  entities: [
    entity('Client', [attr('id_client', 'INT', true), attr('nom'), attr('email', 'VARCHAR', false, { unique: true })]),
    entity('Commande', [attr('id_commande', 'INT', true), attr('date_commande', 'DATE'), attr('date_livraison', 'DATE')]),
    entity('Produit', [attr('id_produit', 'INT', true), attr('prix', 'DECIMAL', false, { size: '5,2' })]),
  ],
  relations: [relation('passer'), relation('contenir', [attr('quantite', 'INT')])],
  links: [
    link('passer', 'Client', '0,n'),
    link('passer', 'Commande', '1,1'),
    link('contenir', 'Commande', '0,n'),
    link('contenir', 'Produit', '0,n'),
  ],
}
const gen = (s: MeriseSchema, rows = 10, seed = 42): SeedData => {
  const plan = planSeed(meriseToMld(s), { rows })
  return seedData(plan, { rows, seed })
}
const table = (d: SeedData, name: string) => d.tables.find((t) => t.plan.table.name === name)!
const col = (d: SeedData, t: string, c: string) => {
  const tb = table(d, t)
  const i = tb.plan.table.columns.findIndex((x) => x.name === c)
  return tb.rows.map((r) => r[i])
}

describe('seed data', () => {
  it('insère les tables parentes avant les tables enfants', () => {
    const order = gen(shop).tables.map((t) => t.plan.table.name)
    expect(order.indexOf('client')).toBeLessThan(order.indexOf('commande'))
    expect(order.indexOf('commande')).toBeLessThan(order.indexOf('commande_produit'))
    expect(order.indexOf('produit')).toBeLessThan(order.indexOf('commande_produit'))
  })

  it('est déterministe pour une graine donnée', () => {
    expect(JSON.stringify(gen(shop, 10, 7))).toBe(JSON.stringify(gen(shop, 10, 7)))
    expect(JSON.stringify(gen(shop, 10, 7))).not.toBe(JSON.stringify(gen(shop, 10, 8)))
  })

  it('génère des clés étrangères qui désignent des lignes existantes', () => {
    const d = gen(shop)
    const clients = new Set(col(d, 'client', 'id_client'))
    expect(col(d, 'commande', 'id_client').every((v) => clients.has(v as number))).toBe(true)
    expect(table(d, 'commande').rows).toHaveLength(10)
  })

  it("donne à une table d'association des couples distincts, bornés par le produit des parents", () => {
    const d = gen(shop)
    const pairs = table(d, 'commande_produit').rows.map((r) => `${r[0]}-${r[1]}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    const few = gen({ ...shop, entities: shop.entities }, 2)
    expect(table(few, 'commande_produit').rows.length).toBeLessThanOrEqual(4)
  })

  it('respecte UNIQUE, la précision DECIMAL et la cohérence des dates', () => {
    const d = gen(shop, 30)
    const emails = col(d, 'client', 'email') as string[]
    expect(new Set(emails).size).toBe(30)
    expect(emails.every((e) => /^[^\s@]+@[^\s@]+\.[a-z]+$/.test(e))).toBe(true)
    expect((col(d, 'produit', 'prix') as number[]).every((p) => p >= 0 && p <= 999.99)).toBe(true)
    const start = col(d, 'commande', 'date_commande') as string[]
    const end = col(d, 'commande', 'date_livraison') as string[]
    expect(end.every((e, i) => e > start[i])).toBe(true)
  })

  it('limite une association 1–1 au nombre de parents et utilise la ligne parente correspondante', () => {
    const s: MeriseSchema = {
      entities: [entity('Personne', [attr('id_personne', 'INT', true)]), entity('Passeport', [attr('numero', 'VARCHAR', true)])],
      relations: [relation('posseder')],
      links: [link('posseder', 'Personne', '0,1'), link('posseder', 'Passeport', '1,1')],
    }
    const d = gen(s, 4)
    const fk = col(d, 'passeport', 'id_personne')
    expect(new Set(fk).size).toBe(fk.length)
  })

  it("référence une ligne précédente pour une association réflexive facultative", () => {
    const s: MeriseSchema = {
      entities: [entity('Employe', [attr('id_employe', 'INT', true), attr('nom')])],
      relations: [relation('diriger')],
      links: [{ ...link('diriger', 'Employe', '0,1'), role: 'chef' }, { ...link('diriger', 'Employe', '0,n'), id: 'x', role: 'equipe' }],
    }
    const d = gen(s, 6)
    const chef = d.tables[0].rows.map((r) => r[d.tables[0].plan.table.columns.findIndex((c) => c.name.endsWith('_id_employe'))])
    expect(chef[0] ?? null).toBeNull()
    chef.forEach((v, i) => v !== null && expect(v as number).toBeLessThanOrEqual(i))
  })

  it('exporte du SQL adapté au dialecte', () => {
    const d = gen(shop, 3)
    const pg = seedToSql(d, { dialect: 'postgresql', autoIncrement: true })
    expect(pg).toContain('INSERT INTO client (id_client, nom, email) VALUES')
    expect(pg).toContain("SELECT setval(pg_get_serial_sequence('client', 'id_client')")
    const ms = seedToSql(d, { dialect: 'sqlserver', autoIncrement: true })
    expect(ms).toContain('SET IDENTITY_INSERT client ON;')
    expect(ms).toContain("N'")
    expect(seedToSql(d, { dialect: 'standard', autoIncrement: true })).toContain('OVERRIDING SYSTEM VALUE')
    expect(seedToSql(d, { dialect: 'mysql' })).not.toContain('IDENTITY')
  })
})

describe('scripts de seed', () => {
  const mld = meriseToMld(shop)

  it('génère un DbInitializer Bogus cohérent avec les noms EF', () => {
    const cs = seedToBogus(mld, { rows: 8, seed: 3 }, { namespace: 'Demo', contextName: 'ShopContext' })
    expect(cs).toContain('namespace Demo;')
    expect(cs).toContain('public static void Seed(ShopContext db, int seed = 3)')
    expect(cs).toContain('if (db.Clients.Any()) return;')
    expect(cs).toContain('new Faker<Client>("fr")')
    expect(cs).toContain('.RuleFor(x => x.Email, f => f.Internet.Email(uniqueSuffix: f.IndexFaker.ToString()))')
    expect(cs).not.toContain('x.IdClient, f =>') // clé auto-générée par la base : non renseignée
    expect(cs).toContain('commandeProduitListCombos') // table d'association
    expect(cs).toContain('db.CommandeProduits.AddRange(commandeProduitList);')
    expect(cs.indexOf('db.Clients.AddRange')).toBeLessThan(cs.indexOf('db.Commandes.AddRange'))
  })

  it('génère un script Faker JS syntaxiquement valide', () => {
    const js = seedToFaker(mld, { rows: 5 }, { dialect: 'postgresql', autoIncrement: true })
    expect(js).toContain("import { faker } from '@faker-js/faker/locale/fr'")
    expect(js).toContain('faker.seed(42)')
    expect(js).toContain('faker.person.lastName()')
    expect(js).toContain('pg_get_serial_sequence')
    expect(() => new Function(js.replace(/^import .*$/m, 'const faker = {}'))).not.toThrow()
  })
})

describe('seed : cas limites', () => {
  it("association quaternaire à 100 lignes : tirage sans énumérer les 100^4 combinaisons", () => {
    const names = ['A', 'B', 'C', 'D']
    const s: MeriseSchema = {
      entities: names.map((n) => entity(n, [attr(`id_${n}`, 'INT', true)])),
      relations: [relation('r')],
      links: names.map((n) => link('r', n, '0,n')),
    }
    const t0 = performance.now()
    const d = gen(s, 100)
    expect(performance.now() - t0).toBeLessThan(2000)
    const rows = table(d, 'a_b_c_d').rows
    expect(rows).toHaveLength(100)
    expect(new Set(rows.map((r) => r.join('-'))).size).toBe(100)
  })

  it('clé VARCHAR(2) unique : valeurs distinctes qui tiennent dans la longueur', () => {
    const s: MeriseSchema = { entities: [entity('Pays', [attr('code_pays', 'VARCHAR', true, { size: '2' }), attr('nom')])], relations: [], links: [] }
    const codes = col(gen(s, 30), 'pays', 'code_pays') as string[]
    expect(new Set(codes).size).toBe(30)
    expect(codes.every((c) => c.length <= 2)).toBe(true)
  })

  it('date unique : des dates distinctes et valides, pas un suffixe numérique', () => {
    const s: MeriseSchema = { entities: [entity('Jour', [attr('date_jour', 'DATE', true)])], relations: [], links: [] }
    const days = col(gen(s, 30), 'jour', 'date_jour') as string[]
    expect(new Set(days).size).toBe(30)
    expect(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))).toBe(true)
  })

  it('scripts : le suffixe d’unicité est conservé dans la longueur permise', () => {
    const s: MeriseSchema = { entities: [entity('Pays', [attr('code_pays', 'VARCHAR', true, { size: '2' })])], relations: [], links: [] }
    const mld = meriseToMld(s)
    expect(seedToFaker(mld, { rows: 5 })).toContain('.slice(0, Math.max(0, 2 - String(i).length)) + i')
    expect(seedToBogus(mld, { rows: 5 })).toContain('.ClampLength(max: Math.Max(0, 2 - f.IndexFaker.ToString().Length)) + f.IndexFaker')
  })
})

describe('seed : gros volumes', () => {
  it('découpe les INSERT par lots de 500 lignes (SQL Server en refuse plus de 1 000)', () => {
    const sql = seedToSql(gen(shop, 1200), { dialect: 'sqlserver', autoIncrement: true })
    expect(sql.match(/INSERT INTO client /g)).toHaveLength(3)
    const batches = sql.split('INSERT INTO').slice(1).map((b) => b.split('\n').filter((l) => l.startsWith('  (')).length)
    expect(Math.max(...batches)).toBeLessThanOrEqual(500)
    expect(sql.indexOf('SET IDENTITY_INSERT client ON')).toBeLessThan(sql.indexOf('INSERT INTO client'))
    expect(sql.lastIndexOf('INSERT INTO client')).toBeLessThan(sql.indexOf('SET IDENTITY_INSERT client OFF'))
  })

  it('le script Faker exécuté produit lui aussi des lots de 500 lignes', () => {
    const js = seedToFaker(meriseToMld(shop), { rows: 600 }, { dialect: 'sqlserver', autoIncrement: true })
    let printed = ''
    new Function('faker', 'console', js.replace(/^import .*$/m, ''))(faker, { log: (s: string) => (printed = s) })
    expect(printed.match(/INSERT INTO client /g)).toHaveLength(2)
    expect(printed).toContain('SET IDENTITY_INSERT client ON;')
  })

  it('runSeedJob (exécuté dans le worker) donne le même script que la chaîne directe, et les tables réduites', () => {
    const mld = meriseToMld(shop)
    const job = { mld, rows: 10, seed: 42, dialect: 'mysql' as const, autoIncrement: true, ef: { namespace: 'Demo', contextName: 'Ctx' } }
    const direct = seedToSql(seedData(planSeed(mld, { rows: 10 }), { rows: 10, seed: 42 }), { dialect: 'mysql', autoIncrement: true })
    expect(runSeedJob({ ...job, format: 'sql' }).code).toBe(direct)
    expect(runSeedJob({ ...job, format: 'csharp' }).code).toContain('namespace Demo;')
    expect(runSeedJob({ ...job, format: 'faker' }).code).toContain('faker.seed(42)')
    expect(runSeedJob({ ...job, format: 'sql' }).reduced).toEqual([])
  })
})

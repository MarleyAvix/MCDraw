import { describe, expect, it } from 'vitest'
import { sqlToMcd } from '../sqlToMcd'
import { buildTemplate, TEMPLATE_DEFS } from '../templates'
import { meriseToMld } from '../meriseToMld'
import { mldToSql, SQL_DIALECTS } from '../mldToSql'

const counter = () => {
  let n = 0
  return () => `n${n++}`
}
const run = (sql: string) => sqlToMcd(sql, counter())
const entity = (s: ReturnType<typeof run>, name: string) => s.schema.entities.find((e) => e.name === name)!
const legs = (s: ReturnType<typeof run>, rel: string) => {
  const r = s.schema.relations.find((x) => x.name === rel)!
  return s.schema.links.filter((l) => l.relationId === r.id).map((l) => `${s.schema.entities.find((e) => e.id === l.entityId)!.name} ${l.cardinality}`)
}

describe('sqlToMcd', () => {
  it('clé étrangère → association 1,1 / 0,n ; la colonne de clé disparaît des attributs', () => {
    const r = run(`
      -- boutique
      CREATE TABLE client (id INT PRIMARY KEY AUTO_INCREMENT, nom VARCHAR(100) NOT NULL);
      CREATE TABLE commande (
        id INT AUTO_INCREMENT,
        client_id INT NOT NULL,
        total DECIMAL(10, 2) DEFAULT 0,
        PRIMARY KEY (id),
        FOREIGN KEY (client_id) REFERENCES client(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;`)
    expect(r.warnings).toEqual([])
    expect(entity(r, 'commande').attributes.map((a) => a.name)).toEqual(['id', 'total'])
    expect(entity(r, 'commande').attributes[1]).toMatchObject({ type: 'DECIMAL', size: '10,2', defaultValue: '0' })
    expect(entity(r, 'client').attributes[1]).toMatchObject({ name: 'nom', type: 'VARCHAR', size: '100', notNull: true })
    expect(legs(r, 'commande_client')).toEqual(['commande 1,1', 'client 0,n'])
    expect(r.schema.links.find((l) => l.cardinality === '0,n')).toMatchObject({ onDelete: 'CASCADE' })
  })

  it('colonne de clé étrangère nullable → 0,1 ; unique → 0,1 côté référencé', () => {
    const r = run(`
      CREATE TABLE a (id INT PRIMARY KEY);
      CREATE TABLE b (id INT PRIMARY KEY, a_id INT REFERENCES a(id));
      CREATE TABLE c (id INT PRIMARY KEY, a_id INT NOT NULL UNIQUE REFERENCES a(id));`)
    expect(legs(r, 'b_a')).toEqual(['b 0,1', 'a 0,n'])
    expect(legs(r, 'c_a')).toEqual(['c 1,1', 'a 0,1'])
  })

  it('table de jointure → association portant ses colonnes', () => {
    const r = run(`
      CREATE TABLE etudiant (id INT PRIMARY KEY);
      CREATE TABLE cours (id INT PRIMARY KEY);
      CREATE TABLE inscription (
        etudiant_id INT, cours_id INT, note INT,
        PRIMARY KEY (etudiant_id, cours_id),
        FOREIGN KEY (etudiant_id) REFERENCES etudiant(id),
        FOREIGN KEY (cours_id) REFERENCES cours(id));`)
    expect(r.schema.entities.map((e) => e.name)).toEqual(['etudiant', 'cours'])
    expect(legs(r, 'inscription')).toEqual(['etudiant 0,n', 'cours 0,n'])
    expect(r.schema.relations[0].attributes.map((a) => a.name)).toEqual(['note'])
    expect(r.schema.relations[0].tableName).toBe('inscription')
  })

  it('clé primaire = clé étrangère → héritage', () => {
    const r = run(`
      CREATE TABLE personne (id INT PRIMARY KEY, nom TEXT);
      CREATE TABLE eleve (id INT PRIMARY KEY REFERENCES personne(id), classe VARCHAR(10));`)
    expect(entity(r, 'eleve').parentId).toBe(entity(r, 'personne').id)
    expect(entity(r, 'eleve').attributes.map((a) => a.name)).toEqual(['classe'])
    expect(r.schema.relations).toEqual([])
  })

  it('clé étrangère dans une clé primaire plus large → identifiant relatif', () => {
    const r = run(`
      CREATE TABLE commande (id INT PRIMARY KEY);
      CREATE TABLE ligne (commande_id INT NOT NULL REFERENCES commande(id), numero INT, PRIMARY KEY (commande_id, numero));`)
    const link = r.schema.links.find((l) => l.identifying)!
    expect(link.cardinality).toBe('1,1')
    expect(entity(r, 'ligne').attributes.map((a) => [a.name, a.isPrimaryKey])).toEqual([['numero', true]])
  })

  it('auto-référence : deux pattes avec rôles', () => {
    const r = run(`CREATE TABLE employe (id INT PRIMARY KEY, id_manager INT REFERENCES employe(id));`)
    const roles = r.schema.links.map((l) => l.role)
    expect(roles).toEqual(['enfant', 'manager'])
  })

  it('SQL Server : crochets, schéma, ALTER TABLE et GO', () => {
    const r = run(`
      SET ANSI_NULLS ON
      GO
      CREATE TABLE [dbo].[Pays] ([Id] [int] IDENTITY(1,1) NOT NULL, [Nom] [nvarchar](50) NOT NULL, CONSTRAINT [PK_Pays] PRIMARY KEY CLUSTERED ([Id] ASC)) ON [PRIMARY]
      GO
      CREATE TABLE [dbo].[Ville] ([Id] [int] NOT NULL, [PaysId] [int] NOT NULL, [Nom] [nvarchar](max) NULL, CONSTRAINT [PK_Ville] PRIMARY KEY CLUSTERED ([Id] ASC))
      GO
      ALTER TABLE [dbo].[Ville] WITH CHECK ADD CONSTRAINT [FK_Ville_Pays] FOREIGN KEY([PaysId]) REFERENCES [dbo].[Pays] ([Id]) ON DELETE CASCADE
      GO`)
    expect(r.schema.entities.map((e) => e.name)).toEqual(['Pays', 'Ville'])
    expect(entity(r, 'Pays').attributes[1]).toMatchObject({ name: 'Nom', type: 'VARCHAR', size: '50' })
    expect(entity(r, 'Ville').attributes.map((a) => [a.name, a.type])).toEqual([['Id', 'INT'], ['Nom', 'TEXT']])
    expect(legs(r, 'Ville_Pays')).toEqual(['Ville 1,1', 'Pays 0,n'])
  })

  it('PostgreSQL : types, défauts, CHECK et guillemets doubles', () => {
    const r = run(`
      CREATE TABLE "produit" (
        "id" SERIAL PRIMARY KEY,
        "prix" NUMERIC(8,2) NOT NULL CHECK (prix >= 0),
        "actif" BOOLEAN DEFAULT true,
        "statut" CHARACTER VARYING(20) DEFAULT 'brouillon'::character varying,
        "cree_le" TIMESTAMP WITH TIME ZONE DEFAULT now()
      );`)
    const a = Object.fromEntries(entity(r, 'produit').attributes.map((x) => [x.name, x]))
    expect(a.prix).toMatchObject({ type: 'DECIMAL', size: '8,2', check: 'prix >= 0' })
    expect(a.actif).toMatchObject({ type: 'BOOLEAN', defaultValue: 'true' })
    expect(a.statut).toMatchObject({ type: 'VARCHAR', size: '20', defaultValue: 'brouillon' })
    expect(a.cree_le).toMatchObject({ type: 'DATETIME', defaultValue: 'now()' })
  })

  it('signale type inconnu, référence absente et table sans clé', () => {
    const r = run(`CREATE TABLE t (a GEOMETRY, b INT REFERENCES absente(id));`)
    expect(r.warnings.join('\n')).toMatch(/GEOMETRY/)
    expect(r.warnings.join('\n')).toMatch(/absente/)
    expect(r.warnings.join('\n')).toMatch(/clé primaire/)
    expect(entity(r, 't').attributes[0].isPrimaryKey).toBe(true)
  })

  it('texte sans CREATE TABLE : avertissement', () => {
    expect(run('SELECT 1;').warnings).toEqual(['Aucun CREATE TABLE trouvé dans ce script.'])
  })
})

// Aller-retour : le SQL produit par MCDraw doit se relire en un MCD qui redonne les mêmes tables et clés étrangères.
describe.each(TEMPLATE_DEFS)('aller-retour SQL « $label »', (def) => {
  const mld = meriseToMld(buildTemplate(def, counter()))
  const shape = (m: ReturnType<typeof meriseToMld>) =>
    m.tables.map((t) => `${t.name}(${[...t.columns.map((c) => c.name)].sort().join(',')}) pk=${[...t.primaryKey].sort()} fk=${t.foreignKeys.map((f) => `${f.columns.join('+')}>${f.refTable}`).sort()}`).sort()

  it.each(SQL_DIALECTS)('%s', (dialect) => {
    const back = sqlToMcd(mldToSql(mld, { dialect, autoIncrement: true }), counter())
    expect(back.warnings).toEqual([])
    const again = meriseToMld(back.schema)
    expect(again.tables.map((t) => t.name).sort()).toEqual(mld.tables.map((t) => t.name).sort())
    expect(again.tables.flatMap((t) => t.foreignKeys).length).toBe(mld.tables.flatMap((t) => t.foreignKeys).length)
    if (dialect === 'standard') expect(shape(again)).toEqual(shape(mld))
  })
})

describe('dump phpMyAdmin', () => {
  const BS = String.fromCharCode(92) // antislash : MySQL échappe ainsi les apostrophes (« d'Afrique »)
  const dump = `
    /*!40101 SET NAMES utf8mb4 */;
    CREATE TABLE \`espece\` (\`id\` int(11) NOT NULL, \`nom\` varchar(50) NOT NULL) ENGINE=InnoDB;
    INSERT INTO \`espece\` (\`id\`, \`nom\`) VALUES (1, 'Lion d${BS}'Afrique'), (2, 'Girafe');
    CREATE TABLE \`animals\` (\`id\` int(11) NOT NULL, \`espece_id\` int(11) NOT NULL, \`enclos_id\` int(11) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE \`enclos\` (\`id\` int(11) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE \`__efmigrationshistory\` (\`MigrationId\` varchar(150) NOT NULL);
    ALTER TABLE \`animals\` ADD PRIMARY KEY (\`id\`), ADD KEY \`IX\` (\`espece_id\`);
    ALTER TABLE \`espece\` ADD PRIMARY KEY (\`id\`);
    ALTER TABLE \`enclos\` ADD PRIMARY KEY (\`id\`);
    ALTER TABLE \`animals\` MODIFY \`id\` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;
    ALTER TABLE \`animals\`
      ADD CONSTRAINT \`FK_a\` FOREIGN KEY (\`enclos_id\`) REFERENCES \`enclos\` (\`id\`) ON DELETE CASCADE,
      ADD CONSTRAINT \`FK_b\` FOREIGN KEY (\`espece_id\`) REFERENCES \`espece\` (\`id\`) ON DELETE CASCADE;
    COMMIT;`

  it('INSERT avec apostrophe échappée, ALTER à plusieurs ADD, table technique ignorée', () => {
    const r = run(dump)
    expect(r.schema.entities.map((e) => e.name)).toEqual(['espece', 'animals', 'enclos'])
    expect(r.schema.relations.map((x) => x.name).sort()).toEqual(['animals_enclos', 'animals_espece'])
    expect(r.schema.links.filter((l) => l.onDelete === 'CASCADE')).toHaveLength(2)
    expect(entity(r, 'animals').attributes.map((a) => a.name)).toEqual(['id'])
    expect(r.warnings).toEqual(['Table(s) technique(s) ignorée(s) : __efmigrationshistory.'])
  })
})

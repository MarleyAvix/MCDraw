import { efNames } from './mldToEfCore'
import { COLORS, GENDERS, STATUSES, identityWrap, planSeed, type ColumnPlan, type SeedOptions, type SeedPlan, type ValuePlan } from './mldToSeed'
import { quoteIdent, type SqlDialect } from './mldToSql'
import type { MldResult } from '../types/schema'

/**
 * Scripts de remplissage qui génèrent les données à l'exécution : une classe C# (Bogus) pour EF Core,
 * ou un script Node (@faker-js/faker) qui écrit un `seed.sql`. Ils suivent le même plan que l'export SQL direct.
 */

const baseType = (c: ColumnPlan) => c.column.sqlType.replace(/\(.*\)$/, '')
/** Longueur en dessous de laquelle on tronque : au-delà, les valeurs générées tiennent toujours. */
const SHORT = 100
const pickList = (list: readonly string[]) => list.map((s) => JSON.stringify(s)).join(', ')

// ---------------------------------------------------------------------------------------------
// C# Bogus
// ---------------------------------------------------------------------------------------------

export interface BogusOptions {
  namespace: string
  contextName: string
}

const camel = (s: string) => s.replace(/^./, (x) => x.toLowerCase())

function bogusValue(cp: ColumnPlan, v: ValuePlan, prevNullable: boolean): { expr: string; usesRow: boolean } {
  const clamp = (e: string) => (v.maxLen && v.maxLen < SHORT ? `${e.includes(' + ') ? `(${e})` : e}.ClampLength(max: ${v.maxLen})` : e)
  const uniq = (e: string) => (v.unique ? `${e} + f.IndexFaker` : e)
  const range = `${v.min}, ${v.max}`
  switch (v.kind) {
    case 'email': return { expr: clamp(v.unique ? 'f.Internet.Email(uniqueSuffix: f.IndexFaker.ToString())' : 'f.Internet.Email()'), usesRow: false }
    case 'firstName': return { expr: clamp(uniq('f.Name.FirstName()')), usesRow: false }
    case 'lastName': return { expr: clamp(uniq('f.Name.LastName()')), usesRow: false }
    case 'productName': return { expr: clamp(uniq('f.Commerce.ProductName()')), usesRow: false }
    case 'word': return { expr: clamp(uniq('f.Lorem.Word()')), usesRow: false }
    case 'city': return { expr: clamp(uniq('f.Address.City()')), usesRow: false }
    case 'country': return { expr: clamp(uniq('f.Address.Country()')), usesRow: false }
    case 'zip': return { expr: clamp('f.Address.ZipCode()'), usesRow: false }
    case 'phone': return { expr: clamp(uniq('f.Phone.PhoneNumber()')), usesRow: false }
    case 'street': return { expr: clamp(uniq('f.Address.StreetAddress()')), usesRow: false }
    case 'company': return { expr: clamp(uniq('f.Company.CompanyName()')), usesRow: false }
    case 'url': return { expr: clamp(uniq('f.Internet.Url()')), usesRow: false }
    case 'title': return { expr: clamp(uniq("f.Lorem.Sentence(3).TrimEnd('.')")), usesRow: false }
    case 'text': return { expr: clamp('f.Lorem.Paragraph()'), usesRow: false }
    case 'color': return { expr: clamp(uniq('f.Commerce.Color()')), usesRow: false }
    case 'username': return { expr: clamp(uniq('f.Internet.UserName()')), usesRow: false }
    case 'password': return { expr: clamp('f.Internet.Password()'), usesRow: false }
    case 'status': return { expr: `f.PickRandom(${pickList(STATUSES)})`, usesRow: false }
    case 'gender': return { expr: `f.PickRandom(${pickList(GENDERS)})`, usesRow: false }
    case 'int': return { expr: v.unique ? `f.IndexFaker + ${v.min}` : `f.Random.Int(${range})`, usesRow: false }
    case 'decimal':
      return baseType(cp) === 'FLOAT'
        ? { expr: `Math.Round(f.Random.Double(${range}), ${v.decimals})`, usesRow: false }
        : { expr: `Math.Round(f.Random.Decimal(${v.min}m, ${v.max}m), ${v.decimals})`, usesRow: false }
    case 'bool': return { expr: 'f.Random.Bool()', usesRow: false }
    case 'date':
    case 'datetime': {
      const tail = v.kind === 'date' ? '.Date' : ''
      if (v.after) return { expr: `${prevNullable ? '(x.PREV ?? DateTime.Today)' : 'x.PREV'}.AddDays(f.Random.Int(1, 30))${tail}`, usesRow: true }
      return { expr: `f.Date.Between(new DateTime(${v.min}, 1, 1), new DateTime(${v.max}, 12, 31))${tail}`, usesRow: false }
    }
  }
}

/** Classe C# `DbInitializer` (Bogus) qui peuple la base EF Core au démarrage si elle est vide. */
export function seedToBogus(mld: MldResult, seedOptions: Partial<SeedOptions> = {}, options: Partial<BogusOptions> = {}): string {
  const o = { namespace: 'MonApp.Data', contextName: 'AppDbContext', ...options }
  const plan = planSeed(mld, seedOptions)
  const rows = Math.max(1, Math.floor(seedOptions.rows ?? 10))
  if (!plan.tables.length) return '// Aucune table : ajoutez des entités au MCD.\n'

  const { className, props } = efNames(mld.tables)
  const list = (name: string) => `${camel(className.get(name)!)}List`
  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('// Nécessite le paquet Bogus :  dotnet add package Bogus')
  w('// Appel au démarrage (Program.cs) :')
  w('//   using (var scope = app.Services.CreateScope())')
  w(`//       DbInitializer.Seed(scope.ServiceProvider.GetRequiredService<${o.contextName}>());`)
  w('using System;')
  w('using System.Linq;')
  w('using Bogus;')
  w('using Bogus.Extensions;')
  w()
  w(`namespace ${o.namespace};`)
  w()
  w('public static class DbInitializer')
  w('{')
  w(`    public static void Seed(${o.contextName} db, int seed = ${seedOptions.seed ?? 42})`)
  w('    {')
  w(`        if (db.${className.get(plan.tables[0].table.name)}s.Any()) return; // base déjà remplie`)
  w()
  w('        Randomizer.Seed = new Random(seed);')
  w('        var faker = new Faker("fr");')
  for (const w2 of plan.warnings) w(`        // Attention : ${w2}`)

  for (const tp of plan.tables) {
    const t = tp.table
    const cls = className.get(t.name)!
    const p = props.get(t.name)!
    const lst = list(t.name)
    const prop = (c: string) => p.get(c)!
    w()
    w(`        // ${t.name}`)

    // nombre de lignes : borné par les parents d'une association 1–1 ou par les couples possibles
    const caps: string[] = []
    if (tp.combo.length) {
      const sources = tp.combo.map((fi, k) => `from r${k} in ${list(t.foreignKeys[fi].refTable)}`).join(' ')
      w(`        var ${lst}Combos = (${sources} select (${tp.combo.map((_, k) => `r${k}`).join(', ')}))`)
      w(`            .OrderBy(_ => faker.Random.Int()).Take(${rows}).ToList();`)
      caps.push(`${lst}Combos.Count`)
    }
    for (const fp of tp.fks) if (fp.mode === 'index') caps.push(`${list(fp.fk.refTable)}.Count`)
    const count = caps.length ? `Math.Min(${[rows, ...caps].join(', ')})` : String(rows)

    const rules: string[] = []
    for (const cp of tp.columns) {
      if (cp.source === 'fk' || cp.dbGenerated) continue
      const name = prop(cp.column.name)
      if (cp.source === 'serial') {
        rules.push(`            .RuleFor(x => x.${name}, f => f.IndexFaker + 1)`)
        continue
      }
      const v = cp.value!
      const prev = v.after ? tp.table.columns.find((c) => c.name === v.after) : undefined
      const { expr, usesRow } = bogusValue(cp, v, !!prev?.nullable)
      rules.push(`            .RuleFor(x => x.${name}, ${usesRow ? '(f, x)' : 'f'} => ${expr.replace('PREV', prev ? prop(prev.name) : '')})`)
    }
    w(`        var ${lst} = new Faker<${cls}>("fr")`)
    for (const r of rules) w(r)
    w(`            .Generate(${count});`)

    const assigns: string[] = []
    tp.fks.forEach((fp, fi) => {
      const { fk, mode, nullable } = fp
      const src = list(fk.refTable)
      const set = (src: string) => fk.columns.map((c, k) => `row.${prop(c)} = ${src}${nullable ? '?' : ''}.${props.get(fk.refTable)!.get(fk.refColumns[k])};`)
      if (mode === 'random') {
        assigns.push(`var p${fi} = ${nullable ? `faker.Random.Bool(0.85f) ? faker.PickRandom(${src}) : null` : `faker.PickRandom(${src})`};`, ...set(`p${fi}`))
      } else if (mode === 'index') {
        assigns.push(`var p${fi} = ${src}[i % ${src}.Count];`, ...set(`p${fi}`))
      } else if (mode === 'combo') {
        assigns.push(`var p${fi} = ${lst}Combos[i].r${tp.combo.indexOf(fi)};`, ...fk.columns.map((c, k) => `row.${prop(c)} = p${fi}.${props.get(fk.refTable)!.get(fk.refColumns[k])};`))
      } else if (mode === 'forward') {
        fk.columns.forEach((c) => assigns.push(`row.${prop(c)} = faker.Random.Int(1, ${rows}); // identifiant supposé : parent créé plus loin`))
      }
    })
    if (assigns.length) {
      w(`        for (var i = 0; i < ${lst}.Count; i++)`)
      w('        {')
      w(`            var row = ${lst}[i];`)
      for (const a of assigns) w(`            ${a}`)
      w('        }')
    }
    w(`        db.${cls}s.AddRange(${lst});`)
    w('        db.SaveChanges();')

    // auto-référence : les clés de la table sont connues après la première sauvegarde
    for (const fp of tp.fks.filter((x) => x.mode === 'self')) {
      const { fk, nullable } = fp
      if (!nullable) {
        w(`        // Attention : ${fk.columns.join(', ')} est obligatoire et référence la table elle-même : l'insertion échouera, rendez la clé facultative.`)
        continue
      }
      w(`        for (var i = 1; i < ${lst}.Count; i++)`)
      w('        {')
      w(`            var parent = ${lst}[faker.Random.Int(0, i - 1)];`)
      fk.columns.forEach((c, k) => w(`            ${lst}[i].${prop(c)} = faker.Random.Bool(0.8f) ? parent.${prop(fk.refColumns[k])} : null;`))
      w('        }')
      w('        db.SaveChanges();')
    }
  }
  w('    }')
  w('}')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------
// JavaScript @faker-js/faker
// ---------------------------------------------------------------------------------------------

export interface FakerScriptOptions {
  dialect: SqlDialect
  autoIncrement: boolean
}

function fakerValue(v: ValuePlan): string {
  const clamp = (e: string) => (v.maxLen && v.maxLen < SHORT ? `${e.includes(' + ') ? `(${e})` : e}.slice(0, ${v.maxLen})` : e)
  const uniq = (e: string) => (v.unique ? `${e} + i` : e)
  switch (v.kind) {
    case 'email': return clamp(v.unique ? "faker.internet.email().replace('@', `${i}@`)" : 'faker.internet.email()')
    case 'firstName': return clamp(uniq('faker.person.firstName()'))
    case 'lastName': return clamp(uniq('faker.person.lastName()'))
    case 'productName': return clamp(uniq('faker.commerce.productName()'))
    case 'word': return clamp(uniq('faker.lorem.word()'))
    case 'city': return clamp(uniq('faker.location.city()'))
    case 'country': return clamp(uniq('faker.location.country()'))
    case 'zip': return clamp('faker.location.zipCode()')
    case 'phone': return clamp(uniq('faker.phone.number()'))
    case 'street': return clamp(uniq('faker.location.streetAddress()'))
    case 'company': return clamp(uniq('faker.company.name()'))
    case 'url': return clamp(uniq('faker.internet.url()'))
    case 'title': return clamp(uniq("faker.lorem.sentence({ min: 2, max: 4 }).replace(/\\.$/, '')"))
    case 'text': return clamp('faker.lorem.paragraph()')
    case 'color': return clamp(uniq(`faker.helpers.arrayElement([${pickList(COLORS)}])`))
    case 'username': return clamp(uniq('faker.internet.username()'))
    case 'password': return clamp('faker.internet.password()')
    case 'status': return `faker.helpers.arrayElement([${pickList(STATUSES)}])`
    case 'gender': return `faker.helpers.arrayElement([${pickList(GENDERS)}])`
    case 'int': return v.unique ? `i + ${v.min}` : `faker.number.int({ min: ${v.min}, max: ${v.max} })`
    case 'decimal': return `faker.number.float({ min: ${v.min}, max: ${v.max}, fractionDigits: ${v.decimals} })`
    case 'bool': return 'faker.datatype.boolean()'
    case 'date':
    case 'datetime': {
      const fmt = v.kind === 'date' ? 'ymd' : 'ymdhms'
      if (v.after) return `addDays(row.${v.after}, faker.number.int({ min: 1, max: 30 }))`
      return `${fmt}(faker.date.between({ from: '${v.min}-01-01', to: '${v.max}-12-31' }))`
    }
  }
}

/** Script Node (ESM) qui génère les données avec @faker-js/faker et écrit les `INSERT` sur la sortie standard. */
export function seedToFaker(mld: MldResult, seedOptions: Partial<SeedOptions> = {}, options: Partial<FakerScriptOptions> = {}): string {
  const o: FakerScriptOptions = { dialect: 'standard', autoIncrement: false, ...options }
  const plan: SeedPlan = planSeed(mld, seedOptions)
  const rows = Math.max(1, Math.floor(seedOptions.rows ?? 10))
  if (!plan.tables.length) return '// Aucune table : ajoutez des entités au MCD.\n'

  const q = (n: string) => quoteIdent(n, o.dialect)
  const list = (name: string) => `${name.replace(/[^a-zA-Z0-9_]/g, '_')}_rows`
  const bool = o.dialect === 'sqlserver' || o.dialect === 'sqlite' ? "v ? '1' : '0'" : "v ? 'TRUE' : 'FALSE'"
  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('// Données fictives générées par MCDraw.')
  w('//   npm install @faker-js/faker')
  w('//   node seed.mjs > seed.sql')
  w("import { faker } from '@faker-js/faker/locale/fr'")
  w()
  w(`faker.seed(${seedOptions.seed ?? 42})`)
  w()
  w('const pad = (n) => String(n).padStart(2, \'0\')')
  w('const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`')
  w('const ymdhms = (d) => `${ymd(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`')
  w('const addDays = (s, n) => {')
  w("  const d = new Date(s.length > 10 ? s.replace(' ', 'T') + 'Z' : s + 'T00:00:00Z')")
  w('  d.setUTCDate(d.getUTCDate() + n)')
  w('  return s.length > 10 ? ymdhms(d) : ymd(d)')
  w('}')
  w('const pick = (list) => faker.helpers.arrayElement(list)')
  w('const maybe = (p) => faker.number.float({ min: 0, max: 1 }) < p')
  w()
  w(`const literal = (v) =>`)
  w(`  v === null ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (${bool}) : \`${o.dialect === 'sqlserver' ? 'N' : ''}'\${String(v).replace(/'/g, "''")}'\``)
  w('const out = []')
  w('const insert = (table, columns, rows, { before = [], after = [], override = false } = {}) => {')
  w('  const values = rows.map((r) => `  (${columns.map(([name]) => literal(r[name])).join(\', \')})`).join(\',\\n\')')
  w("  const names = columns.map(([, sql]) => sql).join(', ')")
  w("  out.push([...before, `INSERT INTO ${table} (${names})${override ? ' OVERRIDING SYSTEM VALUE' : ''} VALUES\\n${values};`, ...after].join('\\n'))")
  w('}')
  for (const w2 of plan.warnings) w(`// Attention : ${w2}`)

  for (const tp of plan.tables) {
    const t = tp.table
    const lst = list(t.name)
    w()
    w(`// ${t.name}`)
    if (tp.combo.length) {
      const sources = tp.combo.map((fi) => list(t.foreignKeys[fi].refTable))
      const product = sources.slice(1).reduce((expr, src) => `${expr}.flatMap((c) => ${src}.map((p) => [...c, p]))`, `${sources[0]}.map((p) => [p])`)
      w(`const ${lst}_combos = faker.helpers.shuffle(${product}).slice(0, ${rows})`)
    }
    const caps: string[] = []
    if (tp.combo.length) caps.push(`${lst}_combos.length`)
    for (const fp of tp.fks) if (fp.mode === 'index') caps.push(`${list(fp.fk.refTable)}.length`)
    const count = caps.length ? `Math.min(${[rows, ...caps].join(', ')})` : String(rows)

    w(`const ${lst} = Array.from({ length: ${count} }, (_, i) => {`)
    w('  const row = {}')
    for (const cp of tp.columns) {
      const n = cp.column.name
      if (cp.source === 'serial') w(`  row.${n} = i + 1`)
      else if (cp.source === 'fk') w(`  row.${n} = null`)
      else w(`  row.${n} = ${fakerValue(cp.value!)}`)
    }
    w('  return row')
    w('})')

    const assigns: string[] = []
    tp.fks.forEach((fp, fi) => {
      const { fk, mode, nullable } = fp
      const src = list(fk.refTable)
      const copy = (from: string) => fk.columns.map((c, k) => `row.${c} = ${from}${nullable ? '?.' : '.'}${fk.refColumns[k]} ?? null`)
      if (mode === 'random') assigns.push(`const p${fi} = ${nullable ? `maybe(0.85) ? pick(${src}) : null` : `pick(${src})`}`, ...copy(`p${fi}`))
      else if (mode === 'index') assigns.push(`const p${fi} = ${src}[i % ${src}.length]`, ...copy(`p${fi}`))
      else if (mode === 'combo') assigns.push(`const p${fi} = ${lst}_combos[i][${tp.combo.indexOf(fi)}]`, ...copy(`p${fi}`))
      else if (mode === 'self') {
        if (nullable) assigns.push(`const p${fi} = i > 0 && maybe(0.8) ? ${lst}[faker.number.int({ min: 0, max: i - 1 })] : null`, ...copy(`p${fi}`))
        else assigns.push(`const p${fi} = ${lst}[i > 0 ? faker.number.int({ min: 0, max: i - 1 }) : 0]`, ...copy(`p${fi}`))
      } else if (mode === 'forward') fk.columns.forEach((c) => assigns.push(`row.${c} = faker.number.int({ min: 1, max: ${rows} }) // identifiant supposé : parent créé plus loin`))
    })
    if (assigns.length) {
      w(`for (const [i, row] of ${lst}.entries()) {`)
      for (const a of assigns) w(`  ${a}`)
      w('}')
    }

    const wrap = identityWrap(tp, o)
    const cols = t.columns.map((c) => `[${JSON.stringify(c.name)}, ${JSON.stringify(q(c.name))}]`).join(', ')
    const extra = wrap.before.length || wrap.after.length || wrap.override ? `, ${JSON.stringify(wrap)}` : ''
    w(`insert(${JSON.stringify(q(t.name))}, [${cols}], ${lst}${extra})`)
  }
  w()
  w("console.log(out.join('\\n\\n'))")
  return lines.join('\n') + '\n'
}

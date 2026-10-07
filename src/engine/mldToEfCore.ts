import type { MldColumn, MldResult, MldTable } from '../types/schema'

export interface EfOptions {
  namespace: string
  contextName: string
}

export const EF_DEFAULTS: EfOptions = { namespace: 'MonApp.Data', contextName: 'AppDbContext' }

export function pascal(s: string): string {
  const out = s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
  return /^\d/.test(out) ? `_${out}` : out || 'Sans_nom'
}

/** Retire un éventuel préfixe / suffixe d'identifiant : id_client → client, client_id → client. */
function stripId(col: string): string {
  return col.replace(/^id_/i, '').replace(/_id$/i, '')
}

function csType(sqlType: string): string {
  const base = sqlType.replace(/\(.*\)$/, '')
  switch (base) {
    case 'INT':
      return 'int'
    case 'VARCHAR':
    case 'TEXT':
      return 'string'
    case 'DECIMAL':
      return 'decimal'
    case 'FLOAT':
      return 'double'
    case 'BOOLEAN':
      return 'bool'
    case 'DATE':
    case 'DATETIME':
      return 'DateTime'
    default:
      return 'string'
  }
}

const maxLength = (c: MldColumn): number | null => {
  const m = /^VARCHAR\((\d+)\)$/.exec(c.sqlType)
  return m ? Number(m[1]) : null
}

const precision = (c: MldColumn): string | null => {
  const m = /^DECIMAL\((\d+),\s*(\d+)\)$/.exec(c.sqlType)
  return m ? `${m[1]}, ${m[2]}` : null
}

interface Nav {
  fk: MldTable['foreignKeys'][number]
  /** Propriété de navigation côté table qui porte la clé étrangère. */
  name: string
  /** Collection inverse côté table référencée. */
  inverse: string
  host: MldTable
  target: MldTable
  nullable: boolean
}

/** Génère un DbContext Entity Framework Core (C#) avec classes d'entités et configuration Fluent API. */
export function mldToEfCore(mld: MldResult, options: Partial<EfOptions> = {}): string {
  const o = { ...EF_DEFAULTS, ...options }
  const tables = mld.tables
  if (!tables.length) return '// Aucune table : ajoutez des entités au MCD.\n'

  const className = new Map<string, string>(tables.map((t) => [t.name, pascal(t.name)]))
  const props = new Map<string, Map<string, string>>() // table → colonne → propriété
  const used = new Map<string, Set<string>>() // table → noms de membres pris

  for (const t of tables) {
    const taken = new Set<string>([className.get(t.name)!])
    const m = new Map<string, string>()
    for (const c of t.columns) {
      let p = pascal(c.name)
      while (taken.has(p)) p += '_'
      taken.add(p)
      m.set(c.name, p)
    }
    props.set(t.name, m)
    used.set(t.name, taken)
  }

  const unique = (table: string, base: string) => {
    const taken = used.get(table)!
    let n = base
    let i = 2
    while (taken.has(n)) n = `${base}${i++}`
    taken.add(n)
    return n
  }

  const tableByName = new Map(tables.map((t) => [t.name, t]))
  const navs: Nav[] = []
  for (const host of tables) {
    for (const fk of host.foreignKeys) {
      const target = tableByName.get(fk.refTable)!
      let stem = ''
      if (fk.columns.length === 1) {
        const [col] = fk.columns
        const [ref] = fk.refColumns
        // chef_id_employe référence id_employe : le rôle « chef » donne le nom de navigation
        stem = pascal(col !== ref && col.endsWith(`_${ref}`) ? col.slice(0, -(ref.length + 1)) : stripId(col))
      }
      const navBase = stem && stem !== className.get(host.name) ? stem : className.get(target.name)!
      const name = unique(host.name, navBase)
      const inverse = unique(target.name, `${className.get(host.name)}s`)
      const nullable = fk.columns.some((c) => host.columns.find((x) => x.name === c)!.nullable)
      navs.push({ fk, name, inverse, host, target, nullable })
    }
  }

  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('using System;')
  w('using System.Collections.Generic;')
  w('using Microsoft.EntityFrameworkCore;')
  w()
  w(`namespace ${o.namespace};`)
  w()

  // Classes d'entités
  for (const t of tables) {
    const cls = className.get(t.name)!
    w(`public class ${cls}`)
    w('{')
    for (const c of t.columns) {
      const type = csType(c.sqlType)
      const optional = c.nullable
      const decl = optional ? `${type}?` : type
      const init = !optional && type === 'string' ? ' = null!;' : ''
      w(`    public ${decl} ${props.get(t.name)!.get(c.name)} { get; set; }${init}`)
    }
    const mine = navs.filter((n) => n.host === t)
    const inverse = navs.filter((n) => n.target === t)
    if (mine.length || inverse.length) w()
    for (const n of mine) {
      const cls2 = className.get(n.target.name)!
      w(n.nullable ? `    public ${cls2}? ${n.name} { get; set; }` : `    public ${cls2} ${n.name} { get; set; } = null!;`)
    }
    for (const n of inverse) {
      w(`    public ICollection<${className.get(n.host.name)}> ${n.inverse} { get; set; } = new List<${className.get(n.host.name)}>();`)
    }
    w('}')
    w()
  }

  // DbContext
  w(`public class ${o.contextName} : DbContext`)
  w('{')
  w(`    public ${o.contextName}(DbContextOptions<${o.contextName}> options) : base(options) { }`)
  w()
  for (const t of tables) {
    const cls = className.get(t.name)!
    w(`    public DbSet<${cls}> ${cls}s { get; set; } = null!;`)
  }
  w()
  w('    protected override void OnModelCreating(ModelBuilder modelBuilder)')
  w('    {')
  tables.forEach((t, ti) => {
    const cls = className.get(t.name)!
    const p = props.get(t.name)!
    w(`        modelBuilder.Entity<${cls}>(e =>`)
    w('        {')
    w(`            e.ToTable("${t.name}");`)
    if (t.primaryKey.length === 1) w(`            e.HasKey(x => x.${p.get(t.primaryKey[0])});`)
    else if (t.primaryKey.length > 1) w(`            e.HasKey(x => new { ${t.primaryKey.map((k) => `x.${p.get(k)}`).join(', ')} });`)
    for (const c of t.columns) {
      const chain = [`.HasColumnName("${c.name}")`]
      const len = maxLength(c)
      const prec = precision(c)
      if (len) chain.push(`.HasMaxLength(${len})`)
      if (prec) chain.push(`.HasPrecision(${prec})`)
      if (t.primaryKey.length > 1 && t.primaryKey.includes(c.name) && csType(c.sqlType) === 'int') chain.push('.ValueGeneratedNever()')
      w(`            e.Property(x => x.${p.get(c.name)})${chain.join('')};`)
    }
    for (const n of navs.filter((x) => x.host === t)) {
      const fkExpr =
        n.fk.columns.length === 1
          ? `x => x.${p.get(n.fk.columns[0])}`
          : `x => new { ${n.fk.columns.map((c) => `x.${p.get(c)}`).join(', ')} }`
      w(`            e.HasOne(x => x.${n.name}).WithMany(y => y.${n.inverse}).HasForeignKey(${fkExpr}).OnDelete(DeleteBehavior.Restrict);`)
    }
    w('        });')
    if (ti < tables.length - 1) w()
  })
  w('    }')
  w('}')

  return lines.join('\n') + '\n'
}

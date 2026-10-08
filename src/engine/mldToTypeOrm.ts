import type { MldColumn, MldResult } from '../types/schema'
import { isAutoIncrement, sqlDefault, type SqlDialect, type SqlOptions } from './mldToSql'
import { baseType, lengthOf, ormModel, precisionOf } from './ormModel'

/** Littéral TypeScript entre apostrophes. */
const ts = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function tsType(c: MldColumn): string {
  switch (baseType(c)) {
    case 'INT':
    case 'FLOAT':
      return 'number'
    case 'BOOLEAN':
      return 'boolean'
    case 'DATETIME':
      return 'Date'
    default:
      return 'string' // VARCHAR, TEXT, et DECIMAL / DATE que le pilote renvoie en chaîne
  }
}

/** Type de colonne TypeORM, propre au dialecte quand les pilotes divergent. */
function columnType(c: MldColumn, dialect: SqlDialect): string[] {
  switch (baseType(c)) {
    case 'INT':
      return [`type: 'int'`]
    case 'VARCHAR': {
      const len = lengthOf(c)
      return [`type: 'varchar'`, ...(len ? [`length: ${len}`] : [])]
    }
    case 'TEXT':
      return dialect === 'sqlserver' ? [`type: 'nvarchar'`, `length: 'MAX'`] : [`type: 'text'`]
    case 'DECIMAL': {
      const prec = precisionOf(c)
      return [`type: 'decimal'`, ...(prec ? [`precision: ${prec[0]}`, `scale: ${prec[1] ?? 0}`] : [])]
    }
    case 'FLOAT':
      return [`type: 'float'`]
    case 'BOOLEAN':
      return [dialect === 'sqlserver' ? `type: 'bit'` : `type: 'boolean'`]
    case 'DATE':
      return [`type: 'date'`]
    case 'DATETIME':
      return [`type: '${dialect === 'postgresql' || dialect === 'standard' ? 'timestamp' : dialect === 'sqlserver' ? 'datetime2' : 'datetime'}'`]
    default:
      return [`type: 'varchar'`]
  }
}

function defaultOption(c: MldColumn, dialect: SqlDialect): string | null {
  if (!c.defaultValue?.trim()) return null
  const sql = sqlDefault(c.defaultValue, c, dialect)
  if (/^(TRUE|FALSE)$/i.test(sql)) return `default: ${sql.toLowerCase()}`
  if (c.dataType === 'BOOLEAN' && /^[01]$/.test(sql)) return `default: ${sql === '1'}`
  if (/^[+-]?\d+(\.\d+)?$/.test(sql) && c.dataType !== 'DECIMAL') return `default: ${sql}`
  const quoted = /^'(.*)'$/s.exec(sql)
  if (quoted && c.dataType !== 'DATE' && c.dataType !== 'DATETIME') return `default: ${ts(quoted[1].replace(/''/g, "'"))}`
  return `default: () => ${ts(sql)}`
}

/** Génère des entités TypeORM (TypeScript, décorateurs) : colonnes typées, clés, relations ManyToOne / OneToMany / OneToOne. */
export function mldToTypeOrm(mld: MldResult, options: Partial<SqlOptions> = {}): string {
  const o: SqlOptions = { dialect: 'standard', autoIncrement: false, ...options }
  const tables = mld.tables
  if (!tables.length) return '// Aucune table : ajoutez des entités au MCD.\n'

  const { className, props, rels } = ormModel(mld)
  const used = new Set<string>(['Entity', 'Relation'])
  const body: string[] = []
  const w = (s = '') => body.push(s)
  const deco = (name: string) => (used.add(name), name)

  tables.forEach((t, ti) => {
    const cls = className.get(t.name)!
    const p = props.get(t.name)!
    const checks = t.columns.filter((c) => c.check)

    w(`@Entity(${ts(t.name)})`)
    for (const c of checks) w(`@${deco('Check')}(${ts(`ck_${t.name}_${c.name}`)}, ${ts(c.check!)})`)
    w(`export class ${cls} {`)

    // Une colonne clé étrangère unique sur une seule colonne : le OneToOne crée déjà la contrainte.
    const ownOneToOne = new Set(rels.filter((r) => r.host === t && r.oneToOne && r.fk.columns.length === 1).map((r) => r.fk.columns[0]))

    t.columns.forEach((c, i) => {
      const isPk = t.primaryKey.includes(c.name)
      const auto = o.autoIncrement && isAutoIncrement(t, c)
      const opts = [`name: ${ts(c.name)}`]
      if (!auto) opts.push(...columnType(c, o.dialect))
      if (c.nullable && !isPk) opts.push('nullable: true')
      if (c.unique && !isPk && !ownOneToOne.has(c.name)) opts.push('unique: true')
      const def = auto ? null : defaultOption(c, o.dialect)
      if (def) opts.push(def)
      const kind = auto ? deco('PrimaryGeneratedColumn') : isPk ? deco('PrimaryColumn') : deco('Column')
      if (i) w()
      w(`  @${kind}({ ${opts.join(', ')} })`)
      w(`  ${p.get(c.name)}!: ${tsType(c)}${c.nullable && !isPk ? ' | null' : ''}`)
    })

    for (const r of rels.filter((x) => x.host === t)) {
      const targetCls = className.get(r.target.name)!
      const tp = props.get(r.target.name)!
      const join = r.fk.columns.map((c, i) => `{ name: ${ts(c)}, referencedColumnName: ${ts(tp.get(r.fk.refColumns[i])!)} }`)
      const opts = [`nullable: ${r.nullable}`, `onDelete: ${ts(r.fk.onDelete ?? 'RESTRICT')}`, ...(r.fk.onUpdate ? [`onUpdate: ${ts(r.fk.onUpdate)}`] : [])]
      w()
      w(`  @${deco(r.oneToOne ? 'OneToOne' : 'ManyToOne')}(() => ${targetCls}, (x) => x.${r.inverse}, { ${opts.join(', ')} })`)
      w(`  @${deco('JoinColumn')}(${join.length === 1 ? join[0] : `[${join.join(', ')}]`})`)
      w(`  ${r.field}!: Relation<${targetCls}>${r.nullable ? ' | null' : ''}`)
    }
    for (const r of rels.filter((x) => x.target === t)) {
      const hostCls = className.get(r.host.name)!
      w()
      w(`  @${deco(r.oneToOne ? 'OneToOne' : 'OneToMany')}(() => ${hostCls}, (x) => x.${r.field})`)
      w(r.oneToOne ? `  ${r.inverse}!: Relation<${hostCls}> | null` : `  ${r.inverse}!: Relation<${hostCls}[]>`)
    }
    w('}')
    if (ti < tables.length - 1) w()
  })

  return `import { ${[...used].sort().join(', ')} } from 'typeorm'\n\n${body.join('\n')}\n`
}

import { planSeed, seedData, seedToSql } from './mldToSeed'
import { seedToBogus, seedToFaker } from './seedScripts'
import type { SqlDialect } from './mldToSql'
import type { MldResult } from '../types/schema'

export type SeedFormat = 'sql' | 'csharp' | 'faker'

/** Une demande de génération, en données simples : elle traverse la frontière du Web Worker. */
export interface SeedJob {
  mld: MldResult
  format: SeedFormat
  rows: number
  seed: number
  dialect: SqlDialect
  autoIncrement: boolean
  ef: { namespace: string; contextName: string }
}

export interface SeedJobResult {
  code: string
  /** Tables qui auront moins de lignes que demandé (relation 1-1, combinaisons limitées), avec leur nombre réel. */
  reduced: string[]
}

/** Génère le script demandé ; le plan (ordre d'insertion, nombre de lignes) n'est calculé qu'une fois. */
export function runSeedJob(job: SeedJob): SeedJobResult {
  const opts = { rows: job.rows, seed: job.seed }
  const sqlOpts = { dialect: job.dialect, autoIncrement: job.autoIncrement }
  const plan = planSeed(job.mld, opts)
  const reduced = plan.tables.filter((t) => t.count < job.rows).map((t) => `${t.table.name} (${t.count})`)
  const code =
    job.format === 'csharp'
      ? seedToBogus(job.mld, opts, job.ef)
      : job.format === 'faker'
        ? seedToFaker(job.mld, opts, sqlOpts)
        : seedToSql(seedData(plan, opts), sqlOpts)
  return { code, reduced }
}

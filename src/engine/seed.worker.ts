import { runSeedJob, type SeedJob } from './seedJob'

/**
 * Génération des données fictives hors du fil principal : Faker (≈ 1,4 Mo de JavaScript) n'est chargé et exécuté
 * qu'ici, et une génération longue ne fige jamais l'interface. Voir `useSeedWorker`.
 */
self.onmessage = (e: MessageEvent<{ id: number; job: SeedJob }>) => {
  const { id, job } = e.data
  try {
    self.postMessage({ id, ...runSeedJob(job) })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
